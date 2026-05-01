export const APPLE_PRODUCT_IDS: string[] = [];
export const PRO_MONTHLY_ID = 'io.axiomtraining.app.pro.monthly';

export interface IAPProduct {
  productId: string;
  localizedPrice: string;
  title: string;
  description: string;
}

export async function initIAP(): Promise<boolean> { return false; }
export function teardownIAP(): void {}
export async function fetchProProduct(): Promise<{ product: null; error: string | null }> {
  return { product: null, error: null };
}
export async function purchaseProMonthly(): Promise<void> {}
export async function verifyAppleReceipt(_purchase: any): Promise<void> {}
export async function restorePurchases(): Promise<boolean> { return false; }
export function addPurchaseListener(
  _onSuccess: (purchase: any) => void,
  _onError: (error: any) => void,
): () => void {
  return () => {};
}
