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
  nearby: { used: boolean; degraded: boolean; storesFound: number; restaurantsFound: number };
  recommendations: Recommendation[];
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

  // Same bootstrap the OAuth redirect uses, so a single link works on a phone
  // without a separate login round-trip.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) {
      sessionStorage.setItem('liftoff_bearer_token', t);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const load = useCallback(async (coords: { lat: number; lng: number } | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
      const res = await authFetch(`${API_BASE}/nutrition-profile/food-finder${qs}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocState('denied');
      void load(null);
      return;
    }
    setLocState('asking');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocState('granted');
        void load({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      // Denial is a normal choice, not an error state — fall back to the
      // location-free answer, which is still a real answer.
      () => {
        setLocState('denied');
        void load(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [load]);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Food Finder</h1>
      <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>What to eat right now, based on what you've already eaten today.</p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <button
          onClick={useMyLocation}
          disabled={loading}
          style={{ flex: 1, padding: '12px 16px', fontSize: 15, fontWeight: 600, borderRadius: 10, border: 'none', background: '#111', color: '#fff' }}
        >
          {loading ? 'Finding…' : locState === 'granted' ? 'Refresh' : 'Use my location'}
        </button>
        <button
          onClick={() => void load(null)}
          disabled={loading}
          style={{ padding: '12px 16px', fontSize: 15, borderRadius: 10, border: '1px solid #ddd', background: '#fff' }}
        >
          Skip
        </button>
      </div>

      {locState === 'denied' && (
        <p style={{ fontSize: 13, color: '#8a6d3b', background: '#fcf8e3', padding: 10, borderRadius: 8 }}>
          No location — showing foods without nearby shops or restaurants.
        </p>
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
