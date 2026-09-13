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
      id: 'ingredient:wild-salmon', kind: 'ingredient', name: 'Wild salmon',
      serving: '150 g', category: 'Fatty fish', kcal: 273, gain: '+34 g protein',
      closes: [{ key: 'proteinG', label: 'Protein', amount: 34, unit: 'g', pctOfRemaining: 31 }],
      warns: [], mechanism: '', score: 0.25,
      where: { name: 'Loblaws', distanceM: 350, openNow: true, rating: 4.1 },
      note: 'Usually carried at Loblaws.', confidence: 'usda',
      price: { cents: 1582, currency: 'CAD', display: '≈$15.82', estimated: true },
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
      directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Poke%20Place&destination_place_id=r1',
    },
  ],
  ...over,
});

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);

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
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    expect(mockAuthFetch.mock.calls[0][0]).toContain('lat=43.6532');
    expect(mockAuthFetch.mock.calls[0][0]).toContain('lng=-79.3832');
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
    expect(await screen.findByText('Wild salmon')).toBeTruthy();
    expect(mockAuthFetch.mock.calls[0][0]).not.toContain('lat=');
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
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    // Assert on the decoded value, not the encoding: URLSearchParams writes a
    // space as '+', encodeURIComponent writes '%20', and both decode to the
    // same thing server-side. Pinning the spelling makes this test fail on a
    // change that is invisible to the server.
    const url = new URL(mockAuthFetch.mock.calls[0][0] as string, 'http://x');
    expect(url.searchParams.get('place')).toBe('King and Spadina');
  });

  it('sends pasted coordinates directly rather than geocoding them', async () => {
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), '43.65, -79.38');
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    const url = mockAuthFetch.mock.calls[0][0];
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
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    // An invented ceiling would silently suppress good food.
    const url = new URL(mockAuthFetch.mock.calls[0][0] as string, 'http://x');
    expect(url.searchParams.has('budget')).toBe(false);
  });

  it('re-asks about the SAME place when a budget is applied', async () => {
    render(<FoodFinderPage />);
    await userEvent.type(screen.getByLabelText(/enter a location/i), 'King and Spadina');
    await userEvent.click(screen.getByRole('button', { name: /^go$/i }));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText(/budget per meal/i), '15');
    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(2));

    const url = new URL(mockAuthFetch.mock.calls[1][0] as string, 'http://x');
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
    expect(screen.getByText('Wild salmon')).toBeTruthy();
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
    expect(screen.getByText(/1 nearby chain has published nutrition/i)).toBeTruthy();
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
