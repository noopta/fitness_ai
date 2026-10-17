// What a referral code gives the customer at web checkout. Shared by
// POST /api/payments/create-checkout (which applies it) and the public
// GET /api/affiliate/code/:code/validate (which describes it).
// The Stripe coupon is created with percent_off 20 / duration forever
// (affiliateService.getOrCreateAffiliateCoupon) — keep these in step.
export const REFERRAL_DISCOUNT_PERCENT = 20;
export const REFERRAL_TRIAL_DAYS = 30;

/** Codes are letters/digits plus - and _, 2–32 chars, stored uppercase. */
export const REFERRAL_CODE_RE = /^[A-Z0-9_-]{2,32}$/;

/** Trim + uppercase; '' for anything that can't be a code. */
export function normaliseReferralCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : '';
}
