/**
 * Ingest Huberman Lab podcast transcripts into the PodcastChunk knowledge base.
 *
 * Usage:
 *   npx tsx scripts/ingestHubermanPodcasts.ts                 # default subtopic, all episodes
 *   npx tsx scripts/ingestHubermanPodcasts.ts --limit 1       # spike: first episode only
 *   npx tsx scripts/ingestHubermanPodcasts.ts --url <subtopic-url> --subtopic "Label"
 *
 * Idempotent per episode (re-running replaces that episode's chunks).
 */

import 'dotenv/config';
import { ingestSubtopic } from '../src/services/podcast/podcastIngestService.js';
import { archiveEnabled } from '../src/services/podcast/gcsArchive.js';

const DEFAULT_URL =
  'https://www.hubermanlab.com/subtopics/nutrition-for-physical-health-and-athletic-performance';
const DEFAULT_SUBTOPIC = 'Nutrition for Physical Health & Athletic Performance';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg('url') ?? DEFAULT_URL;
  const subtopic = arg('subtopic') ?? DEFAULT_SUBTOPIC;
  const limitStr = arg('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  console.log(`\n📥 Ingesting Huberman Lab subtopic: "${subtopic}"`);
  console.log(`   URL: ${url}`);
  console.log(`   GCS archive: ${archiveEnabled() ? 'enabled' : 'disabled (set GCP_KNOWLEDGE_BUCKET)'}\n`);

  const t0 = Date.now();
  const results = await ingestSubtopic(url, {
    subtopic,
    limit,
    onProgress: (m) => console.log('  ' + m),
  });

  const totalChunks = results.reduce((s, r) => s + r.chunksStored, 0);
  const stored = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\n✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`   Episodes with transcripts ingested: ${stored.length}`);
  console.log(`   Episodes skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`     - ${s.slug}: ${s.skipReason}`);
  console.log(`   Total chunks stored: ${totalChunks}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Ingestion failed:', e);
  process.exit(1);
});
