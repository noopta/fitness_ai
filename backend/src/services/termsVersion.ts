// The Terms of Service version users accept (shown on the Terms page as LEGAL.termsVersion
// in frontend-v2). Bump it when the Terms change materially; consent records and
// safety acknowledgements are stamped with it.
// 2026-10-20: §4 health screening, red flags and weight cutting; Privacy §2 safety records.
// TERMS_VERSION in .env holds the live version back until the matching Terms
// page is published on the web (Replit) — the app asks users to re-accept as
// soon as this changes, and they must be able to read what they accept.
export const CURRENT_TERMS_VERSION = process.env.TERMS_VERSION || '2026-10-20';
