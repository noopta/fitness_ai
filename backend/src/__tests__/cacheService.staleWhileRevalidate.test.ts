/**
 * Stale-while-revalidate primitives.
 *
 * Context: /nutrition/profile was invalidated with cacheDelete on every meal
 * log, so the next reader personally paid a ~56s LLM rebuild on the request
 * path (measured against prod 2026-08-03, with no client timeout to break it).
 * cacheMarkStale keeps the old value usable while a refresh runs behind the
 * response. These tests pin that behaviour.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheGetWithMeta,
  cacheMarkStale,
} from '../services/cacheService.js';

const KEY = 'test:swr';

beforeEach(() => cacheDelete(KEY));
afterEach(() => vi.useRealTimers());

describe('cacheMarkStale / cacheGetWithMeta', () => {
  it('keeps the value readable after being marked stale', () => {
    cacheSet(KEY, { n: 1 });
    cacheMarkStale(KEY);

    // The whole point: the data survives invalidation.
    expect(cacheGet<{ n: number }>(KEY)).toEqual({ n: 1 });
    expect(cacheGetWithMeta<{ n: number }>(KEY)).toEqual({ data: { n: 1 }, stale: true });
  });

  it('reports fresh entries as not stale', () => {
    cacheSet(KEY, { n: 1 });
    expect(cacheGetWithMeta<{ n: number }>(KEY)).toEqual({ data: { n: 1 }, stale: false });
  });

  it('clears the stale flag when the value is rewritten', () => {
    cacheSet(KEY, { n: 1 });
    cacheMarkStale(KEY);
    cacheSet(KEY, { n: 2 });

    expect(cacheGetWithMeta<{ n: number }>(KEY)).toEqual({ data: { n: 2 }, stale: false });
  });

  it('is a safe no-op on a key that was never cached', () => {
    expect(() => cacheMarkStale('test:missing')).not.toThrow();
    expect(cacheGetWithMeta('test:missing')).toBeNull();
  });

  it('returns null for a missing key', () => {
    expect(cacheGetWithMeta(KEY)).toBeNull();
  });

  it('still honours TTL expiry — stale must not mean immortal', () => {
    vi.useFakeTimers();
    cacheSet(KEY, { n: 1 }, 1000);
    cacheMarkStale(KEY);

    expect(cacheGetWithMeta<{ n: number }>(KEY)).toEqual({ data: { n: 1 }, stale: true });

    vi.advanceTimersByTime(1001);
    expect(cacheGetWithMeta(KEY)).toBeNull();
    expect(cacheGet(KEY)).toBeNull();
  });

  it('cacheDelete still removes outright, stale or not', () => {
    cacheSet(KEY, { n: 1 });
    cacheMarkStale(KEY);
    cacheDelete(KEY);

    expect(cacheGetWithMeta(KEY)).toBeNull();
  });
});
