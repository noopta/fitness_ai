// Affiliate referral codes on the web. Affiliates tell people to type their
// code (e.g. SAEED10) at checkout; a ?ref= link only pre-fills it. The code
// lives in localStorage `axiom_referral` so it survives sign-up and travels
// into POST /payments/create-checkout (which applies 20% off for life + a
// 30-day trial) and POST /auth/register (stored as referredByCode).
const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

export const REFERRAL_STORAGE_KEY = 'axiom_referral';
const CODE_RE = /^[A-Z0-9_-]{2,32}$/;

/** Trim + uppercase; '' when it can't be a code. */
export function normaliseReferralCode(raw: string | null | undefined): string {
  const code = (raw ?? '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : '';
}

export function getStoredReferralCode(): string | null {
  try {
    return normaliseReferralCode(localStorage.getItem(REFERRAL_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

export function storeReferralCode(code: string | null): void {
  try {
    const c = normaliseReferralCode(code);
    if (c) localStorage.setItem(REFERRAL_STORAGE_KEY, c);
    else localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch { /* storage blocked: the code still travels in component state */ }
}

export interface ReferralValidation {
  valid: boolean;
  code?: string;
  discountPercent?: number;
  trialDays?: number;
  affiliateFirstName?: string | null;
}

/** Public lookup. Throws on network/5xx/429 so callers can tell "unknown" from "couldn't check". */
export async function validateReferralCode(raw: string): Promise<ReferralValidation> {
  const code = normaliseReferralCode(raw);
  if (!code) return { valid: false };
  const res = await fetch(`${API_BASE}/affiliate/code/${encodeURIComponent(code)}/validate`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as any));
    throw new Error(body?.error || 'Could not check that code right now');
  }
  const body = (await res.json()) as ReferralValidation;
  return body?.valid ? { ...body, code: body.code ?? code } : { valid: false };
}

export function offerLine(v: Pick<ReferralValidation, 'discountPercent' | 'trialDays'> | null | undefined): string {
  const pct = v?.discountPercent ?? 20;
  const days = v?.trialDays ?? 30;
  return `${pct}% off for life + ${days}-day trial applied`;
}
