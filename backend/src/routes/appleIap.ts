/**
 * Apple In-App Purchase — StoreKit 2 / App Store Server API
 *
 * No shared secret needed. Uses a private key (.p8) from App Store Connect.
 *
 * Setup (one-time):
 *   App Store Connect → Users and Access → Integrations → In-App Purchase
 *   → Generate a key → download .p8 → copy contents to APPLE_IAP_PRIVATE_KEY env var
 *   Also set APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_BUNDLE_ID
 *
 * Purchase flow:
 *   Mobile sends transactionId (string) from StoreKit 2 purchase object.
 *   Backend signs a JWT, calls App Store Server API to verify the transaction,
 *   confirms it's an active Pro subscription, upgrades user tier.
 *
 * Lifecycle:
 *   POST /api/payments/apple-iap/notifications handles App Store Server Notifications V2.
 *   Configure URL in App Store Connect → Apps → Axiom → Subscriptions →
 *   App Store Server Notifications → Production URL:
 *   https://api.airthreads.ai:4009/api/payments/apple-iap/notifications
 */
import { Router } from 'express';
import { createSign, createVerify, X509Certificate } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import posthog from '../services/posthogClient.js';

const router = Router();
const prisma = new PrismaClient();

const PRO_PRODUCT_IDS = ['io.axiomtraining.app.pro.monthly'];
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── JWT for App Store Server API ────────────────────────────────────────────

function makeAppStoreJWT(): string {
  const keyId     = process.env.APPLE_IAP_KEY_ID     ?? '';
  const issuerId  = process.env.APPLE_IAP_ISSUER_ID  ?? '';
  const privateKey = process.env.APPLE_IAP_PRIVATE_KEY ?? '';

  if (!keyId || !issuerId || !privateKey) {
    throw new Error('Missing Apple IAP env vars (APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY)');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuerId,
    iat: now,
    exp: now + 3600,
    aud: 'appstoreconnect-v1',
    bid: process.env.APPLE_IAP_BUNDLE_ID ?? 'io.axiomtraining.app',
  })).toString('base64url');

  const sign = createSign('SHA256');
  sign.update(`${header}.${payload}`);
  // JWT ES256 requires IEEE P1363 (raw R||S), not DER — Node v15+ defaults to DER
  const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');

  return `${header}.${payload}.${signature}`;
}

// ─── App Store Server API lookup ──────────────────────────────────────────────

interface ASAPITransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  expiresDate?: number;       // ms epoch
  revocationDate?: number;
  type: string;               // 'Auto-Renewable Subscription' | 'Non-Consumable' etc.
  environment: string;        // 'Production' | 'Sandbox'
}

/**
 * Fetch transaction info from App Store Server API.
 * Automatically handles Sandbox vs Production by trying production first,
 * then falling back to sandbox on 4040 (transaction not found in production).
 */
async function fetchTransaction(transactionId: string): Promise<ASAPITransaction> {
  const jwt = makeAppStoreJWT();

  async function tryEnv(baseUrl: string): Promise<ASAPITransaction | null> {
    const res = await fetch(`${baseUrl}/inApps/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) return null; // not found in this environment
    if (!res.ok) throw new Error(`App Store API ${res.status}: ${await res.text()}`);
    const json = await res.json() as { signedTransactionInfo?: string };
    if (!json.signedTransactionInfo) throw new Error('No signedTransactionInfo in response');

    // Decode the JWS payload (no sig verification needed — Apple signed it)
    const parts = json.signedTransactionInfo.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWS from Apple');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as ASAPITransaction;
  }

  // Production first
  const prod = await tryEnv('https://api.storekit.itunes.apple.com');
  if (prod) return prod;

  // Sandbox fallback (TestFlight, sandbox testers)
  const sandbox = await tryEnv('https://api.storekit-sandbox.itunes.apple.com');
  if (sandbox) return sandbox;

  throw new Error(`Transaction ${transactionId} not found in production or sandbox`);
}

function isActiveProTransaction(tx: ASAPITransaction): boolean {
  if (!PRO_PRODUCT_IDS.includes(tx.productId)) return false;
  if (tx.revocationDate) return false;
  if (tx.expiresDate && tx.expiresDate < Date.now()) return false;
  // Reject sandbox transactions in production. fetchTransaction falls back to
  // the sandbox App Store API when a transaction isn't found in production —
  // which is correct for TestFlight, but without this check a StoreKit sandbox
  // purchase (free, and creatable at will by anyone with a sandbox tester
  // account) verified as a real Pro subscription against the live app.
  if (IS_PROD && tx.environment && tx.environment !== 'Production') {
    console.warn(`Apple IAP: rejecting ${tx.environment} transaction ${tx.transactionId} in production`);
    return false;
  }
  return true;
}

// ─── App Store Server Notification verification ──────────────────────────────
//
// The notification endpoint previously decoded the JWS without verifying it —
// the code said so outright. Since the endpoint is unauthenticated, anyone could
// POST a hand-built payload: `EXPIRED` with a known originalTransactionId
// downgraded a paying customer, `SUBSCRIBED` re-granted Pro. (And the
// originalTransactionId was itself obtainable from the unauthenticated
// GET /sessions/:id user-record leak fixed in this same pass.)
//
// Apple signs these with an x5c certificate chain in the JWS header, rooted in
// the Apple Root CA - G3. Verifying means: check the chain links to that root,
// then check the payload signature against the leaf's public key.

/**
 * Apple Root CA - G3, the trust anchor for App Store Server Notifications V2.
 * Distributed by Apple at https://www.apple.com/certificateauthority/
 * Overridable via APPLE_ROOT_CA_G3_B64 so the cert can be rotated without a
 * code change.
 */
const APPLE_ROOT_CA_G3_B64 =
  process.env.APPLE_ROOT_CA_G3_B64 ??
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9v' +
  'dCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UE' +
  'CgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2' +
  'WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmlj' +
  'YXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqG' +
  'SM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxE' +
  'tX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNC' +
  'MEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0P' +
  'AQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3m' +
  'eoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkL' +
  'F1vLUagM6BgD56KyKA==';

/** Decode a JWS segment as UTF-8 JSON. */
function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

/** Convert an ECDSA signature from JOSE (raw r||s) to DER, which crypto expects. */
function joseToDer(sig: Buffer): Buffer {
  const half = sig.length / 2;
  const trim = (b: Buffer) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.subarray(i);
    // Prepend 0x00 when the high bit is set, so DER reads it as positive.
    return v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v;
  };
  const r = trim(sig.subarray(0, half));
  const s = trim(sig.subarray(half));
  const body = Buffer.concat([
    Buffer.from([0x02, r.length]), r,
    Buffer.from([0x02, s.length]), s,
  ]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/**
 * Verify an Apple-signed JWS and return its decoded payload, or null if the
 * signature, chain, or validity window doesn't hold up.
 *
 * Exported for tests.
 */
export function verifyAppleJWS<T>(jws: string): T | null {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return null;

    const header = decodeSegment<{ alg: string; x5c?: string[] }>(parts[0]);
    if (header.alg !== 'ES256') return null;
    const chain = header.x5c;
    if (!chain || chain.length < 2) return null;

    // Build the certificate chain: [leaf, intermediate, ..., root].
    const certs = chain.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')));
    const root = new X509Certificate(Buffer.from(APPLE_ROOT_CA_G3_B64, 'base64'));

    // The chain Apple presents must terminate at the root we pin. Comparing
    // the raw DER is stricter than comparing subjects — a self-signed cert with
    // a spoofed subject won't match.
    if (!certs[certs.length - 1].raw.equals(root.raw)) return null;

    // Each certificate must be signed by the next one up.
    for (let i = 0; i < certs.length - 1; i++) {
      if (!certs[i].verify(certs[i + 1].publicKey)) return null;
    }
    // And the pinned root must be self-consistent.
    if (!root.verify(root.publicKey)) return null;

    // Validity windows.
    const now = Date.now();
    for (const cert of certs) {
      if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) return null;
    }

    // Finally the payload signature, against the leaf.
    const verifier = createVerify('SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    if (!verifier.verify(certs[0].publicKey, joseToDer(Buffer.from(parts[2], 'base64url')))) {
      return null;
    }

    return decodeSegment<T>(parts[1]);
  } catch (err: any) {
    console.warn('[apple-iap] JWS verification threw:', err?.message ?? err);
    return null;
  }
}

// ─── POST /api/payments/apple-iap/verify ─────────────────────────────────────

router.post('/payments/apple-iap/verify', requireAuth, async (req, res) => {
  const { transactionId, productId } = req.body as {
    transactionId?: string;
    productId?: string;
  };

  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId is required' });
  }

  try {
    const tx = await fetchTransaction(transactionId);

    if (!isActiveProTransaction(tx)) {
      console.warn(`Apple IAP: invalid/inactive transaction for user ${req.user!.id}`, {
        transactionId,
        productId: tx.productId,
        expiresDate: tx.expiresDate,
        revocationDate: tx.revocationDate,
      });
      return res.status(402).json({ error: 'No active Pro subscription found for this transaction' });
    }

    // Upgrade user — store originalTransactionId to link future lifecycle notifications
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        tier: 'pro',
        appleOriginalTransactionId: tx.originalTransactionId,
        stripeSubStatus: null,
      },
    });

    console.log(`Apple IAP: upgraded user ${req.user!.id} to Pro`, {
      transactionId,
      originalTransactionId: tx.originalTransactionId,
      productId: tx.productId,
      environment: tx.environment,
    });

    posthog.capture({
      distinctId: req.user!.id,
      event: 'apple_iap_verified',
      properties: {
        product_id: tx.productId,
        original_transaction_id: tx.originalTransactionId,
        environment: tx.environment,
      },
    });

    return res.json({ success: true, tier: 'pro' });
  } catch (err: any) {
    posthog.captureException(err, req.user!.id);
    console.error('Apple IAP verification error:', err);
    return res.status(500).json({ error: 'Receipt verification failed. Please try again.' });
  }
});

// ─── POST /api/payments/apple-iap/notifications ──────────────────────────────
// App Store Server Notifications V2 — keeps tier in sync on renewal/cancellation.
// Apple signs the payload as a JWS with an x5c chain rooted in Apple Root CA -
// G3; we verify that chain before acting on anything (see verifyAppleJWS).
// Without verification this endpoint was a way for anyone to flip any user's
// tier, in either direction.

router.post('/payments/apple-iap/notifications', async (req, res) => {
  try {
    const { signedPayload } = req.body as { signedPayload?: string };
    if (!signedPayload) return res.status(400).json({ error: 'Missing signedPayload' });

    const payloadJson = verifyAppleJWS<{
      notificationType: string;
      subtype?: string;
      data?: { signedTransactionInfo?: string; originalTransactionId?: string; environment?: string };
    }>(signedPayload);

    if (!payloadJson) {
      // 401, not 200: a genuine Apple notification always verifies, so anything
      // that lands here is forged or corrupt and shouldn't be silently accepted.
      console.warn('[apple-iap] rejecting notification with an invalid signature');
      return res.status(401).json({ error: 'Invalid notification signature' });
    }

    const { notificationType, subtype, data } = payloadJson;

    // The inner transaction JWS is signed separately — verify it too rather
    // than trusting the outer envelope to vouch for its contents.
    let originalTransactionId: string | null = null;
    let txEnvironment: string | null = data?.environment ?? null;
    if (data?.signedTransactionInfo) {
      const txPayload = verifyAppleJWS<{ originalTransactionId?: string; environment?: string }>(
        data.signedTransactionInfo,
      );
      if (!txPayload) {
        console.warn('[apple-iap] rejecting notification with an invalid inner transaction signature');
        return res.status(401).json({ error: 'Invalid transaction signature' });
      }
      originalTransactionId = txPayload.originalTransactionId ?? null;
      txEnvironment = txPayload.environment ?? txEnvironment;
    }
    originalTransactionId ??= data?.originalTransactionId ?? null;

    // Same sandbox rule as the verify route: a sandbox lifecycle event must not
    // move a production user's tier.
    if (IS_PROD && txEnvironment && txEnvironment !== 'Production') {
      console.log(`Apple notification: ignoring ${txEnvironment} event in production`);
      return res.json({ ok: true });
    }

    console.log(`Apple notification: ${notificationType}${subtype ? '/' + subtype : ''}`, { originalTransactionId });

    if (!originalTransactionId) return res.json({ ok: true });

    const shouldDowngrade =
      notificationType === 'EXPIRED' ||
      notificationType === 'REFUND' ||
      notificationType === 'REVOKE' ||
      (notificationType === 'DID_CHANGE_RENEWAL_STATUS' && subtype === 'AUTO_RENEW_DISABLED');

    const shouldEnsurePro =
      notificationType === 'DID_RENEW' ||
      notificationType === 'SUBSCRIBED' ||
      (notificationType === 'DID_CHANGE_RENEWAL_STATUS' && subtype === 'AUTO_RENEW_ENABLED');

    if (shouldDowngrade) {
      await prisma.user.updateMany({
        where: { appleOriginalTransactionId: originalTransactionId },
        data: { tier: 'free', stripeSubStatus: null },
      });
      console.log(`Apple IAP: downgraded user (originalTx: ${originalTransactionId}) to free`);
    } else if (shouldEnsurePro) {
      await prisma.user.updateMany({
        where: { appleOriginalTransactionId: originalTransactionId },
        data: { tier: 'pro' },
      });
      console.log(`Apple IAP: confirmed pro renewal (originalTx: ${originalTransactionId})`);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Apple notification error:', err);
    return res.json({ ok: true }); // always 200 to Apple to prevent retries
  }
});

export default router;
