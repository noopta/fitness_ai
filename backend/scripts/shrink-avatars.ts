/**
 * One-off migration: shrink existing oversized avatars.
 *
 * Profile photos were stored straight from the camera (observed: 1110x1110,
 * ~68KB base64) and embedded per user in every social-feed response. New
 * uploads are now downscaled in PUT /auth/avatar; this back-fills the rows that
 * predate that change.
 *
 * Safe to re-run: rows already <= SKIP_THRESHOLD chars are left untouched.
 *
 * Run with:  npx tsx scripts/shrink-avatars.ts
 */
import { PrismaClient } from '@prisma/client';
import { resizeAvatarBase64 } from '../src/services/avatarImage.js';

const prisma = new PrismaClient();

// Resized avatars land around ~3KB base64; anything already under this is
// assumed migrated and skipped so re-runs don't re-compress.
const SKIP_THRESHOLD = 8000;

async function main() {
  const users = await prisma.user.findMany({
    where: { avatarBase64: { not: null } },
    select: { id: true, avatarBase64: true },
  });
  console.log(`Found ${users.length} avatar(s).`);

  let shrunk = 0, skipped = 0, failed = 0;
  for (const u of users) {
    const before = u.avatarBase64!.length;
    if (before <= SKIP_THRESHOLD) { skipped++; continue; }
    try {
      const resized = await resizeAvatarBase64(u.avatarBase64!);
      await prisma.user.update({ where: { id: u.id }, data: { avatarBase64: resized } });
      const pct = Math.round((1 - resized.length / before) * 100);
      console.log(`  ${u.id}: ${before} -> ${resized.length} chars (${pct}% smaller)`);
      shrunk++;
    } catch (e) {
      console.error(`  ${u.id}: resize failed, left as-is:`, e);
      failed++;
    }
  }
  console.log(`Done. shrunk=${shrunk} skipped=${skipped} failed=${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
