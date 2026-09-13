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

import { useCallback, useEffect, useRef, useState } from 'react';
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

interface MealComponent {
  name: string;
  serving: string;
  kcal: number;
  category: string;
  /** False when this one item probably is not at the attached shop. */
  atStore: boolean;
}

interface PlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
  text: string;
}

interface Recommendation {
  id: string;
  kind: 'meal' | 'ingredient' | 'takeout';
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
  confidence: 'usda' | 'published' | 'inferred' | 'estimated';
  /** Null means we do not know the price — which is NOT the same as free. */
  price: {
    cents: number; currency: string; display: string; estimated: boolean;
    /** Present when the figure is a bracket from the venue's price tier. */
    band: { lowCents: number; highCents: number } | null;
  } | null;
  overBudget: boolean;
  /** Present when a declared allergy cannot be verified from a menu listing. */
  dietWarning: string | null;
  directionsUrl: string | null;
  /** Composed meals only. */
  components: MealComponent[] | null;
  steps: string[] | null;
  prepMinutes: number | null;
  storeCoverage: { covers: number; of: number } | null;
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
    metro: { slug: string; label: string } | null;
    chainsMatched: number;
  };
  budget: { cents: number | null; currency: string; display: string | null; pricesAvailable: boolean };
  diet: { active: boolean; restrictions: string[]; allergies: string[]; excluded: number };
  recommendations: Recommendation[];
}

/**
 * How much to trust a number, said plainly.
 *
 * The confidence ladder is the product's spine, so it is shown rather than
 * buried: a USDA composition and a model's guess about an unnamed kitchen must
 * not look alike on screen. USDA gets no badge — the absence of a hedge is the
 * signal.
 */
const CONFIDENCE_BADGE: Record<Recommendation['confidence'], { label: string; bg: string; fg: string } | null> = {
  usda: null,
  published: { label: 'published', bg: '#e8f5e9', fg: '#2e6b32' },
  inferred: { label: 'estimated', bg: '#fff4e5', fg: '#8a5a00' },
  estimated: { label: 'estimated', bg: '#fff4e5', fg: '#8a5a00' },
};

/**
 * Turn a GeolocationPositionError into something a user can act on.
 * "Nothing happened" is the worst possible outcome here — the browser prompt
 * can be blocked, dismissed, or disabled at the OS level, and every one of
 * those looks identical from inside the page unless we say which it was.
 */
/** Where a search is anchored. A chosen suggestion carries its exact place id. */
type Where =
  | { lat: number; lng: number }
  | { place: string; placeId?: string }
  | null;

/** 34.2 -> "34", 1.75 -> "1.8". Whole grams read better than false precision. */
function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 10) return String(Math.round(n));
  if (Math.abs(n) >= 1) return (Math.round(n * 10) / 10).toString();
  return (Math.round(n * 100) / 100).toString();
}

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
  const [budgetInput, setBudgetInput] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [openMeal, setOpenMeal] = useState<string | null>(null);
  // One token groups a whole lookup's keystrokes into a single billable
  // autocomplete session; a fresh one starts after each selection.
  const sessionRef = useRef<string>(Math.random().toString(36).slice(2));
  /** Set when the user picked a suggestion, so we skip re-geocoding the text. */
  const chosenPlaceIdRef = useRef<string | null>(null);
  // Also held in a ref so `load` can read the current value without being
  // re-created on every keystroke, which would re-trigger its callers.
  const budgetRef = useRef('');
  budgetRef.current = budgetInput;
  // The last place we searched, so changing the budget re-asks about the SAME
  // corner instead of silently falling back to a location-free answer.
  const lastWhereRef = useRef<Where>(null);

  // Same bootstrap the OAuth redirect uses, so a single link works on a phone
  // without a separate login round-trip.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) {
      sessionStorage.setItem('liftoff_bearer_token', t);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const load = useCallback(async (where: Where) => {
    lastWhereRef.current = where;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (where && 'lat' in where) { params.set('lat', String(where.lat)); params.set('lng', String(where.lng)); }
      else if (where) {
        params.set('place', where.place);
        // A chosen suggestion is exact; sending it stops the server
        // re-geocoding text the user already disambiguated for us.
        if (where.placeId) params.set('placeId', where.placeId);
      }
      const budget = Number(budgetRef.current);
      if (Number.isFinite(budget) && budget > 0) params.set('budget', String(budget));
      const qs = params.toString() ? `?${params}` : '';
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

  /**
   * Re-run the last search with whatever the budget field now says.
   *
   * Falls back to whatever is typed in the location box. Without that, typing
   * an address and then hitting Apply replayed the PREVIOUS search — which was
   * location-free — and silently threw the address away: no shops, no prices,
   * and a currency from the wrong country.
   */
  const reload = useCallback(() => {
    const typed = placeInput.trim();
    if (!lastWhereRef.current && typed) {
      return load({ place: typed, placeId: chosenPlaceIdRef.current ?? undefined });
    }
    return load(lastWhereRef.current);
  }, [load, placeInput]);

  // Address suggestions, debounced. Autocomplete is billed per request, so this
  // must never fire per keystroke.
  useEffect(() => {
    const q = placeInput.trim();
    if (q.length < 3 || chosenPlaceIdRef.current) { setSuggestions([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, session: sessionRef.current });
        const here = data?.nearby.coords;
        if (here) { params.set('lat', String(here.lat)); params.set('lng', String(here.lng)); }
        const res = await authFetch(`${API_BASE}/nutrition-profile/place-suggest?${params}`);
        if (!res.ok || cancelled) return;
        const body = await res.json() as { suggestions: PlaceSuggestion[] };
        if (!cancelled) setSuggestions(body.suggestions ?? []);
      } catch {
        // Suggestions are a convenience; typing the address still works.
        if (!cancelled) setSuggestions([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [placeInput, data?.nearby.coords]);

  const chooseSuggestion = useCallback((sug: PlaceSuggestion) => {
    setPlaceInput(sug.text);
    setSuggestions([]);
    chosenPlaceIdRef.current = sug.placeId;
    // A new session token for the next lookup — this one is now billed.
    sessionRef.current = Math.random().toString(36).slice(2);
    void load({ place: sug.text, placeId: sug.placeId });
  }, [load]);

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
          onChange={e => { setPlaceInput(e.target.value); chosenPlaceIdRef.current = null; }}
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

      {suggestions.length > 0 && (
        <ul
          aria-label="Address suggestions"
          style={{ listStyle: 'none', margin: '-8px 0 14px', padding: 0, border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}
        >
          {suggestions.map(sug => (
            <li key={sug.placeId}>
              <button
                onClick={() => chooseSuggestion(sug)}
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 14, background: '#fff', border: 'none', borderBottom: '1px solid #f3f3f3', cursor: 'pointer' }}
              >
                <span style={{ fontWeight: 600 }}>{sug.primary}</span>
                {sug.secondary && <span style={{ color: '#888' }}> · {sug.secondary}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Budget is optional and stays empty by default. An invented ceiling
          would silently suppress good food, so no budget means no budget. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <label htmlFor="ff-budget" style={{ fontSize: 14, color: '#555', whiteSpace: 'nowrap' }}>Budget</label>
        <input
          id="ff-budget"
          value={budgetInput}
          onChange={e => setBudgetInput(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter') void reload(); }}
          placeholder="any"
          inputMode="decimal"
          aria-label="Budget per meal"
          style={{ width: 90, padding: '9px 10px', fontSize: 15, borderRadius: 10, border: '1px solid #ddd' }}
        />
        {data?.budget.currency && <span style={{ fontSize: 13, color: '#888' }}>{data.budget.currency}</span>}
        {budgetInput && (
          <button
            onClick={() => void reload()}
            disabled={loading}
            style={{ padding: '9px 14px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: '1px solid #ddd', background: '#fff' }}
          >
            Apply
          </button>
        )}
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
            {data.nearby.chainsMatched > 0 && (
              <div style={{ fontSize: 12, color: '#2e6b32', marginTop: 6 }}>
                {data.nearby.chainsMatched} nearby {data.nearby.chainsMatched === 1 ? 'chain has' : 'chains have'} published nutrition — those figures are exact.
              </div>
            )}
            {data.nearby.used && !data.budget.pricesAvailable && (
              /* We would rather show no prices than prices from another
                 economy, and the user should know which of the two is
                 happening. */
              <div style={{ fontSize: 12, color: '#8a6d3b', marginTop: 6 }}>
                No price data for this area yet — ranking on nutrition and distance only.
              </div>
            )}
            {data.diet.active && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                Filtered for {[...data.diet.restrictions, ...data.diet.allergies].join(', ')}
                {data.diet.excluded > 0 && ` · ${data.diet.excluded} option${data.diet.excluded === 1 ? '' : 's'} hidden`}
              </div>
            )}
          </div>

          {data.recommendations.length === 0 && (
            <p style={{ fontSize: 15, color: '#444' }}>Nothing needs closing right now — you're on track.</p>
          )}

          {data.recommendations.map(r => (
            <div key={r.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 17 }}>{r.kind === 'takeout' ? '🍽' : '🍳'}</span>
                <span style={{ fontSize: 16, fontWeight: 650, flex: 1 }}>{r.name}</span>
                <span style={{ fontSize: 13, color: '#777' }}>{r.kcal} kcal</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666' }}>
                  {r.prepMinutes != null ? `${r.prepMinutes} min to cook` : r.serving}
                </span>
                {r.price ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: r.overBudget ? '#a94442' : '#2e6b32' }}>
                    {r.price.display}
                    {r.overBudget && ' · over budget'}
                  </span>
                ) : (
                  /* Saying nothing let a missing price read as an oversight.
                     "No price" is information: we have no menu for this place. */
                  <span style={{ fontSize: 12, color: '#aaa' }}>no price</span>
                )}
                {CONFIDENCE_BADGE[r.confidence] && (
                  <span style={{
                    fontSize: 11, borderRadius: 20, padding: '2px 8px',
                    background: CONFIDENCE_BADGE[r.confidence]!.bg,
                    color: CONFIDENCE_BADGE[r.confidence]!.fg,
                  }}>
                    {CONFIDENCE_BADGE[r.confidence]!.label}
                  </span>
                )}
              </div>

              {/* The shopping list. This is the actual answer to "what do I
                  eat" — a name alone sends someone to a shop with no plan. */}
              {r.components && r.components.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid #f2f2f2', paddingTop: 10 }}>
                  {r.components.map(c => (
                    <div key={c.name} style={{ display: 'flex', gap: 8, fontSize: 14, padding: '3px 0', alignItems: 'baseline' }}>
                      <span style={{ color: '#999', minWidth: 92, fontVariantNumeric: 'tabular-nums' }}>{c.serving}</span>
                      <span style={{ flex: 1 }}>{c.name}</span>
                      {/* Flagging the one item this shop may not have is more
                          useful than a clean list that sends you home short. */}
                      {!c.atStore && r.where && (
                        <span style={{ fontSize: 11, color: '#8a6d3b' }}>elsewhere</span>
                      )}
                      <span style={{ color: '#aaa', fontSize: 12 }}>{c.kcal}</span>
                    </div>
                  ))}
                </div>
              )}

              {r.steps && r.steps.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => setOpenMeal(openMeal === r.id ? null : r.id)}
                    aria-expanded={openMeal === r.id}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: '#24417a', cursor: 'pointer' }}
                  >
                    {openMeal === r.id ? 'Hide method' : 'How to make it'}
                  </button>
                  {openMeal === r.id && (
                    <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, color: '#444', lineHeight: 1.55 }}>
                      {r.steps.map((step, i) => <li key={i} style={{ marginBottom: 4 }}>{step}</li>)}
                    </ol>
                  )}
                </div>
              )}

              {/* Grams lead, share follows. "Protein 9%" alone is unanswerable —
                  9% of a number the user has to go and find. The absolute
                  amount is what they log and what they can sanity-check. */}
              {r.closes.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {r.closes.map(c => (
                    <span key={c.key} style={{ fontSize: 12, background: '#eef4ff', color: '#24417a', borderRadius: 20, padding: '4px 9px' }}>
                      {c.label} <strong>{formatAmount(c.amount)} {c.unit}</strong>
                      <span style={{ opacity: 0.65 }}> · {c.pctOfRemaining}% of what's left</span>
                    </span>
                  ))}
                </div>
              )}

              {r.where && (
                <div style={{ fontSize: 13, color: '#333', marginTop: 10 }}>
                  <strong>{r.where.name}</strong> · {distance(r.where.distanceM)}
                  {r.storeCoverage && r.storeCoverage.covers < r.storeCoverage.of && (
                    <span style={{ color: '#8a6d3b' }}> · {r.storeCoverage.covers}/{r.storeCoverage.of} items</span>
                  )}
                  {r.where.openNow === false && <span style={{ color: '#a94442' }}> · closed</span>}
                  {r.where.rating != null && <span style={{ color: '#777' }}> · ★ {r.where.rating}</span>}
                </div>
              )}

              {/* Rendered verbatim from the server so the page can never make a
                  stronger claim than the data supports. */}
              {r.note && <div style={{ fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' }}>{r.note}</div>}

              {/* An allergy we cannot verify is stated, never silently
                  resolved in either direction — see the three-verdict filter. */}
              {r.dietWarning && (
                <div style={{ fontSize: 12, color: '#a94442', background: '#f2dede', borderRadius: 8, padding: '7px 9px', marginTop: 8 }}>
                  ⚠ {r.dietWarning}
                </div>
              )}

              {r.warns.map(w => (
                <div key={w.key} style={{ fontSize: 12, color: '#8a6d3b', background: '#fcf8e3', borderRadius: 8, padding: '7px 9px', marginTop: 8 }}>
                  ⚠ {w.text}
                </div>
              ))}

              {r.directionsUrl && (
                <a
                  href={r.directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 600, color: '#24417a', textDecoration: 'none' }}
                >
                  Directions →
                </a>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
