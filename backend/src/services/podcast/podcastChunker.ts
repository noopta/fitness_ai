/**
 * Turns a ParsedEpisode into retrieval chunks.
 *
 * Design choices specific to spoken-word transcripts:
 *  - Chunk on *turn boundaries* (never mid-sentence) and keep the "Speaker:"
 *    prefix inline, so attribution survives into the embedded text.
 *  - One-turn overlap between adjacent chunks to preserve cross-boundary context.
 *  - Drop sponsor/ad-read chapters by title (they pollute retrieval).
 *  - The page has no per-line timestamps, so each chunk's chapter + startSeconds
 *    are *approximated* by linear interpolation of its character offset over the
 *    episode duration. Good enough for topic tagging + a video deep-link.
 *  - A deterministic `contextHeader` (guest + episode + chapter) is prepended
 *    before embedding — the Contextual-Retrieval idea, built from reliable
 *    metadata instead of an extra LLM call (cheaper, reproducible, no failures).
 */

import type { ParsedEpisode, Chapter, TranscriptTurn } from './hubermanScraper.js';

export interface PodcastChunkData {
  episodeSlug: string;
  episodeTitle: string;
  youtubeId: string | null;
  subtopic: string;
  guestName: string | null;
  guestCredentials: string | null;
  chapterTitle: string | null;
  startSeconds: number | null;
  speaker: string | null; // dominant speaker
  content: string; // speaker-tagged text
  contextHeader: string;
  tokenCount: number;
}

const DEFAULT_MAX_CHARS = 2200; // ~550 tokens
const MIN_CHUNK_CHARS = 250; // drop tail fragments
const APPROX_CHARS_PER_TOKEN = 4;

// Known Huberman Lab sponsors — chapters that are just these are ad reads.
const SPONSOR_BRANDS = new Set(
  [
    'lmnt', 'roka', 'insidetracker', 'momentous', 'ag1', 'athletic greens',
    'eight sleep', 'helix', 'helix sleep', 'waking up', 'levels', 'mateina',
    'betterhelp', 'joovv', 'thesis', 'function', 'david', 'our place', 'maui nui',
    'wealthfront', 'plunge', 'lifeforce', 'juve', 'whoop', 'element', 'ро ka',
  ].map((s) => s.toLowerCase()),
);

export function isSponsorChapter(title: string): boolean {
  const t = title.toLowerCase().trim();
  if (/^sponsor|sponsors?:|^ad\b/.test(t)) return true;
  // Split on commas/&/slashes → if most tokens are known brands, it's an ad read.
  const parts = t.split(/[,/&]| and /).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const brandHits = parts.filter((p) => SPONSOR_BRANDS.has(p)).length;
  return brandHits >= 1 && brandHits >= Math.ceil(parts.length / 2);
}

/** chapter covering an absolute second mark (chapters must be time-sorted). */
function chapterAt(chapters: Chapter[], seconds: number): Chapter | null {
  if (chapters.length === 0) return null;
  let found: Chapter | null = null;
  for (const c of chapters) {
    if (c.startSeconds <= seconds) found = c;
    else break;
  }
  return found ?? chapters[0];
}

function buildContextHeader(
  ep: ParsedEpisode,
  subtopic: string,
  chapterTitle: string | null,
): string {
  const who = ep.guestName ? `${ep.guestName} on the Huberman Lab podcast` : 'the Huberman Lab podcast';
  const topic = chapterTitle ? `, discussing ${chapterTitle}` : '';
  return `From ${who} (${subtopic})${topic}:`;
}

function dominantSpeaker(turns: TranscriptTurn[]): string | null {
  const counts = new Map<string, number>();
  for (const t of turns) counts.set(t.speaker, (counts.get(t.speaker) || 0) + t.text.length);
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export interface ChunkOptions {
  subtopic: string;
  maxChars?: number;
}

export function chunkEpisode(ep: ParsedEpisode, opts: ChunkOptions): PodcastChunkData[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const turns = ep.transcript;
  const totalChars = turns.reduce((s, t) => s + t.speaker.length + 2 + t.text.length + 1, 0);
  const duration = ep.durationSeconds || 0;

  // Cumulative char offset at the start of each turn, for time interpolation.
  const turnOffsets: number[] = [];
  let acc = 0;
  for (const t of turns) {
    turnOffsets.push(acc);
    acc += t.speaker.length + 2 + t.text.length + 1;
  }

  const renderTurn = (t: TranscriptTurn) => `${t.speaker}: ${t.text}`;

  // Group turns into windows on turn boundaries with one-turn overlap.
  const windows: { turns: TranscriptTurn[]; startIdx: number }[] = [];
  let cur: TranscriptTurn[] = [];
  let curChars = 0;
  let startIdx = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const tChars = renderTurn(t).length + 1;
    if (curChars > 0 && curChars + tChars > maxChars) {
      windows.push({ turns: cur, startIdx });
      // overlap: start next window with the previous turn for continuity
      cur = [turns[i - 1]];
      curChars = renderTurn(turns[i - 1]).length + 1;
      startIdx = i - 1;
    }
    cur.push(t);
    curChars += tChars;
  }
  if (cur.length) windows.push({ turns: cur, startIdx });

  const chunks: PodcastChunkData[] = [];
  for (const w of windows) {
    const content = w.turns.map(renderTurn).join('\n');
    if (content.length < MIN_CHUNK_CHARS) continue;

    // Approximate absolute time from the char midpoint of this window.
    const midChar = turnOffsets[w.startIdx] + content.length / 2;
    const approxSeconds = totalChars > 0 && duration > 0
      ? Math.round((midChar / totalChars) * duration)
      : 0;
    const chapter = chapterAt(ep.chapters, approxSeconds);
    const chapterTitle = chapter?.title ?? null;

    // Skip ad reads.
    if (chapterTitle && isSponsorChapter(chapterTitle)) continue;

    const speaker = dominantSpeaker(w.turns);
    const contextHeader = buildContextHeader(ep, opts.subtopic, chapterTitle);

    chunks.push({
      episodeSlug: ep.slug,
      episodeTitle: ep.title,
      youtubeId: ep.youtubeId,
      subtopic: opts.subtopic,
      guestName: ep.guestName,
      guestCredentials: ep.guestCredentials,
      chapterTitle,
      startSeconds: approxSeconds || null,
      speaker,
      content,
      contextHeader,
      tokenCount: Math.round(content.length / APPROX_CHARS_PER_TOKEN),
    });
  }

  return chunks;
}
