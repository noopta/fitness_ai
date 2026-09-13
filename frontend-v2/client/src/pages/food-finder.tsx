// Food Finder — "what should I eat right now, near me".
//
// Asks the browser for a location, sends it to /nutrition-profile/food-finder,
// and renders the merged ranked list: whole foods attached to a shop that
// plausibly stocks them, and typical dishes at real nearby restaurants.
//
// The copy here deliberately mirrors the server's honesty constraint. We have
// no menu feed and no stock feed, so the server sends a `note` scoped to what
// it can stand behind ("typical for … — estimated, not their menu", "usually
// carried at …"). This page renders that note verbatim rather than writing its
// own claim, and shows the confidence tier on estimated items.

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface CloseLine {
  key: string;
  label: string;
  amount: number;
  unit: string;
  pctOfRemaining: number;
}

interface WarnLine { key: string; label: string; text: string }

interface Recommendation {
  id: string;
  kind: 'ingredient' | 'takeout';
  name: string;
  serving: string;
  category: string;
  kcal: number;
  gain: string;
  closes: CloseLine[];
  warns: WarnLine[];
  mechanism: string;
  score: number;
  where: { name: string; distanceM: number; openNow: boolean | null; rating: number | null } | null;
  note: string | null;
  confidence: 'usda' | 'published' | 'estimated';
}

interface FinderResponse {
  date: string;
  mode: string;
  why: string;
  pressures: { macro: number; micro: number };
  remaining: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  nearby: {
    used: boolean;
    degraded: boolean;
    storesFound: number;
    restaurantsFound: number;
    resolvedPlace: { name: string; address: string } | null;
    coords: { lat: number; lng: number } | null;
  };
  recommendations: Recommendation[];
}

/**
 * Turn a GeolocationPositionError into something a user can act on.
 * "Nothing happened" is the worst possible outcome here — the browser prompt
 * can be blocked, dismissed, or disabled at the OS level, and every one of
 * those looks identical from inside the page unless we say which it was.
 */
function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case 1: return 'Location permission was denied. Enable it in Settings → Safari → Location, or type where you are below.';
    case 2: return "Your device couldn't get a fix. Type where you are below.";
    case 3: return 'Location timed out. Type where you are below.';
    default: return `Location failed (${err.message}). Type where you are below.`;
  }
}

/** Accept a pasted "43.65, -79.38" so coordinates don't need a round-trip. */
function parseCoordPair(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const MODE_LABEL: Record<string, string> = {
  macro_priority: 'Macros lead',
  micro_priority: 'Micronutrients lead',
  tight_budget: 'Tight calorie budget',
  balanced: 'Balanced',
  on_track: 'On track',
};

const distance = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export default function FoodFinderPage() {
  const [data, setData] = useState<FinderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locState, setLocState] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle');
  const [locNote, setLocNote] = useState<string | null>(null);
  const [placeInput, setPlaceInput] = useState('');

  // Same bootstrap the OAuth redirect uses, so a single link works on a phone
  // without a separate login round-trip.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) {
      sessionStorage.setItem('liftoff_bearer_token', t);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const load = useCallback(async (where: { lat: number; lng: number } | { place: string } | null) => {
    setLoading(true);
    setError(null);
    try {
      let qs = '';
      if (where && 'lat' in where) qs = `?lat=${where.lat}&lng=${where.lng}`;
      else if (where) qs = `?place=${encodeURIComponent(where.place)}`;
      const res = await authFetch(`${API_BASE}/nutrition-profile/food-finder${qs}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body: FinderResponse = await res.json();
      setData(body);
      // A typed place that resolves to nothing must say so, or the user is left
      // wondering whether the finder ignored them or genuinely found nothing.
      if (where && 'place' in where && !body.nearby.used) {
        setError(`Couldn't find "${where.place}". Try a more specific address, or paste "lat, lng".`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const useMyLocation = useCallback(() => {
    setError(null);
    if (!navigator.geolocation) {
      setLocState('denied');
      setLocNote('This browser has no location support. Type where you are below.');
      void load(null);
      return;
    }
    setLocState('asking');
    setLocNote('Waiting for your device… if no prompt appears, type where you are below.');

    // A hard backstop: on iOS the callbacks can simply never fire when the site
    // is blocked at the OS level, and the built-in `timeout` does not always
    // cover that. Without this the page just sits there — which is exactly the
    // "didn't do anything" failure.
    let settled = false;
    const backstop = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setLocState('denied');
      setLocNote('No response from your device’s location. Type where you are below.');
    }, 12000);

    navigator.geolocation.getCurrentPosition(
      pos => {
        if (settled) return;
        settled = true;
        window.clearTimeout(backstop);
        setLocState('granted');
        setLocNote(null);
        void load({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        if (settled) return;
        settled = true;
        window.clearTimeout(backstop);
        setLocState('denied');
        setLocNote(geoErrorMessage(err));
        // Still answer. Denial is a normal choice, and the location-free list
        // is a real result — the note above just offers a better one.
        void load(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [load]);

  const submitPlace = useCallback(() => {
    const text = placeInput.trim();
    if (!text) return;
    setLocNote(null);
    const pair = parseCoordPair(text);
    // Coordinates go straight through; anything else is geocoded server-side.
    void load(pair ?? { place: text });
  }, [placeInput, load]);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Food Finder</h1>
      <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>What to eat right now, based on what you've already eaten today.</p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0 10px' }}>
        <button
          onClick={useMyLocation}
          disabled={loading || locState === 'asking'}
          style={{ flex: 1, padding: '12px 16px', fontSize: 15, fontWeight: 600, borderRadius: 10, border: 'none', background: '#111', color: '#fff', opacity: loading || locState === 'asking' ? 0.6 : 1 }}
        >
          {locState === 'asking' ? 'Asking…' : loading ? 'Finding…' : locState === 'granted' ? 'Refresh' : 'Use my location'}
        </button>
        <button
          onClick={() => { setLocNote(null); void load(null); }}
          disabled={loading}
          style={{ padding: '12px 16px', fontSize: 15, borderRadius: 10, border: '1px solid #ddd', background: '#fff' }}
        >
          Skip
        </button>
      </div>

      {/* Always visible, not a fallback that only appears after a failure — the
          browser prompt is unreliable enough that typing a place has to be a
          first-class way in, and it doubles as "what would it say over there". */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          value={placeInput}
          onChange={e => setPlaceInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitPlace(); }}
          placeholder="Or type an address, or 43.65, -79.38"
          aria-label="Enter a location"
          autoCapitalize="none"
          autoCorrect="off"
          style={{ flex: 1, padding: '11px 12px', fontSize: 15, borderRadius: 10, border: '1px solid #ddd', minWidth: 0 }}
        />
        <button
          onClick={submitPlace}
          disabled={loading || !placeInput.trim()}
          style={{ padding: '11px 16px', fontSize: 15, fontWeight: 600, borderRadius: 10, border: '1px solid #ddd', background: '#fff', opacity: !placeInput.trim() ? 0.5 : 1 }}
        >
          Go
        </button>
      </div>

      {locNote && (
        <p style={{ fontSize: 13, color: '#8a6d3b', background: '#fcf8e3', padding: 10, borderRadius: 8, marginTop: 0 }}>{locNote}</p>
      )}
      {error && (
        <p style={{ fontSize: 13, color: '#a94442', background: '#f2dede', padding: 10, borderRadius: 8 }}>{error}</p>
      )}

      {data && (
        <>
          <div style={{ background: '#f6f6f7', borderRadius: 12, padding: 14, marginBottom: 18 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: '#777', fontWeight: 700 }}>
              {MODE_LABEL[data.mode] ?? data.mode}
            </div>
            <div style={{ fontSize: 15, marginTop: 6, lineHeight: 1.45 }}>{data.why}</div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 10 }}>
              Left today: {data.remaining.kcal} kcal · {data.remaining.proteinG} g protein · {data.remaining.carbsG} g carbs · {data.remaining.fatG} g fat
            </div>
            {data.nearby.used && !data.nearby.degraded && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                {data.nearby.storesFound} shops · {data.nearby.restaurantsFound} restaurants nearby
                {/* Show what we searched around. A silently wrong location is
                    far worse than an obviously wrong one. */}
                {data.nearby.resolvedPlace
                  ? ` · around ${data.nearby.resolvedPlace.name}`
                  : data.nearby.coords
                    ? ` · around ${data.nearby.coords.lat}, ${data.nearby.coords.lng}`
                    : ''}
              </div>
            )}
            {data.nearby.used && data.nearby.degraded && (
              <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 6 }}>Couldn't reach nearby data — showing foods only.</div>
            )}
          </div>

          {data.recommendations.length === 0 && (
            <p style={{ fontSize: 15, color: '#444' }}>Nothing needs closing right now — you're on track.</p>
          )}

          {data.recommendations.map(r => (
            <div key={r.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 17 }}>{r.kind === 'takeout' ? '🍽' : '🛒'}</span>
                <span style={{ fontSize: 16, fontWeight: 650, flex: 1 }}>{r.name}</span>
                <span style={{ fontSize: 13, color: '#777' }}>{r.kcal} kcal</span>
              </div>

              <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{r.serving}</div>

              {r.closes.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {r.closes.map(c => (
                    <span key={c.key} style={{ fontSize: 12, background: '#eef4ff', color: '#24417a', borderRadius: 20, padding: '4px 9px' }}>
                      {c.label} {c.pctOfRemaining}%
                    </span>
                  ))}
                </div>
              )}

              {r.where && (
                <div style={{ fontSize: 13, color: '#333', marginTop: 10 }}>
                  <strong>{r.where.name}</strong> · {distance(r.where.distanceM)}
                  {r.where.openNow === false && <span style={{ color: '#a94442' }}> · closed</span>}
                  {r.where.rating != null && <span style={{ color: '#777' }}> · ★ {r.where.rating}</span>}
                </div>
              )}

              {/* Rendered verbatim from the server so the page can never make a
                  stronger claim than the data supports. */}
              {r.note && <div style={{ fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' }}>{r.note}</div>}

              {r.warns.map(w => (
                <div key={w.key} style={{ fontSize: 12, color: '#8a6d3b', background: '#fcf8e3', borderRadius: 8, padding: '7px 9px', marginTop: 8 }}>
                  ⚠ {w.text}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
