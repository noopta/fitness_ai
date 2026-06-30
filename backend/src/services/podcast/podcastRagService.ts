/**
 * Podcast RAG retrieval — the read side of the Huberman knowledge base.
 *
 * Mirrors ragService.ts: load all chunk embeddings into memory (cached), cosine
 * against the query embedding, return top-K. At a few thousand chunks the cosine
 * loop is sub-10ms; the latency budget (~100-200ms) is spent on the Vertex query
 * embedding call, exactly as designed.
 *
 * Unlike the textbook RAG, every result carries attribution (speaker, guest,
 * episode, chapter, YouTube deep-link) so the coach can cite WHO said it.
 */

import { PrismaClient } from '@prisma/client';
import { embedQuery } from './vertexEmbeddings.js';

const prisma = new PrismaClient();
const DEFAULT_TOP_K = 4;
const CACHE_TTL_MS = 60 * 60 * 1000;

interface StoredChunk {
  id: string;
  episodeTitle: string;
  episodeSlug: string;
  youtubeId: string | null;
  guestName: string | null;
  chapterTitle: string | null;
  startSeconds: number | null;
  speaker: string | null;
  content: string;
  embedding: number[];
}

export interface PodcastReference {
  speaker: string | null;
  guestName: string | null;
  episodeTitle: string;
  chapterTitle: string | null;
  youtubeUrl: string | null; // deep-linked to the chunk's approx timestamp
  startSeconds: number | null;
  score: number;
  content: string;
}

let cache: StoredChunk[] | null = null;
let cacheAt = 0;

async function load(): Promise<StoredChunk[]> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  const rows = await prisma.podcastChunk.findMany({
    select: {
      id: true, episodeTitle: true, episodeSlug: true, youtubeId: true,
      guestName: true, chapterTitle: true, startSeconds: true, speaker: true,
      content: true, embedding: true,
    },
  });
  cache = rows.map((r) => ({ ...r, embedding: JSON.parse(r.embedding) as number[] }));
  cacheAt = now;
  return cache;
}

export function invalidatePodcastCache(): void {
  cache = null;
  cacheAt = 0;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function youtubeUrl(id: string | null, startSeconds: number | null): string | null {
  if (!id) return null;
  return startSeconds ? `https://youtu.be/${id}?t=${startSeconds}` : `https://youtu.be/${id}`;
}

/** Retrieve top-K attributed podcast chunks for a query. Never throws. */
export async function retrievePodcastChunks(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<PodcastReference[]> {
  try {
    const chunks = await load();
    if (chunks.length === 0) return [];
    const qv = await embedQuery(query);
    return chunks
      .map((c) => ({
        speaker: c.speaker,
        guestName: c.guestName,
        episodeTitle: c.episodeTitle,
        chapterTitle: c.chapterTitle,
        youtubeUrl: youtubeUrl(c.youtubeId, c.startSeconds),
        startSeconds: c.startSeconds,
        score: cosine(qv, c.embedding),
        content: c.content,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } catch (err) {
    console.error('[podcast-rag] retrieval error (gracefully degraded):', err);
    return [];
  }
}

/**
 * Format retrieved chunks as a system-prompt block with explicit attribution so
 * the model cites the expert by name. Truncates long chunks to keep it compact.
 */
export function formatPodcastContext(refs: PodcastReference[], maxCharsPerChunk = 700): string {
  if (refs.length === 0) return '';
  const lines: string[] = [
    '--- Expert Podcast Reference (Huberman Lab — cite the speaker by name) ---',
  ];
  for (const r of refs) {
    const who = r.guestName ? `${r.guestName} / Huberman Lab` : 'Huberman Lab';
    const where = r.chapterTitle ? ` — "${r.chapterTitle}"` : '';
    const text = r.content.length > maxCharsPerChunk ? r.content.slice(0, maxCharsPerChunk) + '…' : r.content;
    lines.push(`[${who}${where}]\n${text}`);
  }
  lines.push('--- End Expert Podcast Reference ---');
  return lines.join('\n\n');
}

/** Convenience: retrieve + format + return references for citation surfacing. */
export async function buildPodcastContext(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<{ context: string; references: PodcastReference[] }> {
  const references = await retrievePodcastChunks(query, topK);
  return { context: formatPodcastContext(references), references };
}
