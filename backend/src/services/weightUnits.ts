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
  'AU', 'NZ', 'CA', 'JP', 'CN', 'IN', 'BR', 'MX', 'ZA', 'KR', 'SG',
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
