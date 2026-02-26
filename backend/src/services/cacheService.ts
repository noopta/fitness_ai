interface CacheEntry<T> {
  data: T;
  expiresAt: number | null; // null = no expiry
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
