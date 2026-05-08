// Lightweight client cache for mobile screens.
//
// Why this exists: the app was re-fetching coach/today/schedule, social feed,
// strength profile, etc. on every tab visit, which made navigation feel like
// a full reload. This module gives us a single primitive — `useCachedQuery` —
// that:
//
//   - returns cached data instantly on remount (in-memory, then AsyncStorage)
//   - refreshes silently in the background when data is hot but old enough
//     to want a check (stale-while-revalidate)
//   - exposes `invalidateCache(prefix)` so writes (logging a workout, saving
//     a meal, posting to social) can purge dependent reads
//
// Invariants:
//   - Cache keys MUST include the user id when the data is per-user.
//     Mixing users into the same key bleeds data between accounts.
//   - Don't cache write responses — only the GET shapes used by the UI.
//   - TTLs are upper bounds on stale-while-revalidate, not hard expirations:
//     past the TTL we still serve cached data instantly while a fresh fetch
//     races in the background. If you need hard expiry, set
//     `staleWhileRevalidate: false` on the consumer.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const memCache = new Map<string, CacheEntry<unknown>>();
const STORAGE_PREFIX = 'mcache:v1:';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min

// ─── Persistent storage helpers ───────────────────────────────────────────────

async function persistGet<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

async function persistSet<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* ignore quota / serialization errors */
  }
}

async function persistDeleteByPrefix(prefix: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const target = keys.filter(k => k.startsWith(STORAGE_PREFIX + prefix));
    if (target.length > 0) await AsyncStorage.multiRemove(target);
  } catch {
    /* ignore */
  }
}

// ─── Direct cache API ─────────────────────────────────────────────────────────

export function getCached<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const entry = memCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) return null;
  return entry.data;
}

export function setCached<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, ts: Date.now() };
  memCache.set(key, entry);
  // Fire-and-forget persistence — survives app restart
  void persistSet(key, entry);
}

/**
 * Drop every cache entry whose key starts with `prefix`. Use this from
 * mutation success handlers — e.g. after logging a meal, call
 * `invalidateCache('nutrition:')`. Both in-memory and AsyncStorage are cleared.
 */
export function invalidateCache(prefix: string): void {
  for (const k of Array.from(memCache.keys())) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
  void persistDeleteByPrefix(prefix);
}

/**
 * Pull every persisted cache entry off AsyncStorage and load it into the
 * in-memory Map. Without this, a cold app start has no way to serve
 * synchronous reads from `getCached()` even though the data still lives on
 * disk — every screen would refetch from the network on first paint.
 *
 * Call this once during app boot (RootNavigator) and gate rendering on its
 * completion so screens that read synchronously see a warm cache.
 */
export async function hydrateCacheFromStorage(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const ours = allKeys.filter(k => k.startsWith(STORAGE_PREFIX));
    if (ours.length === 0) return;
    const pairs = await AsyncStorage.multiGet(ours);
    for (const [storageKey, raw] of pairs) {
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as CacheEntry<unknown>;
        if (typeof entry?.ts !== 'number') continue;
        memCache.set(storageKey.slice(STORAGE_PREFIX.length), entry);
      } catch { /* corrupt entry — skip */ }
    }
  } catch {
    // AsyncStorage failures here are non-fatal — screens just refetch.
  }
}

// ─── React hook ───────────────────────────────────────────────────────────────

interface UseCachedQueryOptions {
  /**
   * Maximum age (ms) at which a cached value is still served instantly without
   * a background refresh. Past this age, cached data is still shown but a
   * silent re-fetch is kicked off. Default: 5 minutes.
   */
  ttlMs?: number;
  /**
   * Default true. When false, behaves like a standard cache: hot hit returns
   * data and skips network entirely.
   */
  staleWhileRevalidate?: boolean;
  /**
   * Default true. When false, the hook is inert (no cache reads, no fetch).
   * Useful when auth isn't ready yet.
   */
  enabled?: boolean;
}

export interface UseCachedQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  /**
   * Force a fetch and update both cache + state. Surface this on
   * pull-to-refresh handlers.
   */
  refresh: () => Promise<T | null>;
}

/**
 * Cache-first query hook. On mount:
 *   1. Reads the in-memory cache; if present and fresh, returns instantly.
 *   2. If no in-memory hit, reads AsyncStorage; if present and fresh, hydrates
 *      memory and returns.
 *   3. If still no data, fetches and stores.
 *   4. If data was served from cache and `staleWhileRevalidate` is on, fires
 *      a silent background fetch so the next visit is current.
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseCachedQueryOptions = {},
): UseCachedQueryResult<T> {
  const { ttlMs = DEFAULT_TTL_MS, staleWhileRevalidate = true, enabled = true } = options;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Seed from in-memory cache synchronously so first paint already has data
  const initial = key && enabled ? getCached<T>(key, ttlMs) : null;
  const [data, setData] = useState<T | null>(initial);
  const [isLoading, setLoading] = useState<boolean>(initial === null && enabled && key !== null);

  const refresh = useCallback(async (): Promise<T | null> => {
    if (!key || !enabled) return null;
    try {
      const fresh = await fetcherRef.current();
      setCached(key, fresh);
      setData(fresh);
      return fresh;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [key, enabled]);

  useEffect(() => {
    if (!key || !enabled) {
      setLoading(false);
      return;
    }

    const memHit = getCached<T>(key, ttlMs);
    if (memHit !== null) {
      setData(memHit);
      setLoading(false);
      if (staleWhileRevalidate) void refresh();
      return;
    }

    let cancelled = false;
    void persistGet<T>(key).then(persisted => {
      if (cancelled) return;
      if (persisted && Date.now() - persisted.ts <= ttlMs) {
        memCache.set(key, persisted);
        setData(persisted.data);
        setLoading(false);
        if (staleWhileRevalidate) void refresh();
        return;
      }
      void refresh();
    });

    return () => {
      cancelled = true;
    };
  }, [key, enabled, ttlMs, staleWhileRevalidate, refresh]);

  return { data, isLoading, refresh };
}
