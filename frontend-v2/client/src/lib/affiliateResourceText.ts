import { affiliateFetch } from '@/lib/affiliateToken';

/**
 * Fetch a markdown resource's text: mint a short-lived signed link with the
 * affiliate token (header), then GET the signed URL. The token never goes
 * into the file URL.
 */
export async function fetchAffiliateResourceText(slug: string, token: string): Promise<string> {
  const res = await affiliateFetch(`/affiliate/resources/${encodeURIComponent(slug)}/link`, token);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.url) throw new Error(d.error || 'Failed to open document');
  const file = await fetch(d.url);
  if (!file.ok) throw new Error('Failed to load document');
  return file.text();
}
