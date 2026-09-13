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
  nearby: { used: true, degraded: false, storesFound: 3, restaurantsFound: 2, resolvedPlace: null, coords: { lat: 43.65, lng: -79.38 } },
  recommendations: [
    {
      id: 'ingredient:wild-salmon', kind: 'ingredient', name: 'Wild salmon',
      serving: '150 g', category: 'Fatty fish', kcal: 273, gain: '+34 g protein',
      closes: [{ key: 'proteinG', label: 'Protein', amount: 34, unit: 'g', pctOfRemaining: 31 }],
      warns: [], mechanism: '', score: 0.25,
      where: { name: 'Loblaws', distanceM: 350, openNow: true, rating: 4.1 },
      note: 'Usually carried at Loblaws.', confidence: 'usda',
    },
    {
      id: 'dish:r1:salmon-poke-bowl', kind: 'takeout', name: 'Salmon poke bowl',
      serving: '1 bowl', category: 'Takeout', kcal: 580, gain: '+38 g protein',
      closes: [{ key: 'proteinG', label: 'Protein', amount: 38, unit: 'g', pctOfRemaining: 34 }],
      warns: [{ key: 'sodiumMg', label: 'Sodium', text: '~1200 mg sodium — 52% of your daily cap.' }],
      mechanism: '', score: 0.14,
      where: { name: 'Poke Place', distanceM: 220, openNow: true, rating: 4.6 },
      note: 'Typical for japanese restaurant — estimated, not their menu.', confidence: 'estimated',
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
      ok(response({ nearby: { used: false, degraded: true, storesFound: 0, restaurantsFound: 0, resolvedPlace: null, coords: null } })));
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
    expect(mockAuthFetch.mock.calls[0][0]).toContain('place=King%20and%20Spadina');
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
      ok(response({ nearby: { used: false, degraded: true, storesFound: 0, restaurantsFound: 0, resolvedPlace: null, coords: null } })));
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
