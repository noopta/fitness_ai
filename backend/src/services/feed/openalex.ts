/**
 * OpenAlex adapter.
 *
 * OpenAlex is the largest free academic graph (~250M+ works). We use it as
 * a substitute for Google Scholar (which has no public API and forbids
 * scraping). Same end-user value: broad cross-journal coverage that goes
 * beyond what PubMed alone surfaces (PubMed is biomedical-only).
 *
 * API: https://api.openalex.org/works
 *   - No auth required.
 *   - Including ?mailto=… puts us in the "polite pool" with priority traffic.
 *   - Rate limit: 100k requests/day in the polite pool.
 *
 * Abstract format: OpenAlex returns abstracts as an inverted index
 *   { "the": [0, 4], "study": [1], "showed": [2], … }
 * which we reconstruct back into plain text before summarising.
 */

import {
  type FeedTag,
  type FeedItemDraft,
  summarize,
  isFallbackRefusal,
  persistFeedItem,
} from './shared.js';

const POLITE_EMAIL = process.env.OPENALEX_CONTACT_EMAIL ?? 'team@airthreads.ai';

/** Tag → search query. Tuned to surface intervention studies, not editorials. */
const OPENALEX_QUERIES: Record<FeedTag, string> = {
  strength:    'resistance training strength gain randomized',
  hypertrophy: 'muscle hypertrophy resistance training',
  fat_loss:    'fat loss body composition resistance training',
  nutrition:   'sports nutrition protein intake athletes',
  recovery:    'exercise recovery sleep muscle repair',
  cardio:      'cardiovascular fitness aerobic exercise health',
  lifestyle:   'physical activity sedentary behavior health',
  general:     'exercise training health benefits',
};

interface OpenAlexWork {
  id: string;                                // "https://openalex.org/W…"
  title: string | null;
  display_name: string | null;
  publication_date: string | null;
  doi: string | null;
  abstract_inverted_index: Record<string, number[]> | null;
  open_access?: { is_oa: boolean; oa_url: string | null };
  primary_location?: {
    source?: { display_name: string | null } | null;
    landing_page_url?: string | null;
  };
  cited_by_count?: number;
  type?: string;
}

/**
 * Reverse the inverted index back into a readable abstract.
 * Each map entry is `{word: [positions]}`; flatten and sort by position.
 */
function reconstructAbstract(inverted: Record<string, number[]> | null): string {
  if (!inverted) return '';
  const tokens: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const p of positions) tokens.push([p, word]);
  }
  tokens.sort((a, b) => a[0] - b[0]);
  return tokens.map(([, w]) => w).join(' ');
}

/**
 * Pick the most-useful URL for the user, in priority order:
 *   1. Open-access PDF / landing page (free, no paywall).
 *   2. DOI (publisher landing; may be paywalled).
 *   3. OpenAlex landing page (always works, has the abstract).
 */
function canonicalUrl(work: OpenAlexWork): string {
  if (work.open_access?.is_oa && work.open_access.oa_url) return work.open_access.oa_url;
  if (work.primary_location?.landing_page_url) return work.primary_location.landing_page_url;
  if (work.doi) return work.doi;
  return work.id;
}

/** "https://openalex.org/W123" → "openalex:W123" */
function externalIdForWork(work: OpenAlexWork): string {
  const slug = (work.id ?? '').split('/').pop() ?? '';
  return `openalex:${slug}`;
}

export async function fetchOpenAlex(tag: FeedTag, maxResults = 5): Promise<void> {
  const query = encodeURIComponent(OPENALEX_QUERIES[tag]);
  const url =
    `https://api.openalex.org/works?search=${query}` +
    `&filter=type:article,from_publication_date:2022-01-01,has_abstract:true` +
    `&per-page=${maxResults * 4}` + // over-fetch — many drop out at the refusal filter
    `&sort=relevance_score:desc` +
    `&mailto=${encodeURIComponent(POLITE_EMAIL)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return;
  }
  if (!res.ok) return;
  const data = await res.json() as { results?: OpenAlexWork[] };
  const works = (data.results ?? []).filter((w) => w.title && w.abstract_inverted_index);

  let kept = 0;
  for (const work of works) {
    if (kept >= maxResults) break;
    const draft = await draftFromWork(work, tag);
    if (!draft) continue;
    const created = await persistFeedItem(draft);
    if (created) kept++;
  }
}

async function draftFromWork(work: OpenAlexWork, tag: FeedTag): Promise<FeedItemDraft | null> {
  const title = (work.title ?? work.display_name ?? '').trim();
  if (!title) return null;

  const abstract = reconstructAbstract(work.abstract_inverted_index).trim();
  if (abstract.length < 100) return null;

  let summary: string;
  try {
    summary = await summarize(title, abstract, 'research');
  } catch {
    return null;
  }
  if (isFallbackRefusal(summary)) return null;

  const journal = work.primary_location?.source?.display_name ?? 'OpenAlex';
  let publishedAt: Date | null = null;
  if (work.publication_date) {
    const d = new Date(work.publication_date);
    if (!isNaN(d.getTime())) publishedAt = d;
  }

  return {
    externalId: externalIdForWork(work),
    type: 'research',
    title,
    summary,
    url: canonicalUrl(work),
    // We surface the actual journal name when we have it (it carries more
    // signal than a generic "OpenAlex"). When the work is from a noisy venue
    // or missing the field, fall back to the platform name.
    source: journal !== 'OpenAlex' ? `${journal} (via OpenAlex)` : 'OpenAlex',
    tags: [tag],
    publishedAt,
  };
}
