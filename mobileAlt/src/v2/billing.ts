// Manage subscription, aware of how the user pays. Stripe subscribers (paid on
// the web) get the Stripe customer portal; App Store / Google Play subscribers
// get their store's subscription page. Opening the store page for a Stripe
// subscriber shows an empty list — classic fixed that in Settings; v2's Billing
// page and the manage_subscription card both use this so neither repeats it.

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { paymentsApi } from '../lib/api';

export type ManagedVia = 'stripe' | 'app_store' | 'google_play';

export async function manageSubscription(): Promise<ManagedVia> {
  try {
    const status: any = await paymentsApi.getPaymentsStatus();
    if (['active', 'trialing', 'past_due'].includes(status?.subStatus)) {
      const portal: any = await paymentsApi.getPaymentsPortal();
      if (portal?.url) { await WebBrowser.openBrowserAsync(portal.url); return 'stripe'; }
    }
  } catch { /* status or portal unavailable — fall through to the store rather than dead-end */ }
  if (Platform.OS === 'android') {
    await Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() => {});
    return 'google_play';
  }
  await Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => Linking.openURL('App-prefs:root=APPLE_ACCOUNT&path=SUBSCRIPTIONS').catch(() => {}));
  return 'app_store';
}

export const managedViaLabel = (v: ManagedVia) => (v === 'stripe' ? 'Opened billing' : v === 'app_store' ? 'Opened App Store' : 'Opened Google Play');
