/**
 * Vertex AI embeddings (text-embedding-005, 768-dim) — used for both ingestion
 * and query. Runs on the project's Vertex endpoint (where the GCP credits live),
 * mirroring the auth in geminiService.ts. The AI-Studio API key path is NOT used.
 *
 * Same model + dim for documents and queries so they share one cosine space.
 * Documents use taskType RETRIEVAL_DOCUMENT, queries RETRIEVAL_QUERY — both
 * improve retrieval quality for this model.
 */

import { GoogleGenAI } from '@google/genai';

export const PODCAST_EMBED_MODEL = 'text-embedding-005';
export const PODCAST_EMBED_DIMS = 768;
const VERTEX_PROJECT = process.env.GCP_PROJECT_NUMBER ?? '656267185967';
// Embeddings are served from a region, not 'global'.
const VERTEX_LOCATION = process.env.GCP_EMBED_LOCATION ?? 'us-central1';
// text-embedding-005 caps the SUM of tokens across a request at ~20k. Batch by a
// token budget (with a safety margin), not a fixed count, or large chunks 400-error.
const MAX_TOKENS_PER_REQUEST = 16000;
const MAX_ITEMS_PER_REQUEST = 25;
const APPROX_CHARS_PER_TOKEN = 4;

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });
  }
  return _client;
}

async function embedBatch(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  const resp = await client().models.embedContent({
    model: PODCAST_EMBED_MODEL,
    contents: texts,
    config: { taskType },
  });
  const embs = resp.embeddings ?? [];
  if (embs.length !== texts.length) {
    throw new Error(`embedBatch: expected ${texts.length} embeddings, got ${embs.length}`);
  }
  return embs.map((e) => {
    const v = e.values;
    if (!v || v.length !== PODCAST_EMBED_DIMS) {
      throw new Error(`embedBatch: bad embedding length ${v?.length}`);
    }
    return v;
  });
}

/** Embed many documents, auto-batched by token budget. Order is preserved. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  let batch: string[] = [];
  let batchTokens = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    out.push(...(await embedBatch(batch, 'RETRIEVAL_DOCUMENT')));
    batch = [];
    batchTokens = 0;
  };

  for (const text of texts) {
    const tokens = Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
    if (
      batch.length > 0 &&
      (batchTokens + tokens > MAX_TOKENS_PER_REQUEST || batch.length >= MAX_ITEMS_PER_REQUEST)
    ) {
      await flush();
    }
    batch.push(text);
    batchTokens += tokens;
  }
  await flush();
  return out;
}

/** Embed a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedBatch([text], 'RETRIEVAL_QUERY');
  return v;
}
