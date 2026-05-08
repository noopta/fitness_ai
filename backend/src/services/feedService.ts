import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const prisma = new PrismaClient();

// ─── Tag taxonomy ─────────────────────────────────────────────────────────────

export type FeedTag =
  | 'strength'
  | 'hypertrophy'
  | 'fat_loss'
  | 'nutrition'
  | 'recovery'
  | 'cardio'
  | 'lifestyle'
  | 'general';

const TAG_LABELS: Record<FeedTag, string> = {
  strength: 'Strength',
  hypertrophy: 'Muscle Building',
  fat_loss: 'Fat Loss',
  nutrition: 'Nutrition',
  recovery: 'Recovery',
  cardio: 'Cardio',
  lifestyle: 'Lifestyle',
  general: 'Fitness',
};

// PubMed search query per tag
const PUBMED_QUERIES: Record<FeedTag, string> = {
  strength:    'resistance training strength gain[tiab]',
  hypertrophy: 'muscle hypertrophy resistance training[tiab]',
  fat_loss:    'fat loss body recomposition resistance training[tiab]',
  nutrition:   'sports nutrition protein intake athletes[tiab]',
  recovery:    'exercise recovery sleep muscle repair[tiab]',
  cardio:      'cardiovascular fitness aerobic exercise health[tiab]',
  lifestyle:   'physical activity health outcomes wellness[tiab]',
  general:     'exercise training health benefits[tiab]',
};

// RSS feeds from reputable sources
const RSS_FEEDS = [
  { url: 'https://www.health.harvard.edu/blog/feed', source: 'Harvard Health' },
  { url: 'https://newsinhealth.nih.gov/rss/news', source: 'NIH News in Health' },
];

// ─── Goal → Tags extraction ───────────────────────────────────────────────────

export function extractTagsFromGoal(
  savedProgramGoal?: string | null,
  trainingStyle?: string | null,
  primaryGoal?: string | null,
): FeedTag[] {
  const tags = new Set<FeedTag>();
  const text = `${savedProgramGoal ?? ''} ${trainingStyle ?? ''} ${primaryGoal ?? ''}`.toLowerCase();

  if (/strength|strong|powerl/.test(text)) tags.add('strength');
  if (/muscle|hypertro|size|mass|bulk/.test(text)) tags.add('hypertrophy');
  if (/fat.?loss|weight.?loss|cut|lean|deficit|slim/.test(text)) tags.add('fat_loss');
  if (/nutri|diet|protein|macro|food|eat/.test(text)) tags.add('nutrition');
  if (/recov|sleep|rest|soreness/.test(text)) tags.add('recovery');
  if (/cardio|endur|aerobic|run|hiit/.test(text)) tags.add('cardio');
  if (/lifestyle|health|wellnes|general/.test(text)) tags.add('lifestyle');

  // trainingStyle field direct mappings
  if (trainingStyle === 'muscle') tags.add('hypertrophy');
  if (trainingStyle === 'strength') tags.add('strength');
  if (trainingStyle === 'cardio') tags.add('cardio');

  if (tags.size === 0) tags.add('general');
  return Array.from(tags);
}

export async function getUserGoalTags(userId: string): Promise<FeedTag[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { savedProgram: true, coachProfile: true },
  });
  if (!user) return ['general'];

  let savedProgramGoal: string | null = null;
  let trainingStyle: string | null = null;
  let primaryGoal: string | null = null;

  if (user.savedProgram) {
    try {
      const prog = JSON.parse(user.savedProgram);
      savedProgramGoal = prog.goal ?? null;
    } catch { /* ignore */ }
  }
  if (user.coachProfile) {
    try {
      const profile = JSON.parse(user.coachProfile);
      trainingStyle = profile.trainingStyle ?? profile.trainingPreference ?? null;
      primaryGoal = profile.primaryGoal ?? null;
    } catch { /* ignore */ }
  }

  return extractTagsFromGoal(savedProgramGoal, trainingStyle, primaryGoal);
}

// ─── GPT summarizer (Responses API, gpt-5-mini-2025-08-07) ───────────────────

async function summarize(title: string, rawText: string, type: 'research' | 'article'): Promise<string> {
  const context = type === 'research'
    ? 'This is a peer-reviewed research abstract.'
    : 'This is a health/fitness article from a reputable source.';

  const response = await (openai as any).responses.create({
    model: 'gpt-5-mini-2025-08-07',
    input: `${context} Write a 2–3 sentence plain-English summary a fitness enthusiast would find useful. Be specific about the finding or key takeaway. Do not start with "This study" or "This article".\n\nTitle: ${title}\n\nContent: ${rawText.slice(0, 1500)}`,
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  });
  return (response.output_text as string).trim();
}

/**
 * Heuristic to catch GPT refusals — when we hand it just a title with no
 * abstract, the model politely says "I don't have the study's results" or
 * "Please paste the abstract", which we then save as the user-facing summary.
 * Reject these so they never reach the feed.
 *
 * Earlier version of this function missed a real-world refusal because GPT
 * uses curly apostrophes ('') and em-dashes (—) in its prose, while the
 * heuristic compared against ASCII straight apostrophes. We now normalize
 * the text first and use a broader set of refusal-only signals: words like
 * "paste", "could you", and "can you provide" almost never appear in a real
 * 2–3 sentence research summary, so their presence reliably flags a refusal.
 */
function isFallbackRefusal(text: string): boolean {
  // Normalize so curly/typographic punctuation matches ASCII checks.
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")  // curly single quotes → '
    .replace(/[“”]/g, '"')  // curly double quotes → "
    .replace(/[–—]/g, '-'); // en-/em-dashes → -

  if (t.length < 60) return true;

  return (
    t.includes("don't have") ||
    t.includes('do not have') ||
    t.includes('paste') ||             // "paste the abstract", "paste the study's results"
    t.includes('could you') ||
    t.includes('can you provide') ||
    t.includes('only the title') ||
    t.includes('only have the title') ||
    t.includes("study's results") ||
    t.includes('cannot summarize') ||
    t.includes("can't summarize") ||
    // Real research summaries don't address the reader directly with "i" or
    // "please" in the opening clause. Strong signal of a refusal.
    /^\s*(i |i'|please )/i.test(t) ||
    // GPT refusals frequently mention "the abstract" as a noun the user
    // should provide; valid summaries about a study don't refer to "the
    // abstract" — they refer to the study itself.
    t.includes('the abstract')
  );
}

// ─── PubMed fetcher ───────────────────────────────────────────────────────────

interface PubMedSummary {
  uid: string;
  title: string;
  source: string;
  pubdate: string;
  abstract?: string;
  articleids?: Array<{ idtype: string; value: string }>;
}

async function fetchPubMed(tag: FeedTag, maxResults = 5): Promise<void> {
  const query = encodeURIComponent(PUBMED_QUERIES[tag]);
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=${maxResults}&retmode=json&sort=relevance&mindate=2020&datetype=pdat`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) return;
  const searchData = await searchRes.json() as { esearchresult?: { idlist?: string[] } };
  const ids: string[] = searchData.esearchresult?.idlist ?? [];
  if (ids.length === 0) return;

  // Fetch summaries
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryRes = await fetch(summaryUrl);
  if (!summaryRes.ok) return;
  const summaryData = await summaryRes.json() as { result?: Record<string, PubMedSummary> };
  const result = summaryData.result ?? {};

  for (const pmid of ids) {
    const item = result[pmid];
    if (!item || !item.title) continue;

    const externalId = `pubmed:${pmid}`;
    const exists = await prisma.feedItem.findUnique({ where: { externalId } });
    if (exists) continue;

    // Fetch abstract via efetch
    let abstract = '';
    try {
      const abstractRes = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`
      );
      if (abstractRes.ok) abstract = await abstractRes.text();
    } catch { /* skip */ }

    // Without an abstract, GPT can only stare at the title — the resulting
    // summary is a polite refusal ("I don't have the study's results"). Skip
    // these so they never reach the feed.
    if (!abstract || abstract.trim().length < 100) continue;

    let summary = '';
    try {
      summary = await summarize(item.title, abstract, 'research');
    } catch { continue; }

    if (isFallbackRefusal(summary)) continue;

    // Always use the PubMed URL — DOI redirects are unreliable (malformed DOIs
    // return a 200 "DOI NOT FOUND" HTML page which the WebView can't detect as an error).
    const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

    let publishedAt: Date | null = null;
    if (item.pubdate) {
      const d = new Date(item.pubdate);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    await prisma.feedItem.create({
      data: {
        externalId,
        type: 'research',
        title: item.title,
        summary,
        url,
        source: 'PubMed',
        tags: JSON.stringify([tag]),
        publishedAt,
      },
    });
  }
}

// ─── RSS fetcher ──────────────────────────────────────────────────────────────

function parseRssItems(xml: string): Array<{ title: string; link: string; description: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; description: string; pubDate: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return (m?.[1] ?? m?.[2] ?? '').trim();
    };
    const title = get('title');
    const link = get('link');
    if (title && link) {
      items.push({ title, link, description: get('description'), pubDate: get('pubDate') });
    }
  }
  return items;
}

async function fetchRSS(feedUrl: string, source: string): Promise<void> {
  let xml = '';
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    xml = await res.text();
  } catch { return; }

  const items = parseRssItems(xml).slice(0, 8);
  for (const item of items) {
    const externalId = `rss:${item.link}`;
    const exists = await prisma.feedItem.findUnique({ where: { externalId } });
    if (exists) continue;

    let summary = '';
    try {
      summary = await summarize(item.title, item.description || item.title, 'article');
    } catch { continue; }

    let publishedAt: Date | null = null;
    if (item.pubDate) {
      const d = new Date(item.pubDate);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    await prisma.feedItem.create({
      data: {
        externalId,
        type: 'article',
        title: item.title,
        summary,
        url: item.link,
        source,
        tags: JSON.stringify(['general', 'lifestyle']),
        publishedAt,
      },
    });
  }
}

// ─── Daily runner ─────────────────────────────────────────────────────────────

export async function runDailyFeedFetch(): Promise<void> {
  console.log('[feedService] Starting daily fetch…');
  const tags: FeedTag[] = ['strength', 'hypertrophy', 'fat_loss', 'nutrition', 'recovery', 'cardio', 'lifestyle'];

  // PubMed — 5 per tag, sequential to respect rate limits
  for (const tag of tags) {
    try {
      await fetchPubMed(tag, 5);
      await new Promise(r => setTimeout(r, 400)); // ~2.5 req/s — within NCBI's free limit
    } catch (e) {
      console.error(`[feedService] PubMed error for tag ${tag}:`, e);
    }
  }

  // RSS feeds
  for (const feed of RSS_FEEDS) {
    try {
      await fetchRSS(feed.url, feed.source);
    } catch (e) {
      console.error(`[feedService] RSS error for ${feed.source}:`, e);
    }
  }

  console.log('[feedService] Daily fetch complete.');
}

// ─── Feed query ───────────────────────────────────────────────────────────────

export interface FeedItemQueryOptions {
  excludeSeenForUserId?: string;
  // When recall is exhausted (everything seen), allow returning seen items so the
  // feed isn't empty. Used as a fallback signal to the route — see "exhausted".
  allowSeenFallback?: boolean;
}

export interface FeedItemQueryResult {
  items: any[];
  exhausted: boolean; // true when we couldn't fill `limit` with unseen items
}

export async function getFeedItemsForTags(
  tags: FeedTag[],
  limit = 10,
  opts: FeedItemQueryOptions = {},
): Promise<FeedItemQueryResult> {
  // Pull a wider pool than `limit` so per-user filtering still leaves enough to score.
  const POOL = Math.max(200, limit * 30);

  let seenItemIds = new Set<string>();
  if (opts.excludeSeenForUserId) {
    const views = await prisma.userFeedView.findMany({
      where: { userId: opts.excludeSeenForUserId },
      select: { feedItemId: true },
    });
    seenItemIds = new Set(views.map(v => v.feedItemId));
  }

  const allItems = await prisma.feedItem.findMany({
    orderBy: { fetchedAt: 'desc' },
    take: POOL,
  });

  const tagSet = new Set(tags);
  const scored = allItems.map(item => {
    let itemTags: string[] = [];
    try { itemTags = JSON.parse(item.tags); } catch { /* ignore */ }
    const overlap = itemTags.filter(t => tagSet.has(t as FeedTag)).length;
    return { item, overlap };
  });

  scored.sort((a, b) => b.overlap - a.overlap || b.item.fetchedAt.getTime() - a.item.fetchedAt.getTime());

  const unseen = scored.filter(({ item }) => !seenItemIds.has(item.id));
  let chosen = unseen.slice(0, limit);
  let exhausted = false;
  if (chosen.length < limit && opts.allowSeenFallback) {
    // Top up from seen items, oldest-viewed first — but we don't have that order
    // here without a join, so just use the same scored order. The route will mark
    // these as already-shown so the UI can label "you're caught up."
    exhausted = true;
    const need = limit - chosen.length;
    const filler = scored.filter(s => seenItemIds.has(s.item.id)).slice(0, need);
    chosen = [...chosen, ...filler];
  } else if (chosen.length < limit) {
    exhausted = true;
  }

  const items = chosen.map(({ item }) => ({
    id: item.id,
    type: item.type as 'research' | 'article',
    title: item.title,
    summary: item.summary,
    url: item.url,
    source: item.source,
    tags: (() => { try { return JSON.parse(item.tags) as string[]; } catch { return []; } })(),
    publishedAt: item.publishedAt?.toISOString() ?? null,
    fetchedAt: item.fetchedAt.toISOString(),
  }));

  return { items, exhausted };
}

// Mark items as viewed by a user. Idempotent (unique on userId+feedItemId).
export async function recordFeedViews(userId: string, feedItemIds: string[]): Promise<void> {
  if (feedItemIds.length === 0) return;
  await prisma.userFeedView.createMany({
    data: feedItemIds.map(feedItemId => ({ userId, feedItemId })),
    // SQLite supports skipDuplicates with createMany via Prisma since 4.x
    // but if not available the @@unique will throw — wrap in try/catch as fallback.
  }).catch(async () => {
    for (const feedItemId of feedItemIds) {
      try {
        await prisma.userFeedView.create({ data: { userId, feedItemId } });
      } catch { /* already exists */ }
    }
  });
}

// On-demand source fetch trigger, rate-limited per user. Returns whether we
// actually pulled new content.
const lastSourceFetchAt = new Map<string, number>();
const ON_DEMAND_COOLDOWN = 60 * 1000;          // 60s for user-triggered (pull-to-refresh)
const BG_FETCH_COOLDOWN  = 5 * 60 * 1000;       // 5min for the legacy-style background path

/**
 * Targeted PubMed fetch for a single tag with all per-PMID work done in
 * parallel. The shared `fetchPubMed` does it sequentially because it runs
 * inside the daily cron — there speed doesn't matter and serial keeps us
 * polite to PubMed. On a user-triggered refresh, we want results fast.
 */
async function fetchPubMedParallel(tag: FeedTag, maxResults = 3): Promise<void> {
  const query = encodeURIComponent(PUBMED_QUERIES[tag]);
  // Two diversification levers so a user-triggered refresh actually surfaces
  // items they haven't already saved:
  //   - sort=date: most recent first, so newly-published research surfaces.
  //   - retstart at a random offset: walks through the result space across
  //     successive refreshes so we don't keep hitting the same N abstracts.
  const offset = Math.floor(Math.random() * 80);
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=${maxResults * 6}&retstart=${offset}&retmode=json&sort=date&mindate=2022&datetype=pdat`;
  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!searchRes?.ok) return;
  const searchData = await searchRes.json() as { esearchresult?: { idlist?: string[] } };
  const ids: string[] = searchData.esearchresult?.idlist ?? [];
  if (ids.length === 0) return;

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!summaryRes?.ok) return;
  const summaryData = await summaryRes.json() as { result?: Record<string, PubMedSummary> };
  const result = summaryData.result ?? {};

  await Promise.allSettled(ids.map(async (pmid) => {
    const item = result[pmid];
    if (!item?.title) return;

    const externalId = `pubmed:${pmid}`;
    const exists = await prisma.feedItem.findUnique({ where: { externalId } });
    if (exists) return;

    let abstract = '';
    try {
      const abstractRes = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (abstractRes.ok) abstract = await abstractRes.text();
    } catch { /* skip */ }

    // Skip articles where we couldn't fetch a real abstract — GPT given just a
    // title produces "I don't have the study's results" fallback text.
    if (!abstract || abstract.trim().length < 100) return;

    let summary = '';
    try {
      summary = await summarize(item.title, abstract, 'research');
    } catch { return; }

    if (isFallbackRefusal(summary)) return;

    const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
    let publishedAt: Date | null = null;
    if (item.pubdate) {
      const d = new Date(item.pubdate);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    await prisma.feedItem.create({
      data: {
        externalId,
        type: 'research',
        title: item.title,
        summary,
        url,
        source: 'PubMed',
        tags: JSON.stringify([tag]),
        publishedAt,
      },
    }).catch(() => { /* race with another fetch — externalId unique constraint */ });
  }));
}

/**
 * Fast, awaitable, user-specific source fetch. Hits the user's top 2 tags in
 * parallel and returns when both finish (or fail). Total wall time ~5-10s on
 * a healthy network. Drops the per-user research cache so the next read
 * picks up newly-inserted items.
 */
async function fetchOnDemandForUser(userId: string, tags: FeedTag[]): Promise<void> {
  const target = tags.slice(0, 2); // cap latency — 2 tags is plenty for pull-to-refresh
  if (target.length === 0) return;
  await Promise.allSettled(target.map(tag => fetchPubMedParallel(tag, 3)));
  invalidateResearchCache(userId);
}

/**
 * @param userId - viewer
 * @param userTags - when provided, runs the fast user-targeted fetch and AWAITS it
 *                   so the caller can re-query the DB and serve a hot response.
 *                   When omitted, kicks off the legacy background fetch.
 */
export async function maybeFetchFromSources(userId: string, userTags?: FeedTag[]): Promise<boolean> {
  const last = lastSourceFetchAt.get(userId) ?? 0;
  const cooldown = userTags ? ON_DEMAND_COOLDOWN : BG_FETCH_COOLDOWN;
  if (Date.now() - last < cooldown) return false;
  lastSourceFetchAt.set(userId, Date.now());

  if (userTags && userTags.length > 0) {
    try {
      await fetchOnDemandForUser(userId, userTags);
      return true;
    } catch (e) {
      console.error('[feedService] on-demand fetch failed:', e);
      return false;
    }
  }

  // Legacy background path — kicks off the full daily fetch fire-and-forget.
  runDailyFeedFetch().then(() => invalidateResearchCache()).catch(e => {
    console.error('[feedService] background fetch failed:', e);
  });
  return true;
}

// ─── Research item cache (in-process, per user+tags, 10-min TTL) ─────────────
// Avoids a DB round-trip on every feed load for data that changes at most once/day.

const researchCache = new Map<string, { items: any[]; exhausted: boolean; expiresAt: number }>();
const RESEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export interface CachedFeedOptions {
  forceRefresh?: boolean;
  excludeSeen?: boolean;
}

export async function getCachedFeedItems(
  userId: string,
  tags: FeedTag[],
  limit = 10,
  options: CachedFeedOptions = {},
): Promise<{ items: any[]; exhausted: boolean }> {
  const key = `${userId}:${[...tags].sort().join(',')}:${options.excludeSeen ? 'unseen' : 'all'}`;
  if (!options.forceRefresh) {
    const hit = researchCache.get(key);
    if (hit && Date.now() < hit.expiresAt) return { items: hit.items, exhausted: hit.exhausted };
  }

  const result = await getFeedItemsForTags(tags, limit, {
    excludeSeenForUserId: options.excludeSeen ? userId : undefined,
    allowSeenFallback: options.excludeSeen,
  });
  researchCache.set(key, {
    items: result.items,
    exhausted: result.exhausted,
    expiresAt: Date.now() + RESEARCH_CACHE_TTL,
  });
  return result;
}

// Called by the daily fetch job so fresh items are reflected on next TTL expiry
export function invalidateResearchCache(userId?: string): void {
  if (userId) {
    for (const key of researchCache.keys()) {
      if (key.startsWith(`${userId}:`)) researchCache.delete(key);
    }
  } else {
    researchCache.clear();
  }
}

export { TAG_LABELS };
