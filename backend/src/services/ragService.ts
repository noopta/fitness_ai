/**
 * RAG Service — retrieves relevant knowledge chunks from the KnowledgeChunk table
 * to augment LLM prompts with certified fitness science content.
 *
 * Strategy:
 *  1. Embed the query with text-embedding-3-small (same model used during ingestion)
 *  2. Load all embeddings from SQLite (cached in-memory after first load)
 *  3. Compute cosine similarity, return top-K chunks with source metadata
 */

import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const prisma = new PrismaClient();

const EMBED_MODEL = 'text-embedding-3-small';
const DEFAULT_TOP_K = 5;

interface StoredChunk {
  id: string;
  source: string;
  chapter: string | null;
  content: string;
  embedding: number[];
}

interface RetrievedChunk {
  source: string;
  chapter: string | null;
  content: string;
  score: number;
}

// ── In-memory cache ────────────────────────────────────────────────────────────

let cachedChunks: StoredChunk[] | null = null;
let cacheLoadedAt: number | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadChunks(): Promise<StoredChunk[]> {
  const now = Date.now();
  if (cachedChunks && cacheLoadedAt && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedChunks;
  }

  const rows = await prisma.knowledgeChunk.findMany({
    select: { id: true, source: true, chapter: true, content: true, embedding: true },
  });

  cachedChunks = rows.map(row => ({
    id: row.id,
    source: row.source,
    chapter: row.chapter,
    content: row.content,
    embedding: JSON.parse(row.embedding) as number[],
  }));
  cacheLoadedAt = now;

  return cachedChunks;
}

// ── Math ───────────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the top-K most relevant knowledge chunks for a given query string.
 * Returns an empty array if no chunks are stored (graceful degradation).
 */
export async function retrieveRelevantChunks(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  try {
    const chunks = await loadChunks();
    if (chunks.length === 0) return [];

    // Embed the query
    const resp = await openai.embeddings.create({ model: EMBED_MODEL, input: query });
    const queryVec = resp.data[0].embedding;

    // Score all chunks
    const scored = chunks.map(chunk => ({
      source: chunk.source,
      chapter: chunk.chapter,
      content: chunk.content,
      score: cosineSimilarity(queryVec, chunk.embedding),
    }));

    // Sort descending, take top-K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (err) {
    // RAG is additive — never break the main LLM call if retrieval fails
    console.error('[RAG] retrieval error (gracefully degraded):', err);
    return [];
  }
}

/**
 * Format retrieved chunks as a compact system-prompt block.
 * Keeps total size reasonable (≤ ~1500 tokens) by truncating long chunks.
 */
export function formatRAGContext(chunks: RetrievedChunk[], maxCharsPerChunk = 600): string {
  if (chunks.length === 0) return '';

  const lines: string[] = ['--- Certified Fitness Science Reference (NASM / ACE / NCSF / NFPT) ---'];
  for (const chunk of chunks) {
    const label = chunk.chapter
      ? `[${chunk.source} – ${chunk.chapter}]`
      : `[${chunk.source}]`;
    const text = chunk.content.length > maxCharsPerChunk
      ? chunk.content.slice(0, maxCharsPerChunk) + '…'
      : chunk.content;
    lines.push(`${label}\n${text}`);
  }
  lines.push('--- End Reference ---');
  return lines.join('\n\n');
}

/**
 * Convenience: retrieve + format in one call.
 * Returns an empty string if RAG is unavailable.
 */
export async function buildRAGContext(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<string> {
  const chunks = await retrieveRelevantChunks(query, topK);
  return formatRAGContext(chunks);
}

/** Invalidate the in-memory cache (useful after re-ingestion). */
export function invalidateRAGCache(): void {
  cachedChunks = null;
  cacheLoadedAt = null;
}
