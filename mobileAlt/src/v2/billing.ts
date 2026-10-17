// Manage subscription, aware of how the user pays. Only Stripe subscribers
// (paid on the web) get a link — the Stripe customer portal. App Store /
// Google Play subscribers get plain text pointing them at their store
// (store policy: no external billing links for IAP subscribers). v2's Billing
// page, the manage_subscription card and classic Settings all use this.

import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { paymentsApi } from '../lib/api';

export type ManagedVia = 'stripe' | 'app_store' | 'google_play';

/** Plain-text instruction for store (IAP) subscribers — never a link. */
export const STORE_MANAGE_TEXT = Platform.OS === 'android'
  ? 'Manage your subscription in Google Play.'
  : 'Manage your subscription in the App Store.';

/** True only when the user's subscription is a live Stripe one. */
export async function isStripeSubscriber(): Promise<boolean> {
  try {
    const status: any = await paymentsApi.getPaymentsStatus();
    return ['active', 'trialing', 'past_due'].includes(status?.subStatus);
  } catch {
    return false;
  }
}

/**
 * Stripe subscriber → opens the Stripe portal and resolves 'stripe'.
 * Anyone else → opens nothing; resolves the store so the caller shows
 * STORE_MANAGE_TEXT.
 */
export async function manageSubscription(): Promise<ManagedVia> {
  if (await isStripeSubscriber()) {
    try {
      const portal: any = await paymentsApi.getPaymentsPortal();
      if (portal?.url) { await WebBrowser.openBrowserAsync(portal.url); return 'stripe'; }
    } catch { /* portal unavailable — fall through to the store text */ }
  }
  return Platform.OS === 'android' ? 'google_play' : 'app_store';
}

export const managedViaLabel = (v: ManagedVia) => (v === 'stripe' ? 'Opened billing' : STORE_MANAGE_TEXT);
