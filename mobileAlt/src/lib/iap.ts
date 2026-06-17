/**
 * Apple In-App Purchase service (react-native-iap v13 / StoreKit)
 *
 * Downgraded from v14 → v13 to remove react-native-nitro-modules: v14's Nitro
 * (Swift HybridObject) layer crashed at launch under `useFrameworks: static`
 * (required by Firebase) + the New Architecture. v13 uses the standard
 * TurboModule bridge and links cleanly under static frameworks.
 *
 * v13 API (differs from the v14 we came from):
 *  - getSubscriptions({ skus })            (was fetchProducts({ skus, type: 'subs' }))
 *  - requestSubscription({ sku })          (was requestPurchase({ type, request: { apple: { sku } } }))
 *  - Subscription type                     (was ProductSubscription)
 *  - product.productId                     (was product.id)
 *  - product.localizedPrice (iOS)          (was product.displayPrice)
 *  - purchase.transactionId                (was purchase.id)
 */
import {
  initConnection,
  endConnection,
  getSubscriptions,
  requestSubscription,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Subscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { Platform } from 'react-native';
import { apiFetch } from './api';
import { iapLog, iapWarn, iapError } from './debugLog';

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
    iapLog('initConnection — start');
    await initConnection();
    connectionInitialised = true;
    // Brief pause — StoreKit needs a tick to settle before product fetches
    // will succeed on first launch (cold-start race).
    await new Promise<void>(r => setTimeout(r, 800));
    iapLog('initConnection — ready');
    return true;
  } catch (err: any) {
    iapError('initConnection failed:', err?.message ?? String(err));
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
 *  1. getSubscriptions({ skus }) — the v13 subscription fetch.
 *  2. If empty, retry once after 500ms — guards the occasional empty first
 *     response on a cold StoreKit connection.
 *  3. Match by productId; accept the first result if exact match not found.
 */
export async function fetchProProduct(): Promise<{ product: Subscription | null; error: string | null }> {
  try {
    iapLog('getSubscriptions — skus:', APPLE_PRODUCT_IDS);
    let products = (await getSubscriptions({ skus: APPLE_PRODUCT_IDS })) ?? [];
    iapLog(`getSubscriptions — returned ${products.length} item(s):`, products.map((p: any) => p.productId));

    // Retry once if the first response is empty (cold-start race).
    if (products.length === 0) {
      iapWarn('subs fetch empty — retrying after 500ms');
      await new Promise<void>(r => setTimeout(r, 500));
      products = (await getSubscriptions({ skus: APPLE_PRODUCT_IDS })) ?? [];
      iapLog(`getSubscriptions (retry) — returned ${products.length} item(s):`, products.map((p: any) => p.productId));
    }

    const match = products.find(p => p.productId === PRO_MONTHLY_ID) ?? products[0] ?? null;
    if (match) {
      iapLog('product found:', match.productId, 'price:', (match as any).localizedPrice);
      return { product: match, error: null };
    }
    // No product came back. Surface an error so the paywall shows a Retry
    // instead of silently hiding the App Store option entirely.
    iapWarn('product NOT found after both attempts. Wanted:', PRO_MONTHLY_ID, '— got IDs:', products.map((p: any) => p.productId));
    return {
      product: null,
      error: 'App Store subscription unavailable right now. Tap Retry, or pay with card below.',
    };
  } catch (err: any) {
    const msg = err?.message ?? err?.code ?? String(err);
    iapError('getSubscriptions threw:', msg, 'code:', err?.code, 'full:', JSON.stringify(err));
    return { product: null, error: msg };
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
/**
 * Initiates a StoreKit subscription purchase.
 * Receipt delivery is handled by the purchaseUpdatedListener in UpgradeSheet.
 */
export async function purchaseProMonthly(): Promise<void> {
  iapLog('requestSubscription — sku:', PRO_MONTHLY_ID);
  await requestSubscription({ sku: PRO_MONTHLY_ID });
}

// ─── Verify with backend ──────────────────────────────────────────────────────
/**
 * Sends the StoreKit transaction ID to our backend for App Store Server API
 * verification and tier upgrade. No receipt blob needed.
 */
export async function verifyAppleReceipt(purchase: Purchase): Promise<void> {
  const transactionId = purchase.transactionId ?? (purchase as any).id;
  iapLog('verifyAppleReceipt — transactionId:', transactionId, 'productId:', purchase.productId);

  if (!transactionId) {
    iapError('verifyAppleReceipt — no transactionId on purchase object:', JSON.stringify(purchase));
    throw new Error('No transactionId on purchase');
  }

  try {
    await apiFetch('/payments/apple-iap/verify', {
      method: 'POST',
      body: JSON.stringify({ transactionId, productId: purchase.productId }),
    });
    iapLog('verifyAppleReceipt — backend verified OK');
  } catch (err: any) {
    iapError('verifyAppleReceipt — backend error:', err?.message ?? String(err));
    throw err;
  }

  await finishTransaction({ purchase, isConsumable: false });
  iapLog('finishTransaction — done');
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
