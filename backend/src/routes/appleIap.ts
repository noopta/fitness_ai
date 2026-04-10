/**
 * Apple In-App Purchase receipt verification endpoint.
 *
 * Apple requires server-side receipt verification:
 * 1. Send receipt to Apple's production endpoint.
 * 2. If Apple returns status 21007 (sandbox receipt), retry with sandbox endpoint.
 * 3. Check the latest_receipt_info for an active subscription matching our product ID.
 * 4. On success, upgrade user to 'pro' tier.
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

    // 5. Upgrade user to Pro
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { tier: 'pro' },
    });

    console.log(`Apple IAP: upgraded user ${req.user!.id} to Pro`, {
      productId,
      transactionId,
    });

    return res.json({ success: true, tier: 'pro' });
  } catch (err: any) {
    console.error('Apple IAP verification error:', err);
    return res.status(500).json({ error: 'Receipt verification failed. Please try again.' });
  }
});

export default router;
