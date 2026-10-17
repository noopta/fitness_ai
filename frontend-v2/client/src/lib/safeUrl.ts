// URL allow-listing for user- and model-supplied links. Anything that does not
// parse as an absolute http(s) URL (javascript:, data:, vbscript:, relative
// junk) is refused.

/** The normalised URL if `raw` is an absolute http(s) URL, else null. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * react-markdown `urlTransform`: keep http(s) and mailto links, plus in-app
 * relative paths and #anchors; everything else becomes an empty string
 * (react-markdown then renders an inert link).
 */
export function markdownUrlTransform(url: string): string {
  const v = (url ?? '').trim();
  if (!v) return '';
  if (v.startsWith('#')) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return v;
  } catch {
    /* not absolute */
  }
  return '';
}
