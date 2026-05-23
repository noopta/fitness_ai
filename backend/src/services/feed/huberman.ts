/**
 * Huberman Lab podcast adapter.
 *
 * Pulls episodes from the public Huberman Lab podcast RSS feed. Each episode
 * arrives with a title + show-notes description; we run those through the
 * summariser so cards stay short. Episodes link out to the canonical episode
 * page (hosted on the Huberman Lab site / a podcast service) which contains
 * the audio player, transcript, and references.
 *
 * Tag routing: episode titles + descriptions are keyword-matched against the
 * fitness tag taxonomy. A single episode often touches multiple topics (sleep
 * + exercise + nutrition), so we attach up to two matching tags.
 *
 * Feed URL: defaults to the megaphone-hosted feed (the publicly-advertised
 * podcast feed), overridable via HUBERMAN_FEED_URL if it moves.
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

const HUBERMAN_FEED_URL =
  process.env.HUBERMAN_FEED_URL ?? 'https://feeds.megaphone.fm/hubermanlab';

const TAG_KEYWORDS: Array<[FeedTag, RegExp]> = [
  ['strength',    /\b(strength|powerlift|lifting|barbell|deadlift|squat|bench press)\b/i],
  ['hypertrophy', /\b(muscle|hypertroph|growth|protein synthesis|gains?)\b/i],
  ['fat_loss',    /\b(fat ?loss|leanness|body composition|cutting|caloric deficit|weight loss)\b/i],
  ['nutrition',   /\b(nutrition|diet|protein|macros?|fasting|food|metabolism|supplement)\b/i],
  ['recovery',    /\b(recover|sleep|stress|cortisol|HRV|rest|deload|sauna|cold (exposure|plunge))\b/i],
  ['cardio',      /\b(cardio|aerobic|zone\s?2|VO2|running|heart rate|endurance)\b/i],
  ['lifestyle',   /\b(habit|circadian|morning routine|focus|productivity|dopamine|motivation)\b/i],
];

function tagsForEpisode(title: string, description: string): FeedTag[] {
  const text = `${title} ${description}`;
  const hits: FeedTag[] = [];
  for (const [tag, regex] of TAG_KEYWORDS) {
    if (regex.test(text)) hits.push(tag);
    if (hits.length >= 2) break;
  }
  return hits.length > 0 ? hits : ['general'];
}

/** Crude but reliable hash to derive a stable externalId from the episode URL. */
function slugFromUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\?.*$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80);
}

export async function fetchHubermanLab(maxResults = 6): Promise<void> {
  let xml = '';
  try {
    const res = await fetch(HUBERMAN_FEED_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    xml = await res.text();
  } catch {
    return;
  }

  const items = parseRssItems(xml).slice(0, maxResults * 2);

  for (const item of items) {
    const title = item.title.trim();
    // Show notes can be long — clip before summarising.
    const description = stripHtml(item.description).slice(0, 4000);
    if (!title || description.length < 120) continue;

    const externalId = `huberman:${slugFromUrl(item.link)}`;

    let summary: string;
    try {
      summary = await summarize(title, description, 'article');
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
      source: 'Huberman Lab',
      tags: tagsForEpisode(title, description),
      publishedAt,
    };
    await persistFeedItem(draft);
  }
}
