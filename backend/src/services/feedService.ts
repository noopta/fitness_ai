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

    if (!abstract && !item.title) continue;

    let summary = '';
    try {
      summary = await summarize(item.title, abstract || item.title, 'research');
    } catch { continue; }

    const doi = item.articleids?.find(a => a.idtype === 'doi')?.value;
    const url = doi
      ? `https://doi.org/${doi}`
      : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

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

export async function getFeedItemsForTags(tags: FeedTag[], limit = 10): Promise<any[]> {
  // Try to find items matching the user's tags first, fall back to general
  const allItems = await prisma.feedItem.findMany({
    orderBy: { fetchedAt: 'desc' },
    take: 200,
  });

  // Score: items whose tags overlap with user tags rank higher
  const tagSet = new Set(tags);
  const scored = allItems.map(item => {
    let itemTags: string[] = [];
    try { itemTags = JSON.parse(item.tags); } catch { /* ignore */ }
    const overlap = itemTags.filter(t => tagSet.has(t as FeedTag)).length;
    return { item, overlap };
  });

  scored.sort((a, b) => b.overlap - a.overlap || b.item.fetchedAt.getTime() - a.item.fetchedAt.getTime());

  return scored.slice(0, limit).map(({ item }) => ({
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
}

export { TAG_LABELS };
