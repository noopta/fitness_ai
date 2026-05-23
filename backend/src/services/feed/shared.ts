/**
 * Shared primitives for the research-feed adapters.
 *
 * Each external source (PubMed, OpenAlex, ClinicalTrials.gov, university RSS,
 * Huberman Lab, …) writes to the same `FeedItem` table and shares a tag
 * taxonomy. This module centralises:
 *   - the tag enum + label map (also re-exported by feedService.ts for
 *     backward compatibility),
 *   - the LLM summarisation helper + refusal heuristic,
 *   - a stripped-down RSS parser used by every RSS-based adapter,
 *   - `persistFeedItem` — the single write-path so per-source code only
 *     has to produce a draft, not duplicate the dedupe/insert logic.
 */

import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

export const TAG_LABELS: Record<FeedTag, string> = {
  strength: 'Strength',
  hypertrophy: 'Muscle Building',
  fat_loss: 'Fat Loss',
  nutrition: 'Nutrition',
  recovery: 'Recovery',
  cardio: 'Cardio',
  lifestyle: 'Lifestyle',
  general: 'Fitness',
};

// ─── Summariser ───────────────────────────────────────────────────────────────

/**
 * Two-to-three-sentence plain-English summary tailored to a fitness user.
 * Called with either a research abstract or a news/RSS description.
 */
export async function summarize(
  title: string,
  rawText: string,
  type: 'research' | 'article',
): Promise<string> {
  const context = type === 'research'
    ? 'This is a peer-reviewed research abstract.'
    : 'This is a health/fitness article from a reputable source.';

  const response = await (openai as any).responses.create({
    model: 'gpt-5-mini-2025-08-07',
    input: `${context} Write a 2-3 sentence plain-English summary a fitness enthusiast would find useful. Be specific about the finding or key takeaway. Do not start with "This study" or "This article".\n\nTitle: ${title}\n\nContent: ${rawText.slice(0, 1500)}`,
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  });
  return (response.output_text as string).trim();
}

/**
 * Heuristic to catch GPT refusals. When we feed the summariser a thin context
 * (e.g. title only, no abstract), the model politely responds with "I don't
 * have the study's results — please paste the abstract" instead of a real
 * summary. Reject those so they never reach the feed.
 *
 * Normalises typographic punctuation first; an earlier version missed real-
 * world refusals because they used curly apostrophes / em-dashes while the
 * heuristic compared against ASCII.
 */
export function isFallbackRefusal(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');

  if (t.length < 60) return true;

  return (
    t.includes("don't have") ||
    t.includes('do not have') ||
    t.includes('paste') ||
    t.includes('could you') ||
    t.includes('can you provide') ||
    t.includes('only the title') ||
    t.includes('only have the title') ||
    t.includes("study's results") ||
    t.includes('cannot summarize') ||
    t.includes("can't summarize") ||
    /^\s*(i |i'|please )/i.test(t) ||
    t.includes('the abstract')
  );
}

// ─── RSS parsing (used by every RSS-based adapter) ───────────────────────────

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

/**
 * Minimal RSS 2.0 / Atom-ish parser. Doesn't pull in a dependency for what
 * is fundamentally string-munging across well-formed feed XML.
 */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      ).exec(block);
      return (m?.[1] ?? m?.[2] ?? '').trim();
    };
    const title = stripHtml(get('title'));
    const link = get('link');
    if (title && link) {
      items.push({
        title,
        link,
        description: stripHtml(get('description')),
        pubDate: get('pubDate'),
      });
    }
  }
  // Atom <entry> fallback for feeds (e.g. YouTube) that aren't RSS 2.0.
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = stripHtml(extractTag(block, 'title'));
      const link = extractAttr(block, 'link', 'href') || extractTag(block, 'id');
      if (!title || !link) continue;
      items.push({
        title,
        link,
        description: stripHtml(
          extractTag(block, 'summary') || extractTag(block, 'content') || extractTag(block, 'media:description'),
        ),
        pubDate: extractTag(block, 'published') || extractTag(block, 'updated'),
      });
    }
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(
    `<${escaped}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escaped}>|<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`,
  ).exec(block);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

function extractAttr(block: string, tag: string, attr: string): string {
  const m = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"[^>]*\\/?>`).exec(block);
  return m?.[1] ?? '';
}

/** Strip HTML tags from a string. RSS descriptions often embed markup. */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export interface FeedItemDraft {
  externalId: string;          // namespaced unique key, e.g. "openalex:W123"
  type: 'research' | 'article';
  title: string;
  summary: string;             // post-summariser plain English
  url: string;                 // canonical landing page
  source: string;              // user-facing label
  tags: FeedTag[];
  publishedAt: Date | null;
}

/**
 * Insert a single feed item, swallowing duplicates so a re-fetch is idempotent.
 * Returns true if a new row was created.
 */
export async function persistFeedItem(draft: FeedItemDraft): Promise<boolean> {
  try {
    const exists = await prisma.feedItem.findUnique({ where: { externalId: draft.externalId } });
    if (exists) return false;
    await prisma.feedItem.create({
      data: {
        externalId: draft.externalId,
        type: draft.type,
        title: draft.title,
        summary: draft.summary,
        url: draft.url,
        source: draft.source,
        tags: JSON.stringify(draft.tags),
        publishedAt: draft.publishedAt,
      },
    });
    return true;
  } catch {
    // Race or constraint failure — externalId is unique, so a duplicate insert
    // just means another fetcher won. Not an error worth surfacing.
    return false;
  }
}
