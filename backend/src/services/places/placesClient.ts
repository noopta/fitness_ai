// Google Places API (New) client for the food finder.
//
// Auth is OAuth via Workload Identity Federation — no API key anywhere. The
// WIF credentials impersonate axiom-service-account@sinuous-concept-497821-s5,
// and billing/quota MUST be attributed to that service account's OWN project,
// not to the project hosting the WIF pool. Pointing X-Goog-User-Project at the
// pool project returns 403 USER_PROJECT_DENIED, which reads like "Places is
// disabled" but is really "this SA can't consume services over there".
//
// Everything here degrades to an empty list rather than throwing: the food
// finder must still return whole-food recommendations when Places is
// misconfigured, rate-limited, or down. A user with no nearby data should get
// a shorter list, never an error page.

import { GoogleAuth } from 'google-auth-library';

// The SA's own project. GCP_PLACES_PROJECT exists so this can be repointed
// without touching the other GCP_* vars, which address the Vertex/GCS projects.
const QUOTA_PROJECT =
  process.env.GCP_PLACES_PROJECT || 'sinuous-concept-497821-s5';

// Lean on purpose — Places bills by field tier. openNow is worth its cost:
// recommending a restaurant that closed an hour ago is a visible failure.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.types',
  'places.location',
  'places.businessStatus',
  'places.regularOpeningHours.openNow',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
].join(',');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

export interface NearbyPlace {
  id: string;
  name: string;
  primaryType: string | null;
  types: string[];
  lat: number;
  lng: number;
  distanceM: number;
  openNow: boolean | null;
  rating: number | null;
  ratingCount: number;
  priceLevel: string | null;
  businessStatus: string | null;
}

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusM: number;
  includedTypes: string[];
  maxResults?: number;
}

/** Metres between two coordinates. Plain haversine — good to a few metres. */
export function haversineM(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Deliberately in-process rather than a Prisma model. Nearby grocers do not
// change over an afternoon, the backend is a single systemd process, and a new
// table would mean a prod `db push` — real risk for a pure cost optimisation.
// A cold start just refills it.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry { at: number; places: NearbyPlace[] }
const cache = new Map<string, CacheEntry>();

/**
 * Round coordinates to a ~1.1 km grid for the cache key.
 *
 * Two purposes: it makes the cache actually hit (nobody stands in the exact
 * same spot twice), and it means precise user coordinates never become a map
 * key we could accidentally log. Distances are still computed from the real
 * position the caller passed.
 */
export function gridKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function cacheKeyFor(q: NearbyQuery): string {
  return `${gridKey(q.lat, q.lng)}|${q.radiusM}|${[...q.includedTypes].sort().join(',')}`;
}

function cacheGet(key: string): NearbyPlace[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.places;
}

function cacheSet(key: string, places: NearbyPlace[]): void {
  // Cheap FIFO eviction — insertion order is Map's iteration order.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), places });
}

/** Test seam — lets suites exercise the cache without hitting the network. */
export function __clearPlacesCache(): void { cache.clear(); }

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

let warnedUnconfigured = false;

async function bearer(): Promise<string | null> {
  try {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    return token ?? null;
  } catch (err) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[places] no usable GCP credentials; nearby results disabled:', (err as Error).message);
    }
    return null;
  }
}

function toNearbyPlace(raw: any, fromLat: number, fromLng: number): NearbyPlace | null {
  const lat = raw?.location?.latitude;
  const lng = raw?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !raw?.id) return null;
  return {
    id: raw.id,
    name: raw.displayName?.text ?? 'Unknown',
    primaryType: raw.primaryType ?? null,
    types: Array.isArray(raw.types) ? raw.types : [],
    lat,
    lng,
    distanceM: haversineM(fromLat, fromLng, lat, lng),
    openNow: raw.regularOpeningHours?.openNow ?? null,
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    ratingCount: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : 0,
    priceLevel: raw.priceLevel ?? null,
    businessStatus: raw.businessStatus ?? null,
  };
}

export interface GeocodedPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

const GEOCODE_FIELD_MASK = 'places.displayName,places.formattedAddress,places.location';
const geocodeCache = new Map<string, GeocodedPlace | null>();

/**
 * Resolve free text ("King & Spadina", "Brooklyn NY") to coordinates.
 *
 * Exists because device geolocation is not always available or willing — the
 * browser prompt can be blocked, dismissed, or silently denied, and a user who
 * cannot get past that has no way into the feature at all. Typing where you are
 * is the reliable fallback, and it also lets you check what the finder would say
 * somewhere you are not.
 *
 * Returns null rather than throwing, same contract as searchNearby.
 */
export async function geocodePlace(query: string): Promise<GeocodedPlace | null> {
  const q = query.trim();
  if (!q) return null;

  const key = q.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  const token = await bearer();
  if (!token) return null;

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': QUOTA_PROJECT,
        'X-Goog-FieldMask': GEOCODE_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 1 }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[places] geocode ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const json = await res.json() as { places?: any[] };
    const p = json.places?.[0];
    const lat = p?.location?.latitude;
    const lng = p?.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      geocodeCache.set(key, null);
      return null;
    }

    const out: GeocodedPlace = {
      name: p.displayName?.text ?? q,
      address: p.formattedAddress ?? '',
      lat,
      lng,
    };
    if (geocodeCache.size < CACHE_MAX_ENTRIES) geocodeCache.set(key, out);
    return out;
  } catch (err) {
    console.warn('[places] geocode failed:', (err as Error).message);
    return null;
  }
}

export interface NearbySearchResult {
  places: NearbyPlace[];
  /**
   * True when the search itself did not succeed (no credentials, HTTP error,
   * timeout). Distinct from a successful search that found nothing: an empty
   * rural area and a Places outage both used to return [], and the UI blamed
   * the API for the user's geography.
   */
  failed: boolean;
}

/**
 * Nearby search. Results are sorted nearest-first; the ranker applies its own
 * distance decay, so this ordering is only a tiebreak for the truncation below.
 */
export async function searchNearbyResult(q: NearbyQuery): Promise<NearbySearchResult> {
  const key = cacheKeyFor(q);
  const cached = cacheGet(key);
  if (cached) return { places: cached, failed: false };

  const token = await bearer();
  if (!token) return { places: [], failed: true };

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': QUOTA_PROJECT,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: q.includedTypes,
        maxResultCount: Math.min(q.maxResults ?? 15, 20),
        locationRestriction: {
          circle: {
            center: { latitude: q.lat, longitude: q.lng },
            radius: q.radiusM,
          },
        },
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      // Log the grid cell, never the caller's exact position.
      console.warn(`[places] searchNearby ${res.status} @ ${gridKey(q.lat, q.lng)}: ${(await res.text()).slice(0, 200)}`);
      return { places: [], failed: true };
    }

    const json = await res.json() as { places?: unknown[] };
    const places = (json.places ?? [])
      .map(p => toNearbyPlace(p, q.lat, q.lng))
      .filter((p): p is NearbyPlace => p !== null)
      // Places still returns shuttered businesses; never recommend one.
      .filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.businessStatus !== 'CLOSED_TEMPORARILY')
      .sort((a, b) => a.distanceM - b.distanceM);

    cacheSet(key, places);
    return { places, failed: false };
  } catch (err) {
    console.warn('[places] searchNearby failed:', (err as Error).message);
    return { places: [], failed: true };
  }
}

/** Places only, [] on any failure — for callers that do not need to tell the two apart. */
export async function searchNearby(q: NearbyQuery): Promise<NearbyPlace[]> {
  return (await searchNearbyResult(q)).places;
}


// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export interface PlaceSuggestion {
  /** Places resource id, passed straight back to us so we never re-guess the text. */
  placeId: string;
  /** "172 Farley Drive" — the bold half in Google's own UI. */
  primary: string;
  /** "Guelph, ON, Canada" */
  secondary: string;
  /** Full single-line label, for a plain list. */
  text: string;
}

/**
 * Address suggestions as the user types.
 *
 * Typing a full address blind is the worst part of the current flow: you cannot
 * tell whether we understood you until after the search runs, and a near-miss
 * ("Farley Dr" vs "Farley Drive") silently searches the wrong town. Suggestions
 * turn that into a choice made before anything is searched.
 *
 * Autocomplete is billed per request, not per keystroke-worth-of-value, so the
 * caller MUST debounce. A `sessionToken` groups the keystrokes of one lookup
 * into a single billable session — omitting it is the expensive mistake here.
 */
export async function autocompletePlaces(
  input: string,
  opts: { lat?: number | null; lng?: number | null; sessionToken?: string } = {},
): Promise<PlaceSuggestion[]> {
  const q = input.trim();
  if (q.length < 3) return [];

  const token = await bearer();
  if (!token) return [];

  try {
    const body: Record<string, unknown> = { input: q };
    if (opts.sessionToken) body.sessionToken = opts.sessionToken;
    // Bias toward where the user already is, when we know — "main street" means
    // the one in their city, not the first one on earth.
    if (typeof opts.lat === 'number' && typeof opts.lng === 'number') {
      body.locationBias = {
        circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: 50_000 },
      };
    }

    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': QUOTA_PROJECT,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      console.warn(`[places] autocomplete ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }

    const json = await res.json() as { suggestions?: any[] };
    return (json.suggestions ?? [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map((p: any): PlaceSuggestion => ({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondary: p.structuredFormat?.secondaryText?.text ?? '',
        text: p.text?.text ?? '',
      }))
      .filter(s => s.placeId && s.text);
  } catch (err) {
    // Same contract as the rest of this module: degrade to typing it yourself.
    console.warn('[places] autocomplete failed:', (err as Error).message);
    return [];
  }
}

/**
 * Resolve a placeId chosen from autocomplete straight to coordinates.
 *
 * Preferred over re-geocoding the text: the user already told us exactly which
 * place they meant, and round-tripping through free text can land somewhere else
 * entirely.
 */
export async function placeDetails(placeId: string): Promise<GeocodedPlace | null> {
  if (!placeId) return null;
  const cacheKey = `id:${placeId}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) ?? null;

  const token = await bearer();
  if (!token) return null;

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Goog-User-Project': QUOTA_PROJECT,
        'X-Goog-FieldMask': 'displayName,formattedAddress,location',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn(`[places] details ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const p = await res.json() as any;
    const lat = p?.location?.latitude;
    const lng = p?.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    const out: GeocodedPlace = {
      name: p.displayName?.text ?? p.formattedAddress ?? '',
      address: p.formattedAddress ?? '',
      lat,
      lng,
    };
    if (geocodeCache.size < CACHE_MAX_ENTRIES) geocodeCache.set(cacheKey, out);
    return out;
  } catch (err) {
    console.warn('[places] details failed:', (err as Error).message);
    return null;
  }
}
