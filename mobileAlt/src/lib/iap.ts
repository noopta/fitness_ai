/**
 * Apple In-App Purchase service (react-native-iap v14 / StoreKit 2)
 *
 * v14 breaking changes:
 *  - getSubscriptions()   → fetchProducts({ skus, type: 'subs' })
 *  - requestSubscription()→ requestPurchase({ type: 'subs', request: { apple: { sku } } })
 *  - Subscription type    → ProductSubscription
 *  - product.localizedPrice → product.displayPrice (iOS)
 *  - purchase.transactionId → purchase.id
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

// ─── Product IDs ──────────────────────────────────────────────────────────────
export const APPLE_PRODUCT_IDS = ['io.axiomtraining.app.pro.monthly'];
export const PRO_MONTHLY_ID = 'io.axiomtraining.app.pro.monthly';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface IAPProduct {
  productId: string;
  localizedPrice: string;
  title: string;
  description: string;
}

// ─── Connection ───────────────────────────────────────────────────────────────
let connectionInitialised = false;

export async function initIAP(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    await initConnection();
    connectionInitialised = true;
    // Brief pause — Nitro/StoreKit bridge needs a tick to fully settle
    // before product fetches will succeed on first launch.
    await new Promise<void>(r => setTimeout(r, 300));
    return true;
  } catch {
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
/**
 * Fetches the Pro subscription product from StoreKit.
 *
 * Strategy:
 *  1. Try type:'subs' (correct v14 API for subscriptions).
 *  2. If that returns empty, fall back to type:'all' — a known workaround for
 *     the Nitro bridge warm-up race condition in react-native-iap v14.
 *  3. Match by product ID; accept the first result if exact match not found.
 */
export async function fetchProProduct(): Promise<{ product: ProductSubscription | null; error: string | null }> {
  try {
    let products = await fetchProducts({ skus: APPLE_PRODUCT_IDS, type: 'subs' });
    console.log('[IAP] fetchProducts(subs) result count:', products.length, JSON.stringify(products));

    // Fallback: if subs type returns empty, try fetching all types
    if (products.length === 0) {
      console.warn('[IAP] subs fetch returned empty — retrying with type:all');
      await new Promise<void>(r => setTimeout(r, 500));
      products = await fetchProducts({ skus: APPLE_PRODUCT_IDS, type: 'all' });
      console.log('[IAP] fetchProducts(all) result count:', products.length, JSON.stringify(products));
    }

    const subs = products as ProductSubscription[];
    const match = subs.find(p => p.id === PRO_MONTHLY_ID) ?? subs[0] ?? null;
    if (!match) {
      console.warn('[IAP] Product not found after both attempts. SKU requested:', PRO_MONTHLY_ID, 'Returned IDs:', subs.map(p => p.id));
    }
    return { product: match, error: null };
  } catch (err: any) {
    const msg = err?.message ?? err?.code ?? String(err);
    console.error('[IAP] fetchProducts error:', msg, err);
    return { product: null, error: msg };
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
/**
 * Initiates a StoreKit 2 subscription purchase.
 * Receipt delivery is handled by the purchaseUpdatedListener in UpgradeSheet.
 */
export async function purchaseProMonthly(): Promise<void> {
  await requestPurchase({
    type: 'subs',
    request: {
      apple: { sku: PRO_MONTHLY_ID },
    },
  });
}

// ─── Verify with backend ──────────────────────────────────────────────────────
/**
 * Sends the StoreKit 2 transaction ID to our backend for App Store Server API
 * verification and tier upgrade. No receipt blob needed.
 */
export async function verifyAppleReceipt(purchase: Purchase): Promise<void> {
  // v14: transaction ID is purchase.id (unified) or transactionId (legacy fallback)
  const transactionId = purchase.id ?? (purchase as any).transactionId;

  if (!transactionId) throw new Error('No transactionId on purchase');

  await apiFetch('/payments/apple-iap/verify', {
    method: 'POST',
    body: JSON.stringify({
      transactionId,
      productId: purchase.productId,
    }),
  });

  // Acknowledge the transaction so Apple doesn't refund it
  await finishTransaction({ purchase, isConsumable: false });
}

// ─── Restore ──────────────────────────────────────────────────────────────────
/**
 * Restores previously completed purchases and re-verifies with the backend.
 * Apple requires this to be available in the UI.
 */
export async function restorePurchases(): Promise<boolean> {
  const purchases = await getAvailablePurchases();
  const proPurchases = purchases.filter(p => APPLE_PRODUCT_IDS.includes(p.productId));

  if (proPurchases.length === 0) return false;

  await verifyAppleReceipt(proPurchases[0]);
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
