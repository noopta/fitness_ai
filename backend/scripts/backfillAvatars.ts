/**
 * Re-compress legacy avatars that were stored before the upload path started
 * downscaling them.
 *
 * PUT /auth/avatar has run every upload through resizeAvatarBase64 (96px JPEG
 * q70, ~4 KB) for a while, but rows written before that still hold full camera
 * resolution. Measured 2026-08-04: pomelowarrior's avatar was 828x828 / 84 KB.
 * You can spot the legacy ones by the `data:image/...;base64,` prefix, which
 * resizeAvatarBase64 strips.
 *
 * This matters out of proportion to its size because avatars are the most
 * duplicated bytes in the system: one appears in /auth/me on every app launch
 * and again in the feed's authors map on every feed load.
 *
 *   npm run backfill:avatars -- --dry-run
 *   npm run backfill:avatars
 *
 * Idempotent: already-small avatars are re-encoded to the same ~4 KB and the
 * row is only written when the result is actually smaller, so re-running is
 * effectively a no-op. Rows that fail to decode are left untouched.
 */

// Load .env from the working directory. Run this from the deploy dir
// (/home/ubuntu/fitness_ai_repo/backend) so DATABASE_URL's relative
// `file:./dev.db` and the GCP credentials both resolve to production.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resizeAvatarBase64 } from '../src/services/avatarImage.js';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const users = await prisma.user.findMany({
    where: { avatarBase64: { not: null } },
    select: { id: true, username: true, avatarBase64: true },
  });

  console.log(`Scanning ${users.length} avatar(s)${DRY_RUN ? ' (DRY RUN)' : ''}…\n`);

  let shrunk = 0, unchanged = 0, failed = 0, before = 0, after = 0;

  for (const u of users) {
    const original = u.avatarBase64 ?? '';
    if (!original) { unchanged++; continue; }

    let resized: string;
    try {
      resized = await resizeAvatarBase64(original);
    } catch (err: any) {
      console.warn(`  ${u.username ?? u.id}: decode failed, left as-is (${err?.message ?? err})`);
      failed++;
      continue;
    }

    // Only write when it's genuinely an improvement — keeps the script
    // idempotent and avoids rewriting rows that are already optimal.
    if (resized.length >= original.length) {
      unchanged++;
      before += original.length;
      after += original.length;
      continue;
    }

    before += original.length;
    after += resized.length;
    shrunk++;

    console.log(
      `  ${(u.username ?? u.id).padEnd(20)} ${(original.length / 1024).toFixed(0).padStart(4)} KB -> ` +
      `${(resized.length / 1024).toFixed(0).padStart(3)} KB  (-${Math.round(100 * (1 - resized.length / original.length))}%)`,
    );

    if (!DRY_RUN) {
      await prisma.user.update({ where: { id: u.id }, data: { avatarBase64: resized } });
    }
  }

  console.log(`\n${DRY_RUN ? 'Would shrink' : 'Shrunk'}: ${shrunk}  |  already optimal: ${unchanged}  |  failed: ${failed}`);
  console.log(`Total avatar bytes: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
