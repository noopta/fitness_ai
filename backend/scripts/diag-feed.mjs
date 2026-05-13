// Diagnose why /social/feed/articles keeps returning empty.
// Prints: total feed items, items per tag, user's goal tags, user's seen count,
// and the size of the unseen pool the articles endpoint would compute.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const username = process.argv[2] || 'pomelowarrior';
const user = await prisma.user.findFirst({
  where: { username },
  select: { id: true, username: true, savedProgram: true, coachProfile: true },
});
if (!user) { console.log(`no user: ${username}`); process.exit(1); }

// Mirror getUserGoalTags() inline
let savedProgramGoal = null, trainingStyle = null, primaryGoal = null;
try { savedProgramGoal = user.savedProgram ? JSON.parse(user.savedProgram).goal ?? null : null; } catch {}
try {
  const p = user.coachProfile ? JSON.parse(user.coachProfile) : {};
  trainingStyle = p.trainingStyle ?? p.trainingPreference ?? null;
  primaryGoal = p.primaryGoal ?? null;
} catch {}

const tags = new Set();
const text = `${savedProgramGoal ?? ''} ${trainingStyle ?? ''} ${primaryGoal ?? ''}`.toLowerCase();
if (/strength|strong|powerl/.test(text)) tags.add('strength');
if (/muscle|hypertro|size|mass|bulk/.test(text)) tags.add('hypertrophy');
if (/fat.?loss|weight.?loss|cut|lean|deficit|slim/.test(text)) tags.add('fat_loss');
if (/nutri|diet|protein|macro|food|eat/.test(text)) tags.add('nutrition');
if (/recov|sleep|rest|soreness/.test(text)) tags.add('recovery');
if (/cardio|endur|aerobic|run|hiit/.test(text)) tags.add('cardio');
if (/lifestyle|health|wellnes|general/.test(text)) tags.add('lifestyle');
if (trainingStyle === 'muscle') tags.add('hypertrophy');
if (trainingStyle === 'strength') tags.add('strength');
if (trainingStyle === 'cardio') tags.add('cardio');
if (tags.size === 0) tags.add('general');

const userTags = [...tags];

const [totalItems, items, views] = await Promise.all([
  prisma.feedItem.count(),
  prisma.feedItem.findMany({ orderBy: { fetchedAt: 'desc' }, take: 200, select: { id: true, title: true, tags: true } }),
  prisma.userFeedView.findMany({ where: { userId: user.id }, select: { feedItemId: true } }),
]);
const seenIds = new Set(views.map(v => v.feedItemId));

// Score like getFeedItemsForTags does.
const tagSet = new Set(userTags);
const scored = items.map(item => {
  let itemTags = [];
  try { itemTags = JSON.parse(item.tags); } catch {}
  const overlap = itemTags.filter(t => tagSet.has(t)).length;
  return { id: item.id, title: item.title, itemTags, overlap, seen: seenIds.has(item.id) };
});

const matchingPool = scored.filter(s => s.overlap > 0);
const unseenMatching = matchingPool.filter(s => !s.seen);
const seenMatching = matchingPool.filter(s => s.seen);

console.log(JSON.stringify({
  user: { id: user.id, username: user.username },
  derivedGoalTags: userTags,
  totals: {
    feedItemsInDB: totalItems,
    feedItemsScored: items.length,
    userViewsRecorded: views.length,
  },
  taggedForThisUser: {
    matchingAnyTag: matchingPool.length,
    unseen: unseenMatching.length,
    seen: seenMatching.length,
  },
  sampleUnseen: unseenMatching.slice(0, 5).map(s => ({ overlap: s.overlap, tags: s.itemTags, title: s.title.slice(0, 80) })),
  sampleSeen: seenMatching.slice(0, 5).map(s => ({ tags: s.itemTags, title: s.title.slice(0, 80) })),
}, null, 2));

await prisma.$disconnect();
