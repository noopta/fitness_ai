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

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
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
