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
import { createSign } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import posthog from '../services/posthogClient.js';

const router = Router();
const prisma = new PrismaClient();

const PRO_PRODUCT_IDS = ['io.axiomtraining.app.pro.monthly'];

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
  const signature = sign.sign(privateKey, 'base64url');

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
  return true;
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
// Apple sends a signed JWS payload. We decode (not verify sig) and act on the event.

router.post('/payments/apple-iap/notifications', async (req, res) => {
  try {
    const { signedPayload } = req.body as { signedPayload?: string };
    if (!signedPayload) return res.status(400).json({ error: 'Missing signedPayload' });

    const parts = signedPayload.split('.');
    if (parts.length !== 3) return res.json({ ok: true });

    const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      notificationType: string;
      subtype?: string;
      data?: { signedTransactionInfo?: string; originalTransactionId?: string };
    };

    const { notificationType, subtype, data } = payloadJson;

    // Decode inner transaction JWS
    let originalTransactionId: string | null = null;
    if (data?.signedTransactionInfo) {
      const txParts = data.signedTransactionInfo.split('.');
      if (txParts.length === 3) {
        const txPayload = JSON.parse(Buffer.from(txParts[1], 'base64url').toString('utf8'));
        originalTransactionId = txPayload.originalTransactionId ?? null;
      }
    }
    originalTransactionId ??= data?.originalTransactionId ?? null;

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
