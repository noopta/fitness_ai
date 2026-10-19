// Load an Apple Health export.xml into a user's watch data.
//   npx tsx scripts/wearables-import-apple.ts <user email or id> <export.xml> [since YYYY-MM-DD] [--as-simulator]
// --as-simulator stores it under provider 'simulator' (easy to wipe) instead of 'apple_health'.
import { PrismaClient } from '@prisma/client';
import { readAppleExport } from '../src/services/wearables/appleExport.js';
import { ingest } from '../src/services/wearables/ingest.js';

const [who, path, maybeSince] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asSim = process.argv.includes('--as-simulator');
if (!who || !path) { console.error('usage: wearables-import-apple.ts <user email|id> <export.xml> [since] [--as-simulator]'); process.exit(1); }
const prisma = new PrismaClient();
const user = await prisma.user.findFirst({ where: { OR: [{ id: who }, { email: who }] }, select: { id: true } });
if (!user) { console.error('no such user'); process.exit(1); }
const data = await readAppleExport(path, maybeSince);
const r = await ingest(user.id, asSim ? 'simulator' : 'apple_health', data);
console.log(JSON.stringify({ ...r, from: data.days[0]?.date, to: data.days.at(-1)?.date }));
await prisma.$disconnect();
