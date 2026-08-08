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

/**
 * Nearby search. Returns [] on any failure — see the module header.
 *
 * Results are sorted nearest-first; the ranker applies its own distance decay,
 * so this ordering is only a tiebreak for the truncation below.
 */
export async function searchNearby(q: NearbyQuery): Promise<NearbyPlace[]> {
  const key = cacheKeyFor(q);
  const cached = cacheGet(key);
  if (cached) return cached;

  const token = await bearer();
  if (!token) return [];

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
      return [];
    }

    const json = await res.json() as { places?: unknown[] };
    const places = (json.places ?? [])
      .map(p => toNearbyPlace(p, q.lat, q.lng))
      .filter((p): p is NearbyPlace => p !== null)
      // Places still returns shuttered businesses; never recommend one.
      .filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.businessStatus !== 'CLOSED_TEMPORARILY')
      .sort((a, b) => a.distanceM - b.distanceM);

    cacheSet(key, places);
    return places;
  } catch (err) {
    console.warn('[places] searchNearby failed:', (err as Error).message);
    return [];
  }
}
