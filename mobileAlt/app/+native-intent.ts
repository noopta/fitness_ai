// Expo Router hook that runs on every incoming deep link, before routing.
//
// `axiom://auth/callback?token=…` is ambiguous as a URL: with two slashes,
// "auth" is the *authority* (host), so the path Expo Router actually receives
// is just "/callback" — and app/auth/callback.tsx never matches. The router
// falls through, the root gate sees no authenticated user, and the sign-in
// dies on the login screen.
//
// `Linking.createURL('/auth/callback')` emits the empty-authority form
// (`axiom:///auth/callback`), which parses correctly. But that URI makes a
// round-trip through Google and back out of an HTTP `Location` header, and
// anything along the way is free to normalize the empty authority away.
//
// So accept both spellings: rewrite the host form back to the path form.
// Links already in the `axiom:///…` shape are left untouched.

const SCHEME = 'axiom';

// A trainer's invite opens You → Coach with it preloaded (the pushed page
// `coach`): axiom://personal-training/join/<token> (the web link's path) and
// axiom://coach/join/<code> (the short code). Either spelling of the scheme,
// or a bare path from an app link.
const JOIN_TOKEN = /(?:^|\/)personal-training\/join\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[/?#])/i;
const JOIN_CODE = /(?:^|\/)coach\/join\/([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})(?=$|[/?#])/;

/** The Coach page for an invite link, or null when the path is something else. Exported for tests. */
export function coachInvitePath(path: string): string | null {
  const t = JOIN_TOKEN.exec(path);
  if (t) return `/p/coach?token=${encodeURIComponent(t[1].toLowerCase())}`;
  const c = JOIN_CODE.exec(path);
  if (c) return `/p/coach?code=${encodeURIComponent(c[1].toUpperCase())}`;
  return null;
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const invite = coachInvitePath(path);
    if (invite) return invite;
  } catch {
    // Never let a malformed link break launch.
  }
  try {
    const prefix = `${SCHEME}://`;
    // Only the two-slash (host) spelling with an actual host segment needs
    // rewriting. `axiom:///x` already starts with `${prefix}/`, and a bare
    // `axiom://` has nothing to move — both pass through untouched.
    if (
      path.length > prefix.length &&
      path.startsWith(prefix) &&
      !path.startsWith(`${prefix}/`)
    ) {
      return `${SCHEME}:///${path.slice(prefix.length)}`;
    }
  } catch {
    // A malformed link must never break app launch — fall through and let the
    // router handle (or 404) the original rather than crashing on boot.
  }
  return path;
}
