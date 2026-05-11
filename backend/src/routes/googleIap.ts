/**
 * Google Play In-App Purchase — Android Publisher API
 *
 * Counterpart to appleIap.ts. Google's API surface is different in two important
 * ways:
 *   1. There's no transaction lookup by ID — we verify by `(packageName,
 *      subscriptionId, purchaseToken)` tuple.
 *   2. Lifecycle notifications come via Pub/Sub (Real-time Developer
 *      Notifications), not direct webhooks. The notification payload is base64
 *      JSON delivered to a Pub/Sub HTTPS push subscription.
 *
 * Setup (one-time):
 *   1. Google Cloud Console → Service Accounts → create one for "play-api".
 *   2. Play Console → Setup → API access → grant that service account access
 *      with the "View financial data, orders, and cancellation survey responses"
 *      permission (subscriptionsv2.get needs this).
 *   3. Download the service account JSON.
 *   4. Set env vars:
 *        GOOGLE_PLAY_PACKAGE_NAME=io.axiomtraining.app
 *        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON='<full JSON string>'
 *      (Use a JSON-encoded string. Newlines inside private_key are escaped
 *      already in the JSON, so passing the file contents as-is works.)
 *   5. Configure Real-time Developer Notifications in Play Console with a
 *      Pub/Sub topic; subscribe the topic to push to
 *      https://api.airthreads.ai:4009/api/payments/google-iap/notifications
 *
 * Purchase flow:
 *   Mobile → Play Billing → purchase object with `purchaseToken`.
 *   Mobile sends purchaseToken + productId to /payments/google-iap/verify.
 *   Backend calls androidpublisher.purchases.subscriptionsv2.get to confirm.
 *   Confirmed active → upgrade tier to pro, persist purchaseToken for lifecycle.
 */
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { requireAuth } from '../middleware/requireAuth.js';
import posthog from '../services/posthogClient.js';

const router = Router();
const prisma = new PrismaClient();

const PRO_PRODUCT_IDS = ['axiom_pro_monthly'];

// ─── Auth client ──────────────────────────────────────────────────────────────

let androidPublisherClient: ReturnType<typeof google.androidpublisher> | null = null;

function getAndroidPublisher() {
  if (androidPublisherClient) return androidPublisherClient;

  const saJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    throw new Error('Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON env var');
  }
  let credentials: any;
  try {
    credentials = JSON.parse(saJson);
  } catch (e) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  androidPublisherClient = google.androidpublisher({ version: 'v3', auth });
  return androidPublisherClient;
}

function packageName(): string {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME ?? 'io.axiomtraining.app';
}

// ─── Subscription lookup ──────────────────────────────────────────────────────

interface PlaySubState {
  productId: string;
  purchaseToken: string;
  expiryMs: number | null;     // null if no expiry returned (rare)
  isActive: boolean;
  state: string;               // 'SUBSCRIPTION_STATE_ACTIVE' | '..._CANCELED' | etc.
  linkedPurchaseToken: string | null; // present after an upgrade/downgrade
}

// Pure helper extracted for unit-testing without faking the googleapis client.
// `now` is injectable so we can test the "canceled but still paid" branch.
export function resolvePlaySubscriptionState(
  data: any,
  productId: string,
  purchaseToken: string,
  now: number = Date.now(),
): PlaySubState {
  const state = data?.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED';
  const ACTIVE_STATES = new Set([
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  ]);
  const lineItem = data?.lineItems?.[0];
  const expiryIso = lineItem?.expiryTime ?? null;
  const expiryMs = expiryIso ? Date.parse(expiryIso) : null;

  // Allow CANCELED if expiry is still in the future (user cancelled renewal
  // but their current period is still active and Google won't refund).
  const stillPaidThroughExpiry =
    state === 'SUBSCRIPTION_STATE_CANCELED' &&
    expiryMs !== null &&
    expiryMs > now;

  return {
    productId,
    purchaseToken,
    expiryMs,
    isActive: ACTIVE_STATES.has(state) || stillPaidThroughExpiry,
    state,
    linkedPurchaseToken: data?.linkedPurchaseToken ?? null,
  };
}

async function fetchSubscriptionV2(purchaseToken: string, productId: string): Promise<PlaySubState> {
  const ap = getAndroidPublisher();
  const res = await ap.purchases.subscriptionsv2.get({
    packageName: packageName(),
    token: purchaseToken,
  });
  return resolvePlaySubscriptionState(res.data, productId, purchaseToken);
}

// ─── POST /api/payments/google-iap/verify ────────────────────────────────────

router.post('/payments/google-iap/verify', requireAuth, async (req, res) => {
  const { purchaseToken, productId } = req.body as {
    purchaseToken?: string;
    productId?: string;
  };

  if (!purchaseToken || !productId) {
    return res.status(400).json({ error: 'purchaseToken and productId are required' });
  }
  if (!PRO_PRODUCT_IDS.includes(productId)) {
    return res.status(400).json({ error: `Unrecognized productId: ${productId}` });
  }

  try {
    const sub = await fetchSubscriptionV2(purchaseToken, productId);

    if (!sub.isActive) {
      console.warn(`Google IAP: inactive subscription for user ${req.user!.id}`, {
        productId,
        state: sub.state,
        expiryMs: sub.expiryMs,
      });
      return res.status(402).json({ error: 'No active Pro subscription found for this purchase' });
    }

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        tier: 'pro',
        googlePurchaseToken: sub.purchaseToken,
        googleProductId: sub.productId,
        googleSubExpiresAt: sub.expiryMs ? new Date(sub.expiryMs) : null,
        stripeSubStatus: null,
      },
    });

    console.log(`Google IAP: upgraded user ${req.user!.id} to Pro`, {
      productId: sub.productId,
      expiry: sub.expiryMs ? new Date(sub.expiryMs).toISOString() : null,
      state: sub.state,
    });

    posthog.capture({
      distinctId: req.user!.id,
      event: 'google_iap_verified',
      properties: {
        product_id: sub.productId,
        subscription_state: sub.state,
      },
    });

    return res.json({ success: true, tier: 'pro' });
  } catch (err: any) {
    posthog.captureException(err, req.user!.id);
    console.error('Google IAP verification error:', err?.message ?? err);
    return res.status(500).json({ error: 'Receipt verification failed. Please try again.' });
  }
});

// ─── POST /api/payments/google-iap/notifications ─────────────────────────────
// Pub/Sub HTTPS push endpoint for Real-time Developer Notifications.
// Body shape: { message: { data: "<base64 json>", attributes: {...}, messageId, publishTime }, subscription }
//
// The decoded JSON contains either subscriptionNotification, oneTimeProductNotification,
// or testNotification. We only act on subscriptionNotification.

router.post('/payments/google-iap/notifications', async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.data) {
      // Pub/Sub sends test pings without data — always 200.
      return res.json({ ok: true });
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf8');
    let payload: any;
    try {
      payload = JSON.parse(decoded);
    } catch {
      console.warn('Google notification: payload not JSON, ignoring');
      return res.json({ ok: true });
    }

    const sub = payload.subscriptionNotification;
    if (!sub) {
      // Could be testNotification or oneTimeProductNotification — log and skip.
      console.log('Google notification: non-subscription type', payload.notificationType ?? Object.keys(payload));
      return res.json({ ok: true });
    }

    // notificationType reference:
    //   1 RECOVERED, 2 RENEWED, 3 CANCELED, 4 PURCHASED, 5 ON_HOLD,
    //   6 IN_GRACE_PERIOD, 7 RESTARTED, 8 PRICE_CHANGE_CONFIRMED,
    //   9 DEFERRED, 10 PAUSED, 11 PAUSE_SCHEDULE_CHANGED, 12 REVOKED,
    //   13 EXPIRED, 20 RENEWAL_PRICE_CHANGE_UPDATED
    const notificationType: number = sub.notificationType;
    const purchaseToken: string | undefined = sub.purchaseToken;
    const productId: string | undefined = sub.subscriptionId;

    console.log(`Google notification: type=${notificationType}`, { productId });

    if (!purchaseToken) return res.json({ ok: true });

    // Always re-fetch the current state on any notification — Google's "type"
    // is a hint but the source of truth is subscriptionsv2.get.
    let state: PlaySubState;
    try {
      state = await fetchSubscriptionV2(purchaseToken, productId ?? 'axiom_pro_monthly');
    } catch (e: any) {
      console.error('Google notification: lookup failed', e?.message);
      return res.json({ ok: true }); // 200 so Pub/Sub doesn't retry forever
    }

    if (state.isActive) {
      await prisma.user.updateMany({
        where: { googlePurchaseToken: purchaseToken },
        data: {
          tier: 'pro',
          googleSubExpiresAt: state.expiryMs ? new Date(state.expiryMs) : null,
        },
      });
      console.log(`Google IAP: confirmed active for purchaseToken ${purchaseToken.slice(0, 12)}…`);
    } else {
      // Expired, revoked, refunded, on hold past grace period.
      await prisma.user.updateMany({
        where: { googlePurchaseToken: purchaseToken },
        data: { tier: 'free' },
      });
      console.log(`Google IAP: downgraded for purchaseToken ${purchaseToken.slice(0, 12)}… state=${state.state}`);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Google notification error:', err?.message ?? err);
    return res.json({ ok: true }); // never 5xx to Pub/Sub
  }
});

export default router;

// Exported for tests — `fetchSubscriptionV2` still hits the real API; prefer
// `resolvePlaySubscriptionState` for unit tests that don't want a mock.
export const __test = { fetchSubscriptionV2 };
