// Google OAuth return handling.
//
// The backend redirects to `/login#auth=success&token=<jwt>` (URL fragment, so
// the bearer token never reaches server logs or Referer headers). Older
// backends used the query string (`?auth=success&token=`); errors arrive as
// `?auth=error`. Both shapes are accepted.

export const BEARER_TOKEN_KEY = 'liftoff_bearer_token';

export function readOAuthReturn(loc: { search?: string; hash?: string }): {
  auth: string | null;
  token: string | null;
} {
  const rawHash = loc.hash ?? '';
  const hash = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash);
  const query = new URLSearchParams(loc.search ?? '');
  const auth = hash.get('auth') ?? query.get('auth');
  const raw = hash.get('token') ?? query.get('token');
  const token = raw && raw.trim() ? raw.trim() : null;
  return { auth, token };
}

/**
 * Runs at module load, before analytics initialises: if the current URL is an
 * OAuth success return carrying a token, store the token in sessionStorage and
 * rewrite the URL without it (keeping `auth=success` so the login page still
 * reacts). This keeps the JWT out of anything PostHog records at init time
 * (e.g. `$initial_current_url`). Returns the token it found, if any.
 */
export function scrubOAuthTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const { auth, token } = readOAuthReturn(window.location);
  if (auth !== 'success' || !token) return null;
  try {
    sessionStorage.setItem(BEARER_TOKEN_KEY, token);
  } catch {
    /* storage blocked — cookie auth may still work */
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  hash.delete('token');
  const qs = url.searchParams.toString();
  const hs = hash.toString();
  window.history.replaceState(window.history.state, '', url.pathname + (qs ? `?${qs}` : '') + (hs ? `#${hs}` : ''));
  return token;
}
