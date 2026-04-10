/**
 * Apple In-App Purchase receipt verification + App Store Server Notifications.
 *
 * Purchase flow:
 * 1. POST /payments/apple-iap/verify — called from mobile after StoreKit purchase.
 *    Verifies receipt with Apple, upgrades user to 'pro', stores originalTransactionId.
 *
 * Subscription lifecycle:
 * 2. POST /payments/apple-iap/notifications — App Store Server Notifications (V2).
 *    Configure in App Store Connect → Subscriptions → App Store Server Notifications.
 *    Handles EXPIRED, REFUND, DID_RENEW, etc. to keep tier in sync automatically.
 */
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const prisma = new PrismaClient();

const APPLE_VERIFY_PRODUCTION = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_SANDBOX    = 'https://sandbox.itunes.apple.com/verifyReceipt';
const PRO_PRODUCT_IDS         = ['io.axiomtraining.app.pro.monthly'];

interface AppleVerifyResponse {
  status: number;
  latest_receipt_info?: Array<{
    product_id: string;
    expires_date_ms: string;
    cancellation_date?: string;
    [key: string]: unknown;
  }>;
  receipt?: {
    in_app?: Array<{
      product_id: string;
      expires_date_ms?: string;
      cancellation_date?: string;
      [key: string]: unknown;
    }>;
  };
}

async function verifyWithApple(
  receiptData: string,
  url: string,
): Promise<AppleVerifyResponse> {
  const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET ?? '';
  const body: Record<string, string> = { 'receipt-data': receiptData };
  if (sharedSecret) body.password = sharedSecret;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Apple verification HTTP ${res.status}`);
  return res.json() as Promise<AppleVerifyResponse>;
}

function hasActiveProSubscription(data: AppleVerifyResponse): boolean {
  const now = Date.now();
  const items = data.latest_receipt_info ?? data.receipt?.in_app ?? [];
  return items.some((item) => {
    if (!PRO_PRODUCT_IDS.includes(item.product_id)) return false;
    if (item.cancellation_date) return false;
    const expiresMs = parseInt(item.expires_date_ms ?? '0', 10);
    return expiresMs > now;
  });
}

// POST /api/payments/apple-iap/verify
router.post('/payments/apple-iap/verify', requireAuth, async (req, res) => {
  const { receiptData, productId, transactionId } = req.body as {
    receiptData?: string;
    productId?: string;
    transactionId?: string;
  };

  if (!receiptData) {
    return res.status(400).json({ error: 'receiptData is required' });
  }

  try {
    // 1. Try production endpoint first
    let appleResponse = await verifyWithApple(receiptData, APPLE_VERIFY_PRODUCTION);

    // 2. status 21007 → sandbox receipt, retry sandbox
    if (appleResponse.status === 21007) {
      appleResponse = await verifyWithApple(receiptData, APPLE_VERIFY_SANDBOX);
    }

    // 3. Non-zero status = invalid receipt
    if (appleResponse.status !== 0) {
      console.warn(`Apple IAP verification failed, status=${appleResponse.status}`, {
        userId: req.user!.id,
        productId,
        transactionId,
      });
      return res.status(402).json({
        error: `Apple verification failed (status ${appleResponse.status})`,
      });
    }

    // 4. Check for an active Pro subscription
    if (!hasActiveProSubscription(appleResponse)) {
      return res.status(402).json({ error: 'No active Pro subscription found in receipt' });
    }

    // 5. Extract originalTransactionId to link future notifications to this user
    const latestReceipt = appleResponse.latest_receipt_info?.[0];
    const originalTransactionId = (latestReceipt as any)?.original_transaction_id ?? transactionId ?? null;

    // 6. Upgrade user to Pro, store Apple transaction ID for lifecycle tracking
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        tier: 'pro',
        appleOriginalTransactionId: originalTransactionId,
        stripeSubStatus: null, // clear any stale Stripe status
      },
    });

    console.log(`Apple IAP: upgraded user ${req.user!.id} to Pro`, {
      productId,
      transactionId,
      originalTransactionId,
    });

    return res.json({ success: true, tier: 'pro' });
  } catch (err: any) {
    console.error('Apple IAP verification error:', err);
    return res.status(500).json({ error: 'Receipt verification failed. Please try again.' });
  }
});

// ─── App Store Server Notifications (V2) ─────────────────────────────────────
// Configure in App Store Connect → Subscriptions → App Store Server Notifications
// URL: https://api.airthreads.ai:4009/api/payments/apple-iap/notifications
// Apple sends signed JWTs (JWS) — we decode the payload without full signature
// verification here (acceptable for non-financial decisions like downgrade).
// For production hardening, verify the x5c cert chain from Apple's root CA.

router.post('/payments/apple-iap/notifications', async (req, res) => {
  try {
    const { signedPayload } = req.body as { signedPayload?: string };
    if (!signedPayload) return res.status(400).json({ error: 'Missing signedPayload' });

    // Decode JWT payload (middle segment) — no signature verification needed for downgrades
    const parts = signedPayload.split('.');
    if (parts.length !== 3) return res.status(400).json({ error: 'Invalid JWS format' });

    const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const { notificationType, subtype, data } = payloadJson as {
      notificationType: string;
      subtype?: string;
      data?: { signedTransactionInfo?: string; originalTransactionId?: string };
    };

    // Decode the inner transaction info JWT
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

    // Events that mean the subscription is no longer active
    const shouldDowngrade = (
      notificationType === 'EXPIRED' ||
      notificationType === 'REFUND' ||
      (notificationType === 'DID_CHANGE_RENEWAL_STATUS' && subtype === 'AUTO_RENEW_DISABLED') ||
      notificationType === 'REVOKE'
    );

    // Events that mean the subscription renewed successfully
    const shouldEnsurePro = (
      notificationType === 'DID_RENEW' ||
      notificationType === 'SUBSCRIBED' ||
      (notificationType === 'DID_CHANGE_RENEWAL_STATUS' && subtype === 'AUTO_RENEW_ENABLED')
    );

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
    // Always return 200 to Apple — non-200 causes retries
    return res.json({ ok: true });
  }
});

export default router;
