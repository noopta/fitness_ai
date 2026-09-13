/**
 * Currency and metro resolution from coordinates.
 *
 * A user should never have to tell us they are spending dollars in Toronto. The
 * budget they type is in the currency of the ground they are standing on, and
 * asking them to confirm that is friction with no information in it.
 *
 * We do not do FX. A budget is compared only against prices quoted in the same
 * currency, and a metro's price table is denominated in that metro's currency,
 * so there is never a conversion to get wrong.
 */

export interface Metro {
  /** Stable key used by IngredientPrice.metro. */
  slug: string;
  label: string;
  lat: number;
  lng: number;
  currency: string;
  /** ISO-3166 alpha-2, used for the currency fallback outside known metros. */
  country: string;
}

/**
 * Seeded metros. Coverage is deliberately narrow: price tables are per-metro and
 * a metro with no table is worse than no metro at all, because it would quote
 * confident prices from the wrong economy. Add a metro only alongside its table.
 */
export const METROS: readonly Metro[] = [
  { slug: 'toronto-on-ca',     label: 'Toronto',       lat: 43.6532, lng: -79.3832, currency: 'CAD', country: 'CA' },
  { slug: 'vancouver-bc-ca',   label: 'Vancouver',     lat: 49.2827, lng: -123.1207, currency: 'CAD', country: 'CA' },
  { slug: 'montreal-qc-ca',    label: 'Montreal',      lat: 45.5019, lng: -73.5674, currency: 'CAD', country: 'CA' },
  { slug: 'new-york-ny-us',    label: 'New York',      lat: 40.7128, lng: -74.0060, currency: 'USD', country: 'US' },
  { slug: 'los-angeles-ca-us', label: 'Los Angeles',   lat: 34.0522, lng: -118.2437, currency: 'USD', country: 'US' },
  { slug: 'chicago-il-us',     label: 'Chicago',       lat: 41.8781, lng: -87.6298, currency: 'USD', country: 'US' },
  { slug: 'austin-tx-us',      label: 'Austin',        lat: 30.2672, lng: -97.7431, currency: 'USD', country: 'US' },
  { slug: 'london-uk',         label: 'London',        lat: 51.5074, lng: -0.1278,  currency: 'GBP', country: 'GB' },
];

/** Currency of last resort when the user is outside every seeded metro. */
export const DEFAULT_CURRENCY = 'USD';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Nearest seeded metro, or null when nothing is close enough to speak for the
 * local economy. 150 km is roughly "same metropolitan price regime" — beyond
 * that we would rather quote no price than a confidently wrong one.
 */
export function nearestMetro(lat: number, lng: number, maxDistanceM = 150_000): Metro | null {
  let best: Metro | null = null;
  let bestD = Infinity;
  for (const m of METROS) {
    const d = haversineM(lat, lng, m.lat, m.lng);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best && bestD <= maxDistanceM ? best : null;
}

export function currencyFor(lat: number, lng: number): string {
  return nearestMetro(lat, lng)?.currency ?? DEFAULT_CURRENCY;
}

const SYMBOLS: Record<string, string> = { USD: '$', CAD: '$', GBP: '£', EUR: '€', AUD: '$' };

/** Minor units → display string. Whole amounts drop the decimals: $12, not $12.00. */
export function formatMoney(cents: number, currency: string): string {
  const sym = SYMBOLS[currency] ?? '';
  const v = cents / 100;
  const body = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const prefix = sym || `${currency} `;
  return `${prefix}${body}`;
}
