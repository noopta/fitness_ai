/**
 * Google Play Billing service — Android-only counterpart to iap.ts (iOS).
 *
 * Why a separate file: the surface area is similar but the listeners, the
 * purchase-object shape, and the receipt-verification payload all differ. Mixing
 * them in one file made the iOS path harder to follow when react-native-iap
 * v14 changed its API.
 *
 * Purchase flow:
 *   1. initIAP() — opens the Play Billing connection.
 *   2. fetchProProduct() — fetches the active subscription offer for our SKU.
 *   3. purchaseProMonthly() — launches Play Billing sheet.
 *   4. purchaseUpdatedListener fires with a Purchase containing `purchaseToken`.
 *   5. verifyGoogleReceipt() POSTs { purchaseToken, productId } to the backend,
 *      which calls androidpublisher.purchases.subscriptionsv2.get to confirm.
 *   6. finishTransaction acknowledges to Google so they don't refund after 3 days.
 */
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type ProductSubscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { Platform } from 'react-native';
import { apiFetch } from './api';
import { iapLog, iapWarn, iapError } from './debugLog';

// ─── Product IDs ──────────────────────────────────────────────────────────────
// Must match the product ID configured in Play Console → Monetize → Subscriptions.
// We use a single subscription with a "monthly" base plan; the Play SKU is just
// the subscription product ID (no base plan suffix needed for the SKU lookup).
export const GOOGLE_PRODUCT_IDS = ['axiom_pro_monthly'];
export const PRO_MONTHLY_ID = 'axiom_pro_monthly';

// ─── Connection ───────────────────────────────────────────────────────────────
let connectionInitialised = false;

export async function initIAP(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    iapLog('[google] initConnection — start');
    await initConnection();
    connectionInitialised = true;
    iapLog('[google] initConnection — ready');
    return true;
  } catch (err: any) {
    iapError('[google] initConnection failed:', err?.message ?? String(err));
    return false;
  }
}

export function teardownIAP() {
  if (connectionInitialised) {
    endConnection();
    connectionInitialised = false;
  }
}

// ─── Fetch Products ───────────────────────────────────────────────────────────
export async function fetchProProduct(): Promise<{ product: ProductSubscription | null; error: string | null }> {
  try {
    iapLog('[google] fetchProducts(subs) — skus:', GOOGLE_PRODUCT_IDS);
    let products = (await fetchProducts({ skus: GOOGLE_PRODUCT_IDS, type: 'subs' })) ?? [];
    iapLog(`[google] fetchProducts(subs) — returned ${products.length} item(s):`, products.map((p: any) => p.id ?? p.productId));

    // Same warm-up workaround as iOS: occasional empty first response.
    if (products.length === 0) {
      iapWarn('[google] subs fetch empty — retrying after 500ms');
      await new Promise<void>(r => setTimeout(r, 500));
      products = (await fetchProducts({ skus: GOOGLE_PRODUCT_IDS, type: 'subs' })) ?? [];
    }

    const subs = products as ProductSubscription[];
    const match = subs.find(p => p.id === PRO_MONTHLY_ID) ?? subs[0] ?? null;
    if (match) {
      iapLog('[google] product found:', match.id);
      return { product: match, error: null };
    }
    // No product came back. Surface an error so the paywall shows a Retry
    // instead of silently hiding the Google Play option entirely (the build
    // must be installed from a Play track and the SKU/base plan must be
    // active in Play Console for this to return anything).
    iapWarn('[google] product NOT found. Wanted:', PRO_MONTHLY_ID, '— got IDs:', subs.map(p => p.id));
    return {
      product: null,
      error: 'Google Play subscription unavailable right now. It may still be activating — tap Retry, or pay with card below.',
    };
  } catch (err: any) {
    const msg = err?.message ?? err?.code ?? String(err);
    iapError('[google] fetchProducts threw:', msg);
    return { product: null, error: msg };
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
/**
 * Launches the Play Billing subscription flow. On Android we must specify the
 * subscription offer token (Google's billing v6 requirement). We take the first
 * offer attached to the base plan — apps with multiple offer tiers should pick
 * deliberately, but we have one offer right now.
 */
export async function purchaseProMonthly(product: ProductSubscription): Promise<void> {
  iapLog('[google] requestPurchase — sku:', PRO_MONTHLY_ID);
  // The Play subscription product has one or more "subscription offers" each
  // with an offerToken. We need at least one to launch the sheet.
  const offers = (product as any).subscriptionOfferDetailsAndroid ?? (product as any).subscriptionOfferDetails ?? [];
  const offerToken = offers[0]?.offerToken;
  if (!offerToken) {
    throw new Error('No subscription offer found for this product. Check Play Console base plan setup.');
  }
  await requestPurchase({
    type: 'subs',
    request: {
      android: {
        skus: [PRO_MONTHLY_ID],
        subscriptionOffers: [{ sku: PRO_MONTHLY_ID, offerToken }],
      },
    },
  });
}

// ─── Verify with backend ──────────────────────────────────────────────────────
export async function verifyGoogleReceipt(purchase: Purchase): Promise<void> {
  const purchaseToken = (purchase as any).purchaseToken ?? (purchase as any).purchaseTokenAndroid;
  iapLog('[google] verifyGoogleReceipt — productId:', purchase.productId);

  if (!purchaseToken) {
    iapError('[google] verifyGoogleReceipt — no purchaseToken on purchase:', JSON.stringify(purchase));
    throw new Error('No purchaseToken on purchase');
  }

  try {
    await apiFetch('/payments/google-iap/verify', {
      method: 'POST',
      body: JSON.stringify({ purchaseToken, productId: purchase.productId }),
    });
    iapLog('[google] verifyGoogleReceipt — backend verified OK');
  } catch (err: any) {
    iapError('[google] verifyGoogleReceipt — backend error:', err?.message ?? String(err));
    throw err;
  }

  // Acknowledging is mandatory within 3 days or Google auto-refunds.
  // finishTransaction(isConsumable: false) calls acknowledgePurchase on Android.
  await finishTransaction({ purchase, isConsumable: false });
  iapLog('[google] finishTransaction — acknowledged');
}

// ─── Restore ──────────────────────────────────────────────────────────────────
/**
 * Re-runs verification for any active Play purchase. Equivalent of iOS restore.
 * Play Console doesn't require a visible "restore" button the way Apple does,
 * but we surface one anyway — reinstall-after-uninstall is a real flow.
 */
export async function restorePurchases(): Promise<boolean> {
  const purchases = await getAvailablePurchases();
  const proPurchases = purchases.filter(p => GOOGLE_PRODUCT_IDS.includes(p.productId));
  if (proPurchases.length === 0) return false;
  await verifyGoogleReceipt(proPurchases[0]);
  return true;
}

// ─── Listener helpers ─────────────────────────────────────────────────────────
export function addPurchaseListener(
  onSuccess: (purchase: Purchase) => void,
  onError: (error: PurchaseError) => void,
) {
  const successSub = purchaseUpdatedListener(onSuccess);
  const errorSub = purchaseErrorListener(onError);
  return () => {
    successSub.remove();
    errorSub.remove();
  };
}
