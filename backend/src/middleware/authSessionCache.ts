// requireAuth's per-user cache of session state (tokenVersion, tier, email).
//
// Its own module so routes that change tier or revoke sessions can invalidate
// it without importing requireAuth itself (route tests mock requireAuth.js).

export interface AuthRow { tokenVersion: number; tier: string | null; email: string | null }
export type AuthCacheValue = AuthRow | null | 'unavailable';

const authCache = new Map<string, { at: number; row: AuthCacheValue }>();
const MAX_ENTRIES = 20_000;

export function authCacheTtlMs(): number {
  const raw = process.env.AUTH_CACHE_TTL_MS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  // Route tests swap prisma mocks between cases for the same user id.
  return process.env.NODE_ENV === 'test' ? 0 : 60_000;
}

export function getCachedAuth(userId: string, now = Date.now()): AuthCacheValue | undefined {
  const ttl = authCacheTtlMs();
  if (ttl <= 0) return undefined;
  const hit = authCache.get(userId);
  return hit && now - hit.at < ttl ? hit.row : undefined;
}

export function setCachedAuth(userId: string, row: AuthCacheValue, now = Date.now()): void {
  if (authCacheTtlMs() <= 0) return;
  authCache.set(userId, { at: now, row });
  if (authCache.size > MAX_ENTRIES) {
    const first = authCache.keys().next().value;
    if (first !== undefined) authCache.delete(first);
  }
}

/** Drop the cached session state for one user, or for everyone. */
export function invalidateAuthCache(userId?: string): void {
  if (userId) authCache.delete(userId);
  else authCache.clear();
}
