/**
 * Move existing SharedItem images out of the JSON payload and into
 * content-addressed object storage.
 *
 * As of 2026-08-03 SharedItem held 64 rows / 6.0 MB of payload, largest 864 KB,
 * because post photos were base64'd inside the payload column. New posts go
 * straight to the blob store (see routes/social.ts); this migrates the backlog.
 *
 * Safe to re-run. Rows already carrying `imageKey` are skipped, and because
 * keys are sha256 of the bytes, re-uploading identical content is a no-op that
 * resolves to the same object.
 *
 *   npm run backfill:post-images -- --dry-run   # report only, no writes
 *   npm run backfill:post-images                # migrate
 *
 * Requires GCP_MEDIA_BUCKET. Without it the blob store is disabled, every
 * upload returns null, and the script exits having changed nothing.
 */

import { PrismaClient } from '@prisma/client';
import { putImageBase64, blobStoreEnabled } from '../src/services/blobStore.js';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function parsePayload(raw: unknown): Record<string, any> | null {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (raw && typeof raw === 'object') return raw as Record<string, any>;
  } catch {
    /* fall through — a row with unparseable JSON is left alone */
  }
  return null;
}

async function main() {
  if (!blobStoreEnabled()) {
    console.error('GCP_MEDIA_BUCKET is not set — blob store disabled. Nothing to do.');
    process.exit(1);
  }

  const rows = await prisma.sharedItem.findMany({ select: { id: true, payload: true } });
  console.log(`Scanning ${rows.length} SharedItem rows${DRY_RUN ? ' (DRY RUN)' : ''}…\n`);

  let migrated = 0, deduped = 0, skipped = 0, failed = 0, bytesFreed = 0;

  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!payload) { skipped++; continue; }

    // Both the post's own image and a forwarded post's nested original.
    const targets: Array<Record<string, any>> = [payload];
    if (payload.originalPayload && typeof payload.originalPayload === 'object') {
      targets.push(payload.originalPayload);
    }

    let changed = false;
    for (const t of targets) {
      if (t.imageKey || !t.imageBase64) continue;

      const before = t.imageBase64.length;
      const stored = await putImageBase64(t.imageBase64);
      if (!stored) { failed++; continue; }

      if (!DRY_RUN) {
        delete t.imageBase64;
        t.imageKey = stored.key;
      }
      changed = true;
      bytesFreed += before;
      if (stored.deduped) deduped++;
      console.log(`  ${row.id}: ${(before / 1024).toFixed(0)} KB -> ${stored.key}${stored.deduped ? ' (deduped)' : ''}`);
    }

    if (changed && !DRY_RUN) {
      await prisma.sharedItem.update({
        where: { id: row.id },
        data: { payload: JSON.stringify(payload) },
      });
      migrated++;
    } else if (changed) {
      migrated++;
    }
  }

  console.log(`\n${DRY_RUN ? 'Would migrate' : 'Migrated'}: ${migrated} row(s)`);
  console.log(`Deduped to existing objects: ${deduped}`);
  console.log(`Rows skipped (no image / unparseable): ${skipped}`);
  console.log(`Upload failures (left inline): ${failed}`);
  console.log(`Payload bytes ${DRY_RUN ? 'that would be' : ''} removed from the DB: ${(bytesFreed / 1048576).toFixed(2)} MB`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
