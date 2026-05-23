/**
 * Top-tier university / academic-medicine RSS adapter.
 *
 * One generic fetcher driven by a curated registry. Inclusion criteria
 * (from the founder): only schools in the "Oxford / Stanford / Harvard" tier
 * for medicine and biological research. These are public health/medicine
 * news feeds from the institution itself — not third-party aggregators.
 *
 * Each feed maps to a default tag set (e.g., Stanford Medicine is broadly
 * "general + lifestyle" until we can keyword-route per item; specific
 * sub-feeds carry more pointed defaults). Keyword routing across feeds is
 * intentionally NOT done here so we don't double-cost the LLM summariser —
 * we tag conservatively and let the user's goal-overlap scoring decide
 * surfacing.
 */

import {
  type FeedTag,
  type FeedItemDraft,
  summarize,
  isFallbackRefusal,
  persistFeedItem,
  parseRssItems,
  stripHtml,
} from './shared.js';

interface UniversityFeed {
  url: string;
  source: string;
  defaultTags: FeedTag[];
  /** Max items pulled per fetch — small for chatty feeds, larger for slow ones. */
  perFetch?: number;
}

/**
 * Curated, top-tier list. Each entry is a real RSS endpoint published by the
 * institution. Some URLs occasionally rotate when the host CMS changes; we
 * tolerate per-feed failures (each is wrapped in try/catch) so one stale URL
 * doesn't sink the rest.
 */
export const UNIVERSITY_FEEDS: UniversityFeed[] = [
  // Stanford
  { url: 'https://scopeblog.stanford.edu/feed/',
    source: 'Stanford Medicine (Scope)',
    defaultTags: ['general', 'lifestyle'] },
  { url: 'https://med.stanford.edu/news/all-news/rss.html',
    source: 'Stanford Medicine News',
    defaultTags: ['general'] },

  // Harvard
  { url: 'https://www.hsph.harvard.edu/news/feed/',
    source: 'Harvard T.H. Chan School of Public Health',
    defaultTags: ['nutrition', 'lifestyle'] },
  // (Harvard Health blog already in RSS_FEEDS in feedService.ts — left there
  //  so this file stays focused on the new top-tier additions.)

  // Oxford
  { url: 'https://www.medsci.ox.ac.uk/news/feed',
    source: 'Oxford Medical Sciences',
    defaultTags: ['general'] },

  // Johns Hopkins
  { url: 'https://hub.jhu.edu/feed/',
    source: 'Johns Hopkins',
    defaultTags: ['general', 'lifestyle'] },

  // Mayo Clinic
  { url: 'https://newsnetwork.mayoclinic.org/feed/',
    source: 'Mayo Clinic News Network',
    defaultTags: ['general', 'lifestyle'] },

  // Cleveland Clinic
  { url: 'https://health.clevelandclinic.org/feed/',
    source: 'Cleveland Clinic Health Essentials',
    defaultTags: ['general', 'lifestyle'] },

  // UCSF
  { url: 'https://www.ucsf.edu/news/feed',
    source: 'UCSF News',
    defaultTags: ['general'] },

  // Yale Medicine
  { url: 'https://medicine.yale.edu/news/feed/',
    source: 'Yale Medicine',
    defaultTags: ['general'] },
];

/**
 * Run all university feeds. Each call writes 0..N new FeedItems; one failure
 * doesn't affect the others.
 */
export async function fetchAllUniversityFeeds(): Promise<void> {
  for (const feed of UNIVERSITY_FEEDS) {
    try {
      await fetchUniversityFeed(feed);
    } catch (e) {
      console.error(`[feed/university] ${feed.source} fetch failed:`, e);
    }
  }
}

async function fetchUniversityFeed(feed: UniversityFeed): Promise<void> {
  let xml = '';
  try {
    const res = await fetch(feed.url, {
      signal: AbortSignal.timeout(10_000),
      // Some university CMSes (especially WordPress) need a real UA or they
      // return 403. The mailto reuses the same polite-pool email so it's
      // identifiable if a webmaster wants to flag traffic from us.
      headers: {
        'User-Agent': 'AxiomTrainingFeedFetcher/1.0 (+team@airthreads.ai)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!res.ok) return;
    xml = await res.text();
  } catch {
    return;
  }

  const items = parseRssItems(xml).slice(0, feed.perFetch ?? 6);

  for (const item of items) {
    const title = item.title.trim();
    const description = stripHtml(item.description).slice(0, 4000);
    if (!title || description.length < 80) continue;

    const externalId = `university:${feed.source}:${item.link}`;

    let summary: string;
    try {
      summary = await summarize(title, description || title, 'article');
    } catch {
      continue;
    }
    if (isFallbackRefusal(summary)) continue;

    let publishedAt: Date | null = null;
    if (item.pubDate) {
      const d = new Date(item.pubDate);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    const draft: FeedItemDraft = {
      externalId,
      type: 'article',
      title,
      summary,
      url: item.link,
      source: feed.source,
      tags: feed.defaultTags,
      publishedAt,
    };
    await persistFeedItem(draft);
  }
}
