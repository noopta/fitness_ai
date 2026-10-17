import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { getStoredReferralCode, normaliseReferralCode } from '@/lib/referral';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

/**
 * Start a Stripe Checkout session via `/payments/create-checkout` and redirect
 * the current tab to it.
 *
 * Replaces the previous `window.open('https://buy.stripe.com/...', '_blank')`
 * flow, which had two real problems we found in PostHog session replay and a
 * customer billing investigation:
 *
 *   1. `_blank` opens are **silently blocked** by popup blockers, mobile
 *      Safari, and every in-app browser (Instagram, Facebook, …). When a
 *      popup is blocked the user sees the click do absolutely nothing —
 *      this is exactly the "click CTA, abandon immediately" pattern in the
 *      session replays.
 *   2. The direct Stripe payment link creates a **brand-new Stripe customer
 *      every time it's used** with no "already subscribed" check, which is
 *      how at least one customer ended up with two active subscriptions
 *      billing them in parallel. The `/payments/create-checkout` route
 *      reuses the existing Stripe customer, sets metadata, and blocks
 *      already-pro users.
 *
 * Same-tab navigation also means PostHog session replay can see the redirect
 * happen, so the funnel is no longer a black hole at the CTA click.
 */
export interface CheckoutOptions {
  /**
   * Affiliate referral code. Callers pass the code shown in their
   * ReferralCodeField; when omitted, the stored `axiom_referral` code is used.
   * `null` means "explicitly no code".
   */
  referralCode?: string | null;
  /** Path Stripe returns to (default: backend's /dashboard). */
  returnPath?: string;
}

/** Body for POST /payments/create-checkout. Exported for tests and the diagnostic paywall. */
export function checkoutBody(opts: CheckoutOptions = {}): Record<string, string> {
  const code = opts.referralCode === undefined ? getStoredReferralCode() : normaliseReferralCode(opts.referralCode);
  return {
    ...(code ? { referralCode: code } : {}),
    ...(opts.returnPath ? { returnPath: opts.returnPath } : {}),
  };
}

export async function startProCheckout(opts: CheckoutOptions = {}): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE}/payments/create-checkout`, {
      method: 'POST',
      body: JSON.stringify(checkoutBody(opts)),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let parsed: any = {};
      try { parsed = JSON.parse(body); } catch { /* not JSON */ }
      throw new Error(parsed.error || `Could not start checkout (${res.status})`);
    }
    const { url } = await res.json();
    if (!url) throw new Error('No checkout URL returned');
    window.location.href = url;
    return true;
  } catch (err: any) {
    toast.error(err?.message || 'Could not start checkout. Please try again.');
    return false;
  }
}
