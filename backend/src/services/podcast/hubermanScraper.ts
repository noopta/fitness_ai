/**
 * Huberman Lab scraper — turns hubermanlab.com pages into structured data.
 *
 * The episode pages are server-rendered (transcript + chapters live in the raw
 * HTML), so a plain fetch + cheerio is enough — no headless browser.
 *
 * Two entry points:
 *   - fetchSubtopicEpisodes(url) → the episode cards on a /subtopics/ page
 *   - fetchEpisode(url)          → one episode's title, video, guest, chapters,
 *                                  and speaker-labeled transcript turns
 *
 * Parsing is deliberately strict: helpers throw if the page shape changes
 * (zero episodes, empty transcript) rather than silently ingesting garbage.
 */

import * as cheerio from 'cheerio';

export const HUBERMAN_BASE = 'https://www.hubermanlab.com';

export interface EpisodeRef {
  slug: string; // e.g. "dr-layne-norton-the-science-..."
  url: string; // absolute
  title: string; // best-effort title from the card
}

export interface Chapter {
  startSeconds: number;
  title: string;
}

export interface TranscriptTurn {
  speaker: string; // normalized display name, e.g. "Andrew Huberman"
  text: string;
}

export interface ParsedEpisode {
  slug: string;
  url: string;
  title: string;
  youtubeId: string | null;
  guestName: string | null;
  guestCredentials: string | null;
  chapters: Chapter[];
  transcript: TranscriptTurn[];
  durationSeconds: number; // approx — last chapter start (page has no exact end)
}

const HOST_NAME = 'Andrew Huberman';

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // hubermanlab.com 403s the default node UA; present a normal browser UA.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} → HTTP ${res.status}`);
  }
  return res.text();
}

// ── Subtopic page → episode list ─────────────────────────────────────────────

/**
 * Parse a /subtopics/<x> page into the episode cards that belong to it.
 * Scopes to `a.u-link-cover` (the card cover-links) so we don't pick up the
 * "Latest Episodes" / recommended links elsewhere on the page.
 */
export function parseSubtopicEpisodes(html: string, baseUrl = HUBERMAN_BASE): EpisodeRef[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: EpisodeRef[] = [];

  $('a.u-link-cover[href^="/episode/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const slug = href.replace(/^\/episode\//, '').split(/[?#]/)[0];
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    // The card title is the nearest preceding heading inside the same card.
    const card = $(el).closest('[role="listitem"], .w-dyn-item, div');
    const title = card.find('h1,h2,h3,h4').first().text().trim();
    out.push({ slug, url: `${baseUrl}/episode/${slug}`, title });
  });

  if (out.length === 0) {
    throw new Error('parseSubtopicEpisodes: found 0 episode cards — page shape may have changed');
  }
  return out;
}

export async function fetchSubtopicEpisodes(url: string): Promise<EpisodeRef[]> {
  return parseSubtopicEpisodes(await fetchHtml(url), HUBERMAN_BASE);
}

// ── Episode page → structured episode ────────────────────────────────────────

/** "00:06:50" or a `?timestamp=410` query value → seconds. */
function timestampToSeconds(href: string, display: string): number {
  const q = /[?&]timestamp=(\d+)/.exec(href);
  if (q) return parseInt(q[1], 10);
  const parts = display.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function extractChapters($: cheerio.CheerioAPI): Chapter[] {
  const chapters: Chapter[] = [];
  $('a[href*="timestamp="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const display = $(a).text().trim();
    const startSeconds = timestampToSeconds(href, display);
    // The chapter title is the text of the <li> after the <a>.
    const li = $(a).closest('li');
    let title = li.length ? li.text().replace(display, '').trim() : '';
    if (!title) title = ($(a)[0].next as any)?.data?.trim?.() || '';
    // Trim stray separator/entity chars that can hug the title (e.g. "&Dehydration&").
    title = decodeEntities(title).replace(/^[\s&|–—-]+|[\s&|–—-]+$/g, '').trim();
    if (title) chapters.push({ startSeconds, title });
  });
  // De-dupe + sort by time (page sometimes repeats the TOC).
  const byKey = new Map<string, Chapter>();
  for (const c of chapters) byKey.set(`${c.startSeconds}|${c.title}`, c);
  return [...byKey.values()].sort((a, b) => a.startSeconds - b.startSeconds);
}

// Three transcript formats exist across episodes (all inside .rich-text-transcript):
//   A) "<p>ANDREW HUBERMAN: text</p>"                 — all-caps name + colon, same <p>
//   B) "<p><strong>Andrew Huberman</strong> text</p>" — name in <strong>, no colon
//   C) "<p>Andrew Huberman:</p><p>text…</p>"           — label-only <p>, text in next <p>(s)
const SPEAKER_RE = /^([A-Z][A-Z0-9 .'&/-]{1,48}):\s+(.*)$/s; // format A (text on same line)
const LABEL_ONLY_RE = /^([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}):$/; // format C label

/** A leading <strong> like "Andrew Huberman" / "Dr. Gabrielle Lyon" (1–4 words). */
function isLikelySpeakerName(name: string): boolean {
  return name.length <= 40 && /^[A-Z][a-zA-Z.'-]+( [A-Z][a-zA-Z.'-]+){0,3}$/.test(name);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title-case an ALL-CAPS speaker label: "LAYNE NORTON" → "Layne Norton". */
function normalizeSpeaker(raw: string): string {
  return raw
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim();
}

function extractTranscript($: cheerio.CheerioAPI): { turns: TranscriptTurn[]; markerCount: number } {
  // Scope to the transcript container so format-C body paragraphs (plain <p>s)
  // can be attributed to the current speaker without sweeping in episode notes
  // or footer text, which live in other containers.
  const container = $('.rich-text-transcript');
  const paragraphs = container.length ? container.find('p') : $('p');

  const raw: TranscriptTurn[] = [];
  let currentSpeaker: string | null = null;

  paragraphs.each((_, p) => {
    const $p = $(p);
    const full = decodeEntities($p.text());
    if (!full) return;

    // Format C: a <p> that is ONLY a "Name:" label — sets the speaker for the
    // body <p>(s) that follow, emits nothing itself.
    const cLabel = LABEL_ONLY_RE.exec(full);
    if (cLabel) {
      currentSpeaker = normalizeSpeaker(cLabel[1]);
      return;
    }

    // Format B: leading <strong>Name</strong> then the spoken text.
    const strong = $p.children('strong').first();
    if (strong.length) {
      const name = decodeEntities(strong.text());
      if (isLikelySpeakerName(name) && full.startsWith(name)) {
        currentSpeaker = normalizeSpeaker(name);
        const text = full.slice(name.length).trim();
        if (text.length >= 2) raw.push({ speaker: currentSpeaker, text });
        return;
      }
    }

    // Format A: "SPEAKER: text" (all-caps name + colon, text on the same line).
    const a = SPEAKER_RE.exec(full);
    if (a) {
      currentSpeaker = normalizeSpeaker(a[1]);
      const text = a[2].trim();
      if (text.length >= 2) raw.push({ speaker: currentSpeaker, text });
      return;
    }

    // Format C body: plain paragraph following a label → current speaker.
    if (currentSpeaker && full.length >= 2) {
      raw.push({ speaker: currentSpeaker, text: full });
    }
  });

  // Keep only recurring speakers (≥2 turns) so stray bold headers / one-off
  // "Name:" lines don't get mistaken for transcript.
  const counts = new Map<string, number>();
  for (const t of raw) counts.set(t.speaker, (counts.get(t.speaker) || 0) + 1);
  return { turns: raw.filter((t) => (counts.get(t.speaker) || 0) >= 2), markerCount: raw.length };
}

function extractYoutubeId(html: string): string | null {
  // Prefer the first youtu.be/<id> (the main embed appears before any clips).
  const m = /youtu\.be\/([A-Za-z0-9_-]{6,})|youtube\.com\/(?:embed|watch\?v=)\/?([A-Za-z0-9_-]{6,})/.exec(
    html,
  );
  return m ? m[1] || m[2] || null : null;
}

function extractTitle($: cheerio.CheerioAPI): string {
  const og = $('meta[property="og:title"]').attr('content');
  const t = (og || $('title').first().text() || '').trim();
  return decodeEntities(t);
}

/**
 * Derive guest from the transcript: any speaker that isn't the host. Falls back
 * to null for solo episodes (Huberman only). More reliable than title parsing.
 */
function deriveGuest(turns: TranscriptTurn[]): string | null {
  const counts = new Map<string, number>();
  for (const t of turns) {
    if (t.speaker === HOST_NAME) continue;
    counts.set(t.speaker, (counts.get(t.speaker) || 0) + t.text.length);
  }
  if (counts.size === 0) return null;
  // The guest is the non-host speaker with the most spoken content.
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * "Essentials" episodes are abbreviated recaps and do NOT publish a full
 * speaker-labeled transcript on the page — only a description. They're skipped
 * (the underlying full conversation is its own episode). Used to tell an
 * expected empty transcript apart from a genuine page-shape regression.
 */
export function isEssentials(slug: string, title: string): boolean {
  return /^essentials-/.test(slug) || /\bessentials\b/i.test(title);
}

export function parseEpisode(html: string, slug: string, url: string): ParsedEpisode {
  const $ = cheerio.load(html);
  const title = extractTitle($);
  const chapters = extractChapters($);
  const { turns: transcript, markerCount } = extractTranscript($);

  // Fail loud ONLY when the page clearly HAS transcript markers (many speaker
  // labels) but we parsed none — that's a real format regression. An empty
  // transcript with few/no markers is legitimate (Essentials recaps and
  // premium/members-gated episodes publish no public transcript); those are
  // skipped by the ingest layer (transcript.length === 0).
  if (transcript.length === 0 && markerCount >= 10) {
    throw new Error(
      `parseEpisode(${slug}): ${markerCount} speaker markers found but 0 turns parsed — page shape may have changed`,
    );
  }

  const guestName = deriveGuest(transcript);
  const durationSeconds = chapters.length ? chapters[chapters.length - 1].startSeconds : 0;

  return {
    slug,
    url,
    title,
    youtubeId: extractYoutubeId(html),
    guestName,
    guestCredentials: null,
    chapters,
    transcript,
    durationSeconds,
  };
}

export async function fetchEpisode(ref: EpisodeRef): Promise<ParsedEpisode> {
  const html = await fetchHtml(ref.url);
  return parseEpisode(html, ref.slug, ref.url);
}

/** Exposed for ingestion (archiving raw HTML to GCS) and for tests. */
export async function fetchEpisodeRaw(ref: EpisodeRef): Promise<{ html: string; parsed: ParsedEpisode }> {
  const html = await fetchHtml(ref.url);
  return { html, parsed: parseEpisode(html, ref.slug, ref.url) };
}
