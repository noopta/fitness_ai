/**
 * Best-effort GCS archival of the podcast "data lake" — raw HTML, parsed JSON,
 * and chunk JSON per episode. This is the durable source of truth so the corpus
 * can be re-chunked / re-embedded later WITHOUT re-scraping.
 *
 * Deliberately non-fatal: the serving copy (chunks + vectors) lives in SQLite on
 * the box, so ingestion must succeed even if the archive bucket doesn't exist or
 * the WIF identity lacks bucket perms (same objectUser constraint as the
 * form-video pipeline — see geminiService.getBucket). Every failure is logged
 * and swallowed.
 *
 * Set GCP_KNOWLEDGE_BUCKET to enable. The bucket must be pre-created by an admin
 * (the runtime WIF identity is objectUser-only and cannot create buckets).
 */

import { Storage } from '@google-cloud/storage';

const PROJECT = process.env.GCP_PROJECT_ID ?? process.env.GCP_PROJECT;
const BUCKET = process.env.GCP_KNOWLEDGE_BUCKET; // e.g. axiom-knowledge-<project>

let _storage: Storage | null = null;
function bucket() {
  if (!BUCKET) return null;
  if (!_storage) _storage = new Storage({ projectId: PROJECT });
  return _storage.bucket(BUCKET);
}

export function archiveEnabled(): boolean {
  return !!BUCKET;
}

async function putObject(objectPath: string, body: string | Buffer, contentType: string): Promise<boolean> {
  const b = bucket();
  if (!b) return false;
  try {
    await b.file(objectPath).save(body, { contentType, resumable: false });
    return true;
  } catch (err: any) {
    console.warn(`[podcast-archive] skip ${objectPath}: ${err?.message ?? err}`);
    return false;
  }
}

/** Archive all three artifacts for one episode. Returns how many were written. */
export async function archiveEpisode(args: {
  slug: string;
  rawHtml?: string;
  parsedJson?: unknown;
  chunksJson?: unknown;
}): Promise<number> {
  if (!archiveEnabled()) return 0;
  const base = `huberman/${args.slug}`;
  let n = 0;
  if (args.rawHtml !== undefined && (await putObject(`raw/${base}/page.html`, args.rawHtml, 'text/html'))) n++;
  if (args.parsedJson !== undefined &&
    (await putObject(`parsed/${base}/episode.json`, JSON.stringify(args.parsedJson, null, 2), 'application/json'))) n++;
  if (args.chunksJson !== undefined &&
    (await putObject(`chunks/${base}/chunks.json`, JSON.stringify(args.chunksJson, null, 2), 'application/json'))) n++;
  return n;
}
