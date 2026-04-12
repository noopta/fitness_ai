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
export async function fetchProProduct(): Promise<{ product: ProductSubscription | null; error: string | null }> {
  try {
    const products = await fetchProducts({ skus: APPLE_PRODUCT_IDS, type: 'subs' });
    console.log('[IAP] fetchProducts result:', JSON.stringify(products));
    const subs = products as ProductSubscription[];
    const match = subs.find(p => p.id === PRO_MONTHLY_ID) ?? subs[0] ?? null;
    if (!match) {
      console.warn('[IAP] Product not found. Returned SKUs:', subs.map(p => p.id));
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
