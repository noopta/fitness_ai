/**
 * Weight-unit helpers — the single source of truth for kg⇄lb conversion and
 * display formatting on the backend.
 *
 * Canonical storage is ALWAYS kilograms. This module exists so server-generated
 * user-facing text (LLM prompts/replies, push notifications) can render weights
 * in the user's preferred unit. Clients do their own display conversion; the
 * backend only formats the copy it emits.
 */

export type UnitPreference = 'metric' | 'imperial';

/** Exact pound, per the international avoirdupois definition. */
export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB; // 2.2046226218…

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Normalise any stored/loose value to a known preference (defaults imperial). */
export function normalizePreference(pref: string | null | undefined): UnitPreference {
  return pref === 'metric' ? 'metric' : 'imperial';
}

/** The short unit label for a preference. */
export function unitLabel(pref: UnitPreference): 'kg' | 'lbs' {
  return pref === 'metric' ? 'kg' : 'lbs';
}

/**
 * Convert a canonical kg value into the display unit's numeric value,
 * rounded to `decimals` (default 0). Does not append a label.
 */
export function displayWeight(kg: number, pref: UnitPreference, decimals = 0): number {
  const val = pref === 'metric' ? kg : kgToLb(kg);
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

/**
 * Format a canonical kg value as user-facing copy, e.g. "185 lbs" / "84 kg".
 * Returns null for null/NaN input so callers can omit the field.
 */
export function formatWeight(
  kg: number | null | undefined,
  pref: UnitPreference,
  decimals = 0,
): string | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return `${displayWeight(kg, pref, decimals)} ${unitLabel(pref)}`;
}

/**
 * Convert a user-entered value (in their display unit) back to canonical kg.
 * Returns null for non-finite input.
 */
export function parseToKg(value: number | null | undefined, pref: UnitPreference): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return pref === 'metric' ? value : lbToKg(value);
}

/**
 * Canonical kg for a BodyWeightLog-shaped row during the weightLbs→weightKg
 * transition: prefer the new `weightKg`, fall back to converting the legacy
 * `weightLbs` for rows not yet touched by scripts/backfillBodyWeightKg.ts.
 * Returns null when neither is a finite number.
 */
export function bodyWeightKg(
  row: { weightKg?: number | null; weightLbs?: number | null } | null | undefined,
): number | null {
  if (!row) return null;
  if (row.weightKg != null && Number.isFinite(row.weightKg)) return row.weightKg;
  if (row.weightLbs != null && Number.isFinite(row.weightLbs)) return lbToKg(row.weightLbs);
  return null;
}

// ── Locale-based default detection ──────────────────────────────────────────────
// The product is US-first, so imperial is the default. We flip to metric only
// when a signup's locale clearly comes from a metric region — chiefly the EU/EEA
// (the European users this feature is for), plus a few obvious metric markets.
// Unknown/US → imperial. Users can always override in Settings afterward.
const METRIC_REGIONS = new Set([
  // EU + EEA + UK + CH
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
  // Other clearly-metric markets we ship to
  // (Canada and Mexico are North America: lb by product decision, Oct 2026.)
  'AU', 'NZ', 'JP', 'CN', 'IN', 'BR', 'ZA', 'KR', 'SG',
]);

/** ISO-3166 region of a metric country? (case-insensitive) */
export function isMetricRegion(region: string | null | undefined): boolean {
  return !!region && METRIC_REGIONS.has(region.toUpperCase());
}

/**
 * Pick a default unit preference from an Accept-Language header. We read the
 * region subtag of the highest-priority locale (e.g. "de-DE" → DE → metric,
 * "en-US" → US → imperial). No region / unrecognised → imperial (US-first).
 */
export function detectUnitPreferenceFromAcceptLanguage(
  header: string | null | undefined,
): UnitPreference {
  if (!header) return 'imperial';
  // Take locales in order; first one with a region subtag decides.
  const tags = header.split(',').map((part) => part.split(';')[0].trim()).filter(Boolean);
  for (const tag of tags) {
    const region = tag.split('-')[1];
    if (region && region.length === 2) {
      return isMetricRegion(region) ? 'metric' : 'imperial';
    }
  }
  return 'imperial';
}

// ── Location → units (Oct 2026) ─────────────────────────────────────────────
// Product decision: anyone in North America (US, Canada, Mexico) defaults to
// lb; elsewhere to kg (with the few non-metric exceptions). The phone's IANA
// timezone is the strongest location signal we get on every request (it's
// where the user is, not what language their phone speaks); the locale's
// region is the fallback. A manual choice always wins (users.unitsManual).

const NA_PREFIXES = ['America/Indiana/', 'America/Kentucky/', 'America/North_Dakota/'];
const NA_ZONES = new Set([
  // US
  'America/New_York', 'America/Detroit', 'America/Chicago', 'America/Menominee', 'America/Denver', 'America/Boise', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome',
  'America/Adak', 'Pacific/Honolulu', 'America/Puerto_Rico', 'America/St_Thomas', 'Pacific/Guam', 'Pacific/Saipan', 'Pacific/Pago_Pago',
  'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific', 'US/Alaska', 'US/Hawaii', 'US/Arizona', 'US/Michigan',
  // Canada
  'America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Regina', 'America/Halifax',
  'America/St_Johns', 'America/Moncton', 'America/Glace_Bay', 'America/Goose_Bay', 'America/Whitehorse', 'America/Dawson', 'America/Dawson_Creek',
  'America/Fort_Nelson', 'America/Creston', 'America/Yellowknife', 'America/Inuvik', 'America/Cambridge_Bay', 'America/Iqaluit',
  'America/Rankin_Inlet', 'America/Resolute', 'America/Swift_Current', 'America/Atikokan', 'America/Blanc-Sablon', 'America/Nipigon',
  'America/Thunder_Bay', 'America/Rainy_River', 'America/Pangnirtung', 'Canada/Eastern', 'Canada/Central', 'Canada/Mountain', 'Canada/Pacific',
  'Canada/Atlantic', 'Canada/Newfoundland', 'Canada/Saskatchewan', 'Canada/Yukon',
  // Mexico
  'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros', 'America/Chihuahua', 'America/Ciudad_Juarez',
  'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana', 'Mexico/General', 'Mexico/BajaNorte', 'Mexico/BajaSur',
]);
/** Zones outside North America that still use pounds day to day. */
const IMPERIAL_ZONES = new Set(['Africa/Monrovia', 'Asia/Yangon', 'Asia/Rangoon']);

/** Pure: is this IANA zone in North America (US, Canada, Mexico)? */
export function isNorthAmericaTz(tz: string | null | undefined): boolean {
  if (!tz) return false;
  return NA_ZONES.has(tz) || NA_PREFIXES.some((p) => tz.startsWith(p));
}

/**
 * Pure: the unit preference for where the user is. Timezone first (North
 * America → imperial, a few lb-using countries → imperial, any other real
 * zone → metric), then the locale region, then imperial (US-first default).
 */
export function detectUnitPreference(opts: { timezone?: string | null; acceptLanguage?: string | null }): UnitPreference {
  const tz = opts.timezone?.trim();
  if (tz && tz !== 'UTC' && tz !== 'Etc/UTC' && tz.includes('/')) {
    if (isNorthAmericaTz(tz) || IMPERIAL_ZONES.has(tz)) return 'imperial';
    return 'metric';
  }
  return detectUnitPreferenceFromAcceptLanguage(opts.acceptLanguage);
}

/** Pure: which unit a message's weights are written in, when it says ("185 lb", "84 kg"), else null. */
export function unitWrittenIn(text: string): UnitPreference | null {
  const lb = /\b\d{1,3}(?:\.\d)?\s*(?:lb|lbs|pounds?)\b/i.test(text);
  const kg = /\b\d{1,3}(?:\.\d)?\s*(?:kg|kgs|kilos?|kilograms?)\b/i.test(text);
  return lb === kg ? null : lb ? 'imperial' : 'metric';
}
