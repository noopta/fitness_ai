// Single source of truth for the web Pro price + auto-renew disclosure.
// Stripe bills 1299 cents/month (same as mobile's STRIPE_PRICE_CENTS); older
// web copy said "$12", which understated the charge.
export const PRO_PRICE = '$12.99';
export const PRO_PRICE_MONTHLY = `${PRO_PRICE}/month`;
export const AUTO_RENEW_DISCLOSURE =
  `Subscription renews monthly at ${PRO_PRICE_MONTHLY} until cancelled. Cancel anytime in Settings → Billing.`;
