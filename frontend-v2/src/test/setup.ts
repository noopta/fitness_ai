import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Analytics must never fire from a test, and posthog-js additionally reads a
// handful of window/navigator fields at import time — enough that it threw
// "Cannot read properties of undefined (reading 'match')" during module load
// and took the whole login.page suite down with it before any test ran.
// Mocking the module is both the correctness fix and the faster one.
vi.mock('posthog-js', () => {
  const posthog = {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    register: vi.fn(),
    people: { set: vi.fn() },
    onFeatureFlags: vi.fn(),
    isFeatureEnabled: vi.fn(() => false),
    getFeatureFlag: vi.fn(() => undefined),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
  return { default: posthog, posthog };
});

// Mock window.location for tests that call setLocation.
// Keep this shape complete: the previous version defined only href/search/
// pathname, and any library reading location.origin or .protocol at import
// time got undefined and crashed the suite it was imported into.
Object.defineProperty(window, 'location', {
  value: {
    href: 'http://localhost/',
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    search: '',
    hash: '',
    pathname: '/',
    replace: vi.fn(),
    assign: vi.fn(),
    reload: vi.fn(),
    toString: () => 'http://localhost/',
  },
  writable: true,
});

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
