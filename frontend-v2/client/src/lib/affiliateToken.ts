// Affiliate invite token = the affiliate's credential. It travels only in the
// X-Affiliate-Token header (never a query string, which leaks into logs,
// Referer headers and browser history) and lives in sessionStorage so it does
// not outlive the tab.

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';
const KEY = 'affiliateToken';

export function getAffiliateToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAffiliateToken(token: string) {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* storage blocked */
  }
}

export function clearAffiliateToken() {
  try {
    sessionStorage.removeItem(KEY);
    // Legacy copies written by older builds.
    localStorage.removeItem(KEY);
    localStorage.removeItem('affiliateEmail');
  } catch {
    /* storage blocked */
  }
}

/**
 * Read `?token=` from the current URL (the affiliate's personal link), then
 * strip it from the address bar so it never lingers in history. Falls back to
 * the session copy; migrates (and deletes) any legacy localStorage copy.
 */
export function consumeAffiliateTokenFromUrl(): string {
  const url = new URL(window.location.href);
  const urlToken = url.searchParams.get('token')?.trim() ?? '';
  if (url.searchParams.has('token')) {
    url.searchParams.delete('token');
    const qs = url.searchParams.toString();
    window.history.replaceState(window.history.state, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
  }
  let legacy = '';
  try {
    legacy = localStorage.getItem(KEY) ?? '';
    localStorage.removeItem(KEY);
    localStorage.removeItem('affiliateEmail');
  } catch {
    /* storage blocked */
  }
  const token = urlToken || getAffiliateToken() || legacy;
  if (token) setAffiliateToken(token);
  return token;
}

/** fetch() against the API with the affiliate token in X-Affiliate-Token. */
export function affiliateFetch(path: string, token: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['X-Affiliate-Token'] = token;
  return fetch(`${API}${path}`, { credentials: 'include', ...opts, headers });
}
