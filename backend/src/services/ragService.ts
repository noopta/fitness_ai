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
  id: string;
  source: string;
  chapter: string | null;
  content: string;
  score: number;
}

/**
 * A real, attributable source that actually informed a generated program.
 * Surfaced to the client for the Program Reveal "Sources cited" block — the
 * count and the list must reflect the chunks genuinely retrieved (never faked).
 */
export interface ProgramSource {
  id: string;                // stable per-program id, e.g. "src-1"
  source: string;            // e.g. "NASM Essentials of Personal Fitness Training"
  chapter: string | null;    // e.g. "Chapter 14: Resistance Training Concepts"
  sections: ProgramSourceSection[]; // which construction sections this supports
  snippet?: string;          // short excerpt for an optional source sheet
}

export type ProgramSourceSection =
  | 'periodization'
  | 'exercise'
  | 'volume'
  | 'nutrition';

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
      id: chunk.id,
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

// ── Program-source surfacing (for Program Reveal) ───────────────────────────────

const SECTION_KEYWORDS: Record<ProgramSourceSection, string[]> = {
  periodization: ['periodiz', 'phase', 'mesocycle', 'macrocycle', 'microcycle', 'block', 'deload', 'progressive overload'],
  exercise: ['exercise selection', 'technique', 'movement pattern', 'biomechan', 'muscle activation', 'range of motion', 'accessory', 'compound'],
  volume: ['volume', 'sets per', 'set per', 'training frequency', 'intensity', 'rpe', '1rm', 'rep range', 'load', 'effort'],
  nutrition: ['protein', 'nutrition', 'diet', 'calorie', 'caloric', 'macronutrient', 'macro', 'carbohydrate', 'hydration', 'energy balance'],
};

/**
 * Classify which construction sections a retrieved chunk supports, by scanning
 * its chapter + content for section-specific keywords. A chunk may support
 * several sections (or none — in which case it still appears in the bibliography
 * but anchors no inline ref chip).
 */
export function classifyChunkSections(chunk: { chapter: string | null; content: string }): ProgramSourceSection[] {
  const haystack = `${chunk.chapter ?? ''} ${chunk.content}`.toLowerCase();
  const matched: ProgramSourceSection[] = [];
  for (const section of Object.keys(SECTION_KEYWORDS) as ProgramSourceSection[]) {
    if (SECTION_KEYWORDS[section].some(kw => haystack.includes(kw))) matched.push(section);
  }
  return matched;
}

/**
 * Turn retrieved chunks into a deduped, ordered list of ProgramSource entries.
 * Dedupe is by `source + chapter` so the same chapter retrieved twice counts once.
 * Order is preserved from retrieval (most relevant first), giving stable src-N ids.
 */
export function buildProgramSources(chunks: RetrievedChunk[], maxSnippet = 240): ProgramSource[] {
  const byKey = new Map<string, ProgramSource>();
  for (const chunk of chunks) {
    const key = `${chunk.source}||${chunk.chapter ?? ''}`;
    const sections = classifyChunkSections(chunk);
    const existing = byKey.get(key);
    if (existing) {
      // Merge sections from the duplicate chapter.
      for (const s of sections) if (!existing.sections.includes(s)) existing.sections.push(s);
      continue;
    }
    byKey.set(key, {
      id: `src-${byKey.size + 1}`,
      source: chunk.source,
      chapter: chunk.chapter,
      sections,
      snippet: chunk.content.length > maxSnippet
        ? chunk.content.slice(0, maxSnippet).trimEnd() + '…'
        : chunk.content,
    });
  }
  return Array.from(byKey.values());
}

/**
 * Retrieve + structure the real sources behind a generated program in one call.
 * Returns both the prompt context string (to augment the LLM call) and the
 * structured ProgramSource list (to surface on the Program Reveal screen).
 * Degrades to empty source list when RAG is unavailable.
 */
export async function retrieveProgramSources(
  query: string,
  topK: number = 8,
): Promise<{ ragContext: string; sources: ProgramSource[] }> {
  const chunks = await retrieveRelevantChunks(query, topK);
  return {
    ragContext: formatRAGContext(chunks),
    sources: buildProgramSources(chunks),
  };
}

/** Invalidate the in-memory cache (useful after re-ingestion). */
export function invalidateRAGCache(): void {
  cachedChunks = null;
  cacheLoadedAt = null;
}
