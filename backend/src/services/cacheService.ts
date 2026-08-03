interface CacheEntry<T> {
  data: T;
  expiresAt: number | null; // null = no expiry
  stale?: boolean;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Read an entry along with whether it has been marked stale.
 *
 * Enables stale-while-revalidate: serve what we already have instantly, then
 * refresh in the background. The alternative — deleting on every write — makes
 * the next reader personally pay the full recompute cost, which for the
 * nutrition profile is a ~56-second LLM call on the request path.
 */
export function cacheGetWithMeta<T>(key: string): { data: T; stale: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data as T, stale: entry.stale === true };
}

/**
 * Mark an entry stale without discarding it. A no-op when nothing is cached,
 * so callers can use it as a drop-in for cacheDelete at invalidation points.
 */
export function cacheMarkStale(key: string): void {
  const entry = cache.get(key);
  if (entry) entry.stale = true;
}

export function cacheSet<T>(key: string, data: T, ttlMs?: number): void {
  cache.set(key, {
    data,
    expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
  });
}

export function cacheDelete(key: string): void {
  cache.delete(key);
}

export function cacheClearByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
