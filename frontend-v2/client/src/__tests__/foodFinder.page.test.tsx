/**
 * Unit tests for the Food Finder page.
 *
 * The load-bearing case is the honesty copy: the server sends a `note` scoped
 * to what it can actually stand behind, and this page must render it verbatim
 * rather than inventing a stronger claim. Also covers the geolocation-denied
 * fallback, which has to stay a real answer rather than an error state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FoodFinderPage from '@/pages/food-finder';

const mockAuthFetch = vi.fn();
vi.mock('@/lib/api', () => ({ authFetch: (...a: any[]) => mockAuthFetch(...a) }));

const response = (over: Record<string, unknown> = {}) => ({
  date: '2026-08-08',
  mode: 'macro_priority',
  why: '110 g of protein and 1400 kcal still to go — macros lead.',
  pressures: { macro: 0.7, micro: 0.4 },
  remaining: { kcal: 1400, proteinG: 110, carbsG: 150, fatG: 40 },
  nearby: {
    used: true, degraded: false, storesFound: 3, restaurantsFound: 2,
    resolvedPlace: null, coords: { lat: 43.65, lng: -79.38 },
    metro: { slug: 'toronto-on-ca', label: 'Toronto' }, chainsMatched: 0,
  },
  budget: { cents: null, currency: 'CAD', display: null, pricesAvailable: true },
  diet: { active: false, restrictions: [], allergies: [], excluded: 0 },
  recommendations: [
    {
      id: 'meal:plate:wild-salmon+rolled-oats+spinach', kind: 'meal',
      name: 'Wild salmon with rolled oats and spinach',
      serving: '3 items · 25 min', category: 'Meal', kcal: 897, gain: '+34 g protein',
      components: [
        { name: 'Wild salmon', serving: '300 g', kcal: 546, category: 'Fatty fish', atStore: true },
        { name: 'Rolled oats', serving: '60 g dry', kcal: 228, category: 'Whole grain', atStore: true },
        { name: 'Spinach', serving: '3 cups cooked', kcal: 123, category: 'Leafy green', atStore: false },
      ],
      steps: ['Season the wild salmon and cook it through.', 'Cook the rolled oats to packet timing.'],
      prepMinutes: 25,
      storeCoverage: { covers: 2, of: 3 },
      closes: [{ key: 'proteinG', label: 'Protein', amount: 34, unit: 'g', pctOfRemaining: 31 }],
      warns: [], mechanism: '', score: 0.25,
      where: { name: 'Loblaws', distanceM: 350, openNow: true, rating: 4.1 },
      note: 'Usually carried at Loblaws.', confidence: 'usda',
      price: { cents: 1582, currency: 'CAD', display: '≈$15.82', estimated: true, band: null },
      overBudget: false, dietWarning: null,
      directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Loblaws&destination_place_id=store-1',
    },
    {
      id: 'dish:r1:salmon-poke-bowl', kind: 'takeout', name: 'Salmon poke bowl',
      serving: '1 bowl', category: 'Takeout', kcal: 580, gain: '+38 g protein',
      closes: [{ key: 'proteinG', label: 'Protein', amount: 38, unit: 'g', pctOfRemaining: 34 }],
      warns: [{ key: 'sodiumMg', label: 'Sodium', text: '~1200 mg sodium — 52% of your daily cap.' }],
      mechanism: '', score: 0.14,
      where: { name: 'Poke Place', distanceM: 220, openNow: true, rating: 4.6 },
      note: 'Typical for japanese restaurant — estimated, not their menu.', confidence: 'estimated',
      price: null, overBudget: false, dietWarning: null,
      components: null, steps: null, prepMinutes: null, storeCoverage: null,
      directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Poke%20Place&destination_place_id=r1',
    },
  ],
  ...over,
});

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);

/** Finder searches only — the page also fetches /diet on load and posts /acted. */
const finderCalls = () =>
  mockAuthFetch.mock.calls.map(c => String(c[0])).filter(u => u.includes('/food-finder') && !u.includes('/acted'));
const waitForFinder = (n = 1) => waitFor(() => expect(finderCalls().length).toBeGreaterThanOrEqual(n));

function mockGeolocation(impl: 'grant' | 'deny') {
  const getCurrentPosition = vi.fn((success: any, failure: any) => {
    if (impl === 'grant') success({ coords: { latitude: 43.6532, longitude: -79.3832 } });
    else failure({ code: 1, message: 'denied' });
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { getCurrentPosition }, configurable: true, writable: true,
  });
  return getCurrentPosition;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/food-finder');
  mockAuthFetch.mockImplementation(() => ok(response()));
});

afterEach(() => {
  // Unconditionally — a test that throws before its own cleanup must not
  // strand fake timers in every test that follows it.
  vi.useRealTimers();
});

describe('FoodFinderPage', () => {
  it('sends coordinates once location is granted', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await waitForFinder();
    expect(finderCalls()[0]).toContain('lat=43.6532');
    expect(finderCalls()[0]).toContain('lng=-79.3832');
  });

  it('renders the mode reason and what is left in the day', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    // Exact, so it hits the mode chip and not the reason sentence, which also
    // happens to end "— macros lead."
    expect(await screen.findByText('Macros lead')).toBeTruthy();
    expect(screen.getByText(/110 g of protein and 1400 kcal still to go/)).toBeTruthy();
    // React splits interpolated values into separate text nodes, so match on
    // the assembled textContent rather than a single node.
    expect(
      screen.getByText((_t, el) => /1400 kcal · 110 g protein/.test(el?.textContent ?? '') && el?.children.length === 0),
    ).toBeTruthy();
  });

  it('renders the server note verbatim and never claims a menu', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/estimated, not their menu/i)).toBeTruthy();
    expect(screen.getByText(/usually carried at loblaws/i)).toBeTruthy();
    expect(screen.queryByText(/in stock/i)).toBeNull();
  });

  it('shows where each option is and how far', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText('Poke Place')).toBeTruthy();
    expect(screen.getByText(/220 m/)).toBeTruthy();
  });

  it('surfaces ceiling warnings on a salty dish', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/52% of your daily cap/i)).toBeTruthy();
  });

  it('falls back to a location-free answer when permission is denied', async () => {
    mockGeolocation('deny');
    mockAuthFetch.mockImplementation(() =>
      ok(response({ nearby: { used: false, degraded: true, storesFound: 0, restaurantsFound: 0, resolvedPlace: null, coords: null, metro: null, chainsMatched: 0 } })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    // Denial is a choice, not an error — still a real answer, no lat/lng sent.
    expect(await screen.findByText(/Wild salmon with rolled oats/)).toBeTruthy();
    expect(finderCalls()[0]).not.toContain('lat=');
  });

  it('says WHY location failed instead of doing nothing', async () => {
    // The reported failure: tapping the button appeared to do nothing at all.
    // Permission-denied, no-fix and timeout are indistinguishable from inside
    // the page unless we name which one happened.
    mockGeolocation('deny');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/location permission was denied/i)).toBeTruthy();
  });

  it('does not sit silently when the device never calls back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Neither callback ever fires — the iOS case the built-in timeout misses.
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: { getCurrentPosition: vi.fn() }, configurable: true, writable: true,
    });
    render(<FoodFinderPage />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /use my location/i }));
    expect(screen.getByText(/waiting for your device/i)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(13000); });
    expect(screen.getByText(/no response from your device/i)).toBeTruthy();
  });

  it('geocodes a typed place', async () => {
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), 'King and Spadina');
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }));
    await waitForFinder();
    // Assert on the decoded value, not the encoding: URLSearchParams writes a
    // space as '+', encodeURIComponent writes '%20', and both decode to the
    // same thing server-side. Pinning the spelling makes this test fail on a
    // change that is invisible to the server.
    const url = new URL(finderCalls()[0], 'http://x');
    expect(url.searchParams.get('place')).toBe('King and Spadina');
  });

  it('sends pasted coordinates directly rather than geocoding them', async () => {
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), '43.65, -79.38');
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }));
    await waitForFinder();
    const url = finderCalls()[0];
    expect(url).toContain('lat=43.65');
    expect(url).toContain('lng=-79.38');
    expect(url).not.toContain('place=');
  });

  it('says so when a typed place cannot be found', async () => {
    mockAuthFetch.mockImplementation(() =>
      ok(response({ nearby: { used: false, degraded: true, storesFound: 0, restaurantsFound: 0, resolvedPlace: null, coords: null, metro: null, chainsMatched: 0 } })));
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), 'asdkjhasd');
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }));
    expect(await screen.findByText(/couldn't find "asdkjhasd"/i)).toBeTruthy();
  });

  it('shows which place it actually searched around', async () => {
    // A silently wrong location is worse than an obviously wrong one.
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation(() => ok(response({
      nearby: { used: true, degraded: false, storesFound: 3, restaurantsFound: 2, resolvedPlace: { name: 'King St W & Spadina Ave', address: 'Toronto' }, coords: { lat: 43.65, lng: -79.39 } },
    })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/around King St W & Spadina Ave/)).toBeTruthy();
  });

  it('bootstraps a bearer token from the URL and strips it', async () => {
    // Same location-stubbing convention the login page test uses — happy-dom
    // does not reflect replaceState back into location.search.
    Object.defineProperty(window, 'location', {
      value: { search: '?token=test-jwt-123', pathname: '/food-finder', href: 'http://localhost/food-finder?token=test-jwt-123' },
      writable: true, configurable: true,
    });
    window.history.replaceState = vi.fn();

    render(<FoodFinderPage />);
    await waitFor(() => expect(sessionStorage.getItem('liftoff_bearer_token')).toBe('test-jwt-123'));
    // Stripped so the token doesn't linger in history or get re-applied.
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/food-finder');
  });

  it('reports a server failure instead of rendering an empty list', async () => {
    mockGeolocation('grant');
    mockAuthFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/server returned 500/i)).toBeTruthy();
  });

  it('says nothing is needed when the day is on track', async () => {
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation(() => ok(response({ mode: 'on_track', recommendations: [] })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/you're on track/i)).toBeTruthy();
  });
});

describe('FoodFinderPage — budget, price and provenance', () => {
  it('sends no budget when the field is empty', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await waitForFinder();
    // An invented ceiling would silently suppress good food.
    const url = new URL(finderCalls()[0], 'http://x');
    expect(url.searchParams.has('budget')).toBe(false);
  });

  it('re-asks about the SAME place when a budget is applied', async () => {
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), 'King and Spadina');
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }));
    await waitForFinder();

    await userEvent.type(screen.getByLabelText(/budget per meal/i), '15');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitForFinder(2);

    const url = new URL(finderCalls()[1], 'http://x');
    expect(url.searchParams.get('budget')).toBe('15');
    // The location must survive — not silently fall back to no-location.
    expect(url.searchParams.get('place')).toBe('King and Spadina');
  });

  it('shows an estimated price with its hedge intact', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText('≈$15.82')).toBeTruthy();
  });

  it('renders no price rather than a zero when the price is unknown', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await screen.findByText('Salmon poke bowl');
    // The takeout fixture has price: null. Unknown must never render as free.
    expect(screen.queryByText(/\$0\b/)).toBeNull();
  });

  it('flags an option that breaks the budget without hiding it', async () => {
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation(() => ok(response({
      budget: { cents: 500, currency: 'CAD', display: '$5', pricesAvailable: true },
      recommendations: [{
        ...response().recommendations[0],
        overBudget: true,
      }],
    })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/over budget/i)).toBeTruthy();
    expect(screen.getByText(/Wild salmon with rolled oats/)).toBeTruthy();
  });

  it('says when it has no price data rather than pretending', async () => {
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation(() => ok(response({
      nearby: { used: true, degraded: false, storesFound: 2, restaurantsFound: 1, resolvedPlace: null, coords: null, metro: null, chainsMatched: 0 },
      budget: { cents: null, currency: 'USD', display: null, pricesAvailable: false },
    })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/no price data for this area/i)).toBeTruthy();
  });

  it('distinguishes a published chain figure from an estimate on screen', async () => {
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation(() => ok(response({
      nearby: { used: true, degraded: false, storesFound: 1, restaurantsFound: 1, resolvedPlace: null, coords: null, metro: { slug: 'toronto-on-ca', label: 'Toronto' }, chainsMatched: 1 },
      recommendations: [{
        ...response().recommendations[1],
        confidence: 'published',
        note: "Published nutrition from Nando's.",
      }],
    })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    // The badge on the card, distinct from the header count line.
    expect(await screen.findByText('published')).toBeTruthy();
    expect(screen.getByText(/^Published nutrition from Nando's\.$/)).toBeTruthy();
    // Not "exact" — the chain corpus is curated and unverified.
    expect(screen.getByText(/1 nearby chain matched to its menu — figures estimated/i)).toBeTruthy();
  });

  it('states an unverifiable allergy instead of resolving it either way', async () => {
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation(() => ok(response({
      diet: { active: true, restrictions: [], allergies: ['peanut'], excluded: 2 },
      recommendations: [{
        ...response().recommendations[1],
        dietWarning: "We can't verify peanut from a menu listing — check with the restaurant.",
      }],
    })));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText(/can't verify peanut/i)).toBeTruthy();
    expect(screen.getByText(/2 options hidden/i)).toBeTruthy();
  });

  it('offers directions to every attached venue', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    const links = await screen.findAllByRole('link', { name: /directions/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\/maps\/dir/);
    expect(links[0].getAttribute('target')).toBe('_blank');
  });
});

describe('FoodFinderPage — meals', () => {
  const show = async () => {
    // Installed per-test rather than in a nested beforeEach: vi.clearAllMocks()
    // in the outer hook strips the implementation off a spy created earlier.
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await screen.findByText(/Wild salmon with rolled oats/);
  };

  it('shows the whole plate, not a loose ingredient', async () => {
    await show();
    // The complaint that prompted this: "Pumpkin seeds, 30 g" is not dinner.
    expect(screen.getByText('Wild salmon')).toBeTruthy();
    expect(screen.getByText('Rolled oats')).toBeTruthy();
    expect(screen.getByText('Spinach')).toBeTruthy();
  });

  it('gives an amount for every component', async () => {
    await show();
    expect(screen.getByText('300 g')).toBeTruthy();
    expect(screen.getByText('60 g dry')).toBeTruthy();
    expect(screen.getByText('3 cups cooked')).toBeTruthy();
  });

  it('leads with cooking time rather than a serving string', async () => {
    await show();
    expect(screen.getByText('25 min to cook')).toBeTruthy();
  });

  it('keeps the method behind a tap, and shows it on request', async () => {
    await show();
    expect(screen.queryByText(/packet timing/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /how to make it/i }));
    expect(screen.getByText(/packet timing/i)).toBeTruthy();
  });

  it('flags the item the attached shop probably lacks', async () => {
    await show();
    // Better than a clean list that sends someone home one ingredient short.
    expect(screen.getByText('elsewhere')).toBeTruthy();
    expect(screen.getByText(/2\/3 items/)).toBeTruthy();
  });

  it('still renders a takeout dish as a single item with no shopping list', async () => {
    await show();
    expect(screen.getByText('Salmon poke bowl')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /how to make it/i })).toBeTruthy();
  });
});

describe('FoodFinderPage — address autocomplete', () => {
  const SUGGESTIONS = [
    { placeId: 'p1', primary: '172 Farley Dr', secondary: 'Guelph, ON, Canada', text: '172 Farley Dr, Guelph, ON, Canada' },
    { placeId: 'p2', primary: '172 Farley Rd', secondary: 'Toronto, ON, Canada', text: '172 Farley Rd, Toronto, ON, Canada' },
  ];

  const withSuggest = () => {
    mockAuthFetch.mockImplementation((url: string) =>
      url.includes('place-suggest')
        ? ok({ suggestions: SUGGESTIONS })
        : ok(response()));
  };

  it('suggests addresses as you type', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    withSuggest();
    render(<FoodFinderPage />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText(/enter a location/i), '172 Farley');
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(await screen.findByText('172 Farley Dr')).toBeTruthy();
  });

  it('does not fire a request per keystroke', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    withSuggest();
    render(<FoodFinderPage />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText(/enter a location/i), '172 Farley');
    await act(async () => { vi.advanceTimersByTime(400); });
    // Autocomplete is billed per request; ten keystrokes must not be ten calls.
    const suggestCalls = mockAuthFetch.mock.calls.filter(c => String(c[0]).includes('place-suggest'));
    expect(suggestCalls.length).toBeLessThanOrEqual(2);
  });

  it('searches the exact place you picked, by id', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    withSuggest();
    render(<FoodFinderPage />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText(/enter a location/i), '172 Farley');
    await act(async () => { vi.advanceTimersByTime(400); });
    await user.click(await screen.findByText('172 Farley Dr'));

    const finderCall = finderCalls()[0];
    const url = new URL(finderCall!, 'http://x');
    // The id, not the text — the user already disambiguated Guelph from Toronto.
    expect(url.searchParams.get('placeId')).toBe('p1');
  });
});

describe('FoodFinderPage — the Apply-without-Go bug', () => {
  it('keeps a typed address when the budget is applied first', async () => {
    // Reported from a real session: typing an address then hitting Apply
    // replayed the previous, location-free search — no shops, no prices, and
    // USD while standing in Canada.
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), '172 Farley Drive, Guelph');
    await userEvent.type(screen.getByLabelText(/budget per meal/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitForFinder();

    const finderCall = finderCalls()[0];
    const url = new URL(finderCall!, 'http://x');
    expect(url.searchParams.get('place')).toBe('172 Farley Drive, Guelph');
    expect(url.searchParams.get('budget')).toBe('100');
  });
});

describe('FoodFinderPage — macro amounts and missing prices', () => {
  const show = async (over: Record<string, unknown> = {}) => {
    mockGeolocation('grant');
    if (Object.keys(over).length) mockAuthFetch.mockImplementation(() => ok(response(over)));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    // Wait on the remaining-macros line: present in every response, and unique
    // (the mode label and the `why` sentence both say "macros lead"). The
    // default fixture's meal card is absent when a test replaces the list.
    await screen.findByText(/Left today:/);
  };

  it('gives the grams, not just a percentage', async () => {
    await show();
    // "Protein 9%" alone is unanswerable — 9% of a number you have to go find.
    expect(screen.getByText('34 g')).toBeTruthy();
  });

  it('still shows the share of what is left, as context', async () => {
    await show();
    expect(screen.getByText(/31% of what's left/)).toBeTruthy();
  });

  it('shows a price bracket for a restaurant we have no menu for', async () => {
    await show({
      recommendations: [{
        ...response().recommendations[1],
        price: { cents: 3000, currency: 'CAD', display: '≈$22–38', estimated: true, band: { lowCents: 2200, highCents: 3800 } },
      }],
    });
    expect(await screen.findByText('≈$22–38')).toBeTruthy();
  });

  it('says "no price" rather than leaving a blank', async () => {
    await show();
    // The takeout fixture has price: null. A blank read as an oversight;
    // "no price" says we have no menu for that place.
    expect(screen.getByText('no price')).toBeTruthy();
  });
});

describe('FoodFinderPage — dietary needs', () => {
  const DIET = (over: Record<string, unknown> = {}) => ({
    restrictions: [], allergies: [], dislikes: [], unspecifiedAllergy: false,
    halalKosherAmbiguous: false, sources: [], explicit: false, ...over,
  });
  const routeFetch = (diet: unknown, onPut?: (body: any) => unknown) =>
    mockAuthFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/nutrition-profile/diet')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          return ok(onPut ? onPut(body) : DIET({ ...body, explicit: true, sources: ['food_finder'] }));
        }
        return ok(diet);
      }
      return ok(response());
    });

  it('pre-fills what the user told the coach, and asks them to confirm', async () => {
    routeFetch(DIET({ restrictions: ['halal', 'kosher'], halalKosherAmbiguous: true, sources: ['coach_intake'] }));
    render(<FoodFinderPage />);
    // Opens itself: there is something to confirm.
    expect(await screen.findByText(/filtering for both/i)).toBeTruthy();
    expect(screen.getByText(/pre-filled from what you told your coach/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Halal' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Kosher' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('asks which allergies when onboarding only said "food allergies"', async () => {
    routeFetch(DIET({ unspecifiedAllergy: true, sources: ['coach_intake'] }));
    render(<FoodFinderPage />);
    expect(await screen.findByText(/which ones\?/i)).toBeTruthy();
  });

  it('saves chips plus free-text allergies and foods to avoid', async () => {
    let saved: any = null;
    routeFetch(DIET(), body => { saved = body; return DIET({ ...body, explicit: true }); });
    render(<FoodFinderPage />);
    await userEvent.click(await screen.findByRole('button', { name: /dietary needs/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Kosher' }));
    await userEvent.click(screen.getByRole('button', { name: 'Peanuts' }));
    await userEvent.type(screen.getByLabelText(/other allergies/i), 'mango, kiwi');
    await userEvent.type(screen.getByLabelText(/foods to avoid/i), 'olives');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toEqual({ restrictions: ['kosher'], allergies: ['peanut', 'mango', 'kiwi'], dislikes: ['olives'] });
    expect(await screen.findByText(/saved/i)).toBeTruthy();
  });

  it('lets a user untick an intake restriction and save the result', async () => {
    let saved: any = null;
    routeFetch(DIET({ restrictions: ['halal', 'kosher'], halalKosherAmbiguous: true, sources: ['coach_intake'] }),
      body => { saved = body; return DIET({ ...body, explicit: true }); });
    render(<FoodFinderPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Kosher' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved.restrictions).toEqual(['halal']);
  });

  it('re-runs the search with the new filters after saving', async () => {
    routeFetch(DIET());
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await waitForFinder(1);
    await userEvent.click(screen.getByRole('button', { name: /dietary needs/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Vegan' }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForFinder(2);
    expect(finderCalls()[1]).toContain('lat=43.6532');
  });
});

describe('FoodFinderPage — honest empty states', () => {
  const show = async (over: Record<string, unknown>) => {
    mockGeolocation('grant');
    mockAuthFetch.mockImplementation((url: string) => ok(url.includes('/diet') ? {} : response(over)));
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await screen.findByText(/Left today:/);
  };

  it('calls an empty area empty rather than blaming the data', async () => {
    await show({ nearby: { used: true, degraded: false, empty: true, radiusKm: 2.5, storesFound: 0, restaurantsFound: 0, resolvedPlace: null, coords: null, metro: null, chainsMatched: 0 } });
    expect(screen.getByText(/no shops or restaurants found within 2.5 km/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't reach nearby data/i)).toBeNull();
  });

  it('says when nothing actually fits, instead of passing off the closest as a match', async () => {
    await show({ fit: { nothingFits: true } });
    expect(screen.getByText(/nothing here fully fits/i)).toBeTruthy();
  });

  it('stays quiet when options fit', async () => {
    await show({ fit: { nothingFits: false } });
    expect(screen.queryByText(/nothing here fully fits/i)).toBeNull();
  });
});

describe("FoodFinderPage — I'm having this", () => {
  it('records the choice against the suggestion id and confirms it', async () => {
    mockGeolocation('grant');
    render(<FoodFinderPage />);
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await screen.findByText(/Wild salmon with rolled oats/);
    const [first] = screen.getAllByRole('button', { name: /i'm having this/i });
    await userEvent.click(first);
    await waitFor(() => expect(mockAuthFetch.mock.calls.some(c => String(c[0]).includes('/food-finder/acted'))).toBe(true));
    const call = mockAuthFetch.mock.calls.find(c => String(c[0]).includes('/food-finder/acted'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ itemKey: 'meal:plate:wild-salmon+rolled-oats+spinach' });
    expect(await screen.findByText(/✓ Noted/)).toBeTruthy();
  });
});
