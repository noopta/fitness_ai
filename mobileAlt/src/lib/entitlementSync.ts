// Pro follows the user back into the app.
//
// A payment can complete while the app is not looking: Stripe checkout in a
// browser tab (the webhook upgrades the account on the server), an App Store
// or Play purchase that finished after the upgrade sheet closed, or one whose
// verification failed on a bad connection. In each case the account is Pro
// (or should be) but the app is still showing the free one.
//
// So when the app returns to the foreground it re-reads the account, and a
// user who is still free has the store asked, at most every 10 minutes, for a
// Pro purchase the server has not seen. StoreKit 2 / Play Billing answer that
// from the device without a sign-in prompt. A purchase the server refuses (a
// test purchase, an expired one) is not sent again this launch.

import { Platform } from 'react-native';
import { iapLog, iapWarn } from './debugLog';

const STORE_CHECK_EVERY_MS = 10 * 60_000;
let lastStoreCheck = 0;
let checking = false;
const refused = new Set<string>();

/** For tests and sign-out: forget throttling and refusals. */
export function resetEntitlementSync() {
  lastStoreCheck = 0;
  refused.clear();
}

/** True when an unverified Pro purchase was found and the server accepted it. */
export async function syncStoreEntitlement(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  if (checking || Date.now() - lastStoreCheck < STORE_CHECK_EVERY_MS) return false;
  checking = true;
  lastStoreCheck = Date.now();
  try {
    const store = Platform.OS === 'ios'
      ? await import('./iap').then((m) => ({ init: m.initIAP, active: m.activeProPurchases, verify: m.verifyAppleReceipt }))
      : await import('./googleIap').then((m) => ({ init: m.initIAP, active: m.activeProPurchases, verify: m.verifyGoogleReceipt }));
    if (!(await store.init())) return false;
    for (const purchase of await store.active()) {
      const key = String((purchase as any).id ?? (purchase as any).purchaseToken ?? (purchase as any).transactionId ?? '');
      if (!key || refused.has(key)) continue;
      try {
        await store.verify(purchase);
        iapLog('[entitlement] verified a Pro purchase on return to the app');
        return true;
      } catch (err: any) {
        refused.add(key);
        iapWarn('[entitlement] store purchase not accepted:', err?.message ?? String(err));
      }
    }
    return false;
  } catch (err: any) {
    iapWarn('[entitlement] store check failed:', err?.message ?? String(err));
    return false;
  } finally {
    checking = false;
  }
}
