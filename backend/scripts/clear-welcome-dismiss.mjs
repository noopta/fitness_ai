// One-shot: clear stale welcomeDismissed flags. The new dismiss behavior
// auto-expires after 24h, but flags set before that change have no timestamp
// to compare against, so they'd stay dismissed forever.
//
// Usage: node scripts/clear-welcome-dismiss.mjs [username]
//   - No arg → clear for all users whose flag is set but has no timestamp.
//   - With username → clear that one user specifically.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const username = process.argv[2];

const where = username ? { username } : {};
const users = await prisma.user.findMany({
  where,
  select: { id: true, username: true, coachProfile: true },
});

let cleared = 0;
for (const u of users) {
  if (!u.coachProfile) continue;
  let profile;
  try { profile = JSON.parse(u.coachProfile); } catch { continue; }
  // Clear only flags from before we started stamping welcomeDismissedAt —
  // newer dismisses with a timestamp should keep their 24h TTL.
  if (profile.welcomeDismissed === true && !profile.welcomeDismissedAt) {
    delete profile.welcomeDismissed;
    await prisma.user.update({
      where: { id: u.id },
      data: { coachProfile: JSON.stringify(profile) },
    });
    cleared += 1;
    console.log(`Cleared welcomeDismissed for ${u.username ?? u.id}`);
  }
}

console.log(`Done. Cleared ${cleared} user(s).`);
await prisma.$disconnect();
