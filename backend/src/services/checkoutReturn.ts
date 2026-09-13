/**
 * Where web Checkout sends the user back to. Only a same-site path is
 * accepted — never a scheme, host or protocol-relative `//` — so this can't
 * become an open redirect. The lift diagnostic passes its own page so a
 * purchase lands back on the verdict it unlocks.
 */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(raw) ? raw : '';
}
