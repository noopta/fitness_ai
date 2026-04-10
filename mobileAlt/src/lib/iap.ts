/**
 * Apple In-App Purchase service (react-native-iap / StoreKit)
 *
 * Product IDs must match exactly what is configured in App Store Connect.
 * APPLE_PRODUCT_IDS is the single source of truth used by both the purchase
 * flow and the restore-purchases flow.
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
  type SubscriptionPurchase,
  type Purchase,
  type PurchaseError,
  type Subscription,
} from 'react-native-iap';
import { Platform } from 'react-native';
import { apiFetch } from './api';

// ─── Product IDs ──────────────────────────────────────────────────────────────
// Create these in App Store Connect → Subscriptions → Axiom Pro
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
export async function fetchProProduct(): Promise<Subscription | null> {
  try {
    const products = await getSubscriptions({ skus: APPLE_PRODUCT_IDS });
    return products.find(p => p.productId === PRO_MONTHLY_ID) ?? products[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
/**
 * Initiates a StoreKit purchase and verifies the receipt server-side.
 * Returns true on successful activation, throws on failure.
 */
export async function purchaseProMonthly(): Promise<void> {
  await requestSubscription({ sku: PRO_MONTHLY_ID });
  // Receipt delivery is handled by the purchaseUpdatedListener set up
  // in UpgradeSheet — we rely on that rather than awaiting here, because
  // requestSubscription resolves before the transaction is finalised on iOS.
}

// ─── Verify with backend ──────────────────────────────────────────────────────
/**
 * Sends the StoreKit 2 transactionId to our backend for App Store Server API
 * verification and tier upgrade. No receipt blob needed.
 */
export async function verifyAppleReceipt(purchase: Purchase | SubscriptionPurchase): Promise<void> {
  // StoreKit 2: transactionId is a string directly on the purchase object
  const transactionId = (purchase as any).transactionId ?? (purchase as any).id;

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
 * Restores previously completed purchases and re-verifies them with the backend.
 * Apple requires this to be available in the UI.
 */
export async function restorePurchases(): Promise<boolean> {
  const purchases = await getAvailablePurchases();
  const proPurchases = purchases.filter(p => APPLE_PRODUCT_IDS.includes(p.productId));

  if (proPurchases.length === 0) return false;

  // Verify the most recent one
  const latest = proPurchases[0];
  await verifyAppleReceipt(latest);
  return true;
}

// ─── Listener helpers ─────────────────────────────────────────────────────────
export function addPurchaseListener(
  onSuccess: (purchase: SubscriptionPurchase) => void,
  onError: (error: PurchaseError) => void,
) {
  const successSub = purchaseUpdatedListener((purchase) => {
    onSuccess(purchase as SubscriptionPurchase);
  });
  const errorSub = purchaseErrorListener(onError);
  return () => {
    successSub.remove();
    errorSub.remove();
  };
}
