/**
 * Ingestion orchestrator: a subtopic URL → stored, queryable PodcastChunk rows.
 *
 *   subtopic page → episode refs → (per episode) fetch → parse → chunk →
 *   embed (Vertex) → upsert into SQLite → best-effort GCS archive
 *
 * Idempotent per episode: existing chunks for an episodeSlug are deleted before
 * re-insert, so re-running is safe and picks up edits/new episodes cleanly.
 */

import { PrismaClient } from '@prisma/client';
import {
  fetchSubtopicEpisodes,
  fetchEpisodeRaw,
  isEssentials,
  type EpisodeRef,
  type ParsedEpisode,
} from './hubermanScraper.js';
import { chunkEpisode, type PodcastChunkData } from './podcastChunker.js';
import { embedDocuments, PODCAST_EMBED_MODEL } from './vertexEmbeddings.js';
import { archiveEpisode, archiveEnabled } from './gcsArchive.js';

const prisma = new PrismaClient();

export interface IngestEpisodeResult {
  slug: string;
  title: string;
  guest: string | null;
  chunksStored: number;
  archived: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface IngestOptions {
  subtopic: string; // human label stored on every chunk (the topic)
  limit?: number; // cap episodes (spike = 1)
  onProgress?: (msg: string) => void;
}

async function storeEpisodeChunks(
  parsed: ParsedEpisode,
  chunks: PodcastChunkData[],
): Promise<number> {
  if (chunks.length === 0) return 0;

  // Embed the contextHeader + content together (contextual retrieval).
  const inputs = chunks.map((c) => `${c.contextHeader}\n${c.content}`);
  const vectors = await embedDocuments(inputs);

  // Idempotent replace for this episode.
  await prisma.$transaction([
    prisma.podcastChunk.deleteMany({ where: { episodeSlug: parsed.slug } }),
    prisma.podcastChunk.createMany({
      data: chunks.map((c, i) => ({
        source: 'HubermanLab',
        subtopic: c.subtopic,
        episodeSlug: c.episodeSlug,
        episodeTitle: c.episodeTitle,
        youtubeId: c.youtubeId,
        guestName: c.guestName,
        guestCredentials: c.guestCredentials,
        chapterTitle: c.chapterTitle,
        startSeconds: c.startSeconds,
        speaker: c.speaker,
        content: c.content,
        contextHeader: c.contextHeader,
        embedding: JSON.stringify(vectors[i]),
        embeddingModel: PODCAST_EMBED_MODEL,
        tokenCount: c.tokenCount,
      })),
    }),
  ]);
  return chunks.length;
}

export async function ingestEpisode(ref: EpisodeRef, subtopic: string): Promise<IngestEpisodeResult> {
  const { html, parsed } = await fetchEpisodeRaw(ref);

  // Episodes without a usable transcript are skipped (not errors). Classify why
  // so the run report is honest about what's gated vs unavailable.
  if (parsed.transcript.length === 0) {
    const reason = /Become a Huberman Lab Premium member/i.test(html)
      ? 'Premium members-only transcript'
      : isEssentials(parsed.slug, parsed.title)
        ? 'Essentials recap (no full transcript published)'
        : 'no public transcript on page';
    return {
      slug: parsed.slug,
      title: parsed.title,
      guest: parsed.guestName,
      chunksStored: 0,
      archived: 0,
      skipped: true,
      skipReason: reason,
    };
  }

  const chunks = chunkEpisode(parsed, { subtopic });
  const chunksStored = await storeEpisodeChunks(parsed, chunks);

  let archived = 0;
  if (archiveEnabled()) {
    archived = await archiveEpisode({
      slug: parsed.slug,
      rawHtml: html,
      parsedJson: { ...parsed, transcript: `${parsed.transcript.length} turns (omitted)` },
      chunksJson: chunks,
    });
  }

  return {
    slug: parsed.slug,
    title: parsed.title,
    guest: parsed.guestName,
    chunksStored,
    archived,
  };
}

export async function ingestSubtopic(url: string, opts: IngestOptions): Promise<IngestEpisodeResult[]> {
  const log = opts.onProgress ?? (() => {});
  const refs = await fetchSubtopicEpisodes(url);
  const targets = opts.limit ? refs.slice(0, opts.limit) : refs;
  log(`Found ${refs.length} episodes; ingesting ${targets.length}.`);

  const results: IngestEpisodeResult[] = [];
  for (const [i, ref] of targets.entries()) {
    try {
      const r = await ingestEpisode(ref, opts.subtopic);
      if (r.skipped) {
        log(`[${i + 1}/${targets.length}] ${r.slug} → SKIPPED (${r.skipReason})`);
      } else {
        log(`[${i + 1}/${targets.length}] ${r.slug} → ${r.chunksStored} chunks${r.guest ? ` (guest: ${r.guest})` : ''}${r.archived ? `, archived ${r.archived}` : ''}`);
      }
      results.push(r);
    } catch (err: any) {
      // One bad episode must not abort the whole run.
      log(`[${i + 1}/${targets.length}] ${ref.slug} FAILED: ${err?.message ?? err}`);
    }
  }
  return results;
}

export { prisma as _ingestPrisma };
