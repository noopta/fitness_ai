/**
 * Deep links to turn-by-turn directions.
 *
 * Deliberately a URL builder and nothing more. Rendering a map ourselves would
 * mean a Maps JS bill, a tile budget and an embedded map to maintain, to deliver
 * something worse than the maps app the user already has open on their phone.
 *
 * Prefer the Places id when we have it: coordinates put a pin on a rooftop,
 * whereas the place id resolves to the actual business, with its hours and
 * entrance and reviews attached.
 */

export interface DirectionsTarget {
  name: string;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}

/**
 * Universal Google Maps directions URL.
 *
 * Works on iOS, Android and desktop web; on a phone with Google Maps installed
 * the OS hands it to the app. `api=1` is the documented, stable form — the older
 * `maps.google.com/?q=` style is not.
 *
 * Returns null when there is nothing to point at; a link to nowhere is worse
 * than no link, because the user finds out only after tapping it.
 */
export function directionsUrl(target: DirectionsTarget): string | null {
  const { name, lat, lng, placeId } = target;
  const base = 'https://www.google.com/maps/dir/?api=1';

  if (placeId) {
    // destination is still required alongside destination_place_id.
    return `${base}&destination=${encodeURIComponent(name)}&destination_place_id=${encodeURIComponent(placeId)}`;
  }
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${base}&destination=${lat},${lng}`;
  }
  if (name.trim()) return `${base}&destination=${encodeURIComponent(name)}`;
  return null;
}
