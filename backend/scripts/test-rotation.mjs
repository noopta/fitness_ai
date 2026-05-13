// Simulate two consecutive Research-button taps and verify the rotation
// returns different items each time.
import { PrismaClient } from '@prisma/client';
import { getCachedFeedItems, recordFeedViews, invalidateResearchCache } from '../dist/services/feedService.js';

const prisma = new PrismaClient();
const u = await prisma.user.findFirst({ where: { username: 'pomelowarrior' }, select: { id: true } });
if (!u) { console.log('no user'); process.exit(1); }

const tags = ['strength', 'hypertrophy'];

invalidateResearchCache(u.id);
const a = await getCachedFeedItems(u.id, tags, 10, { forceRefresh: true, excludeSeen: true });
const aIds = a.items.map(i => i.id);
console.log('Tap 1:', a.items.length, 'items, exhausted=', a.exhausted);
console.log('  titles:', a.items.slice(0, 3).map(i => i.title.slice(0, 60)));
await recordFeedViews(u.id, aIds);

invalidateResearchCache(u.id);
const b = await getCachedFeedItems(u.id, tags, 10, { forceRefresh: true, excludeSeen: true });
const bIds = b.items.map(i => i.id);
console.log('Tap 2:', b.items.length, 'items, exhausted=', b.exhausted);
console.log('  titles:', b.items.slice(0, 3).map(i => i.title.slice(0, 60)));
const overlap = aIds.filter(id => bIds.includes(id)).length;
console.log(`Overlap between tap1 and tap2: ${overlap} / ${aIds.length}`);

await prisma.$disconnect();
