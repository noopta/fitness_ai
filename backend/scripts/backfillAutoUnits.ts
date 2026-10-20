/**
 * Units from location for existing users (Oct 2026). New users get location
 * detection at signup; for EXISTING users a Settings choice left no record, so
 * a user is switched only when location AND their own chat agree: the phone's
 * timezone says lb (or kg) and they've written their weights in that unit.
 * Users who changed units through Anakin are marked manual. Everyone else
 * keeps their setting, and Anakin asks the first time they write in the other unit.
 *
 *   npx tsx scripts/backfillAutoUnits.ts          # dry run
 *   npx tsx scripts/backfillAutoUnits.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { autoUnitChange } from '../src/services/autoUnits';
import { unitWrittenIn } from '../src/services/weightUnits';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const chose = new Set((await prisma.agentChange.findMany({ where: { op: 'pref.set_many', argsJson: { contains: 'unitPreference' } }, select: { userId: true } })).map((c) => c.userId));
  const users = await prisma.user.findMany({ select: { id: true, email: true, unitPreference: true, timezone: true, prefsJson: true } });
  let switched = 0, marked = 0;
  for (const u of users) {
    if (chose.has(u.id)) {
      const prefs = (() => { try { return u.prefsJson ? JSON.parse(u.prefsJson) : {}; } catch { return {}; } })();
      if (!prefs.unitsManual) { marked++; console.log(`MANUAL ${u.email ?? u.id} keeps ${u.unitPreference}`); if (apply) await prisma.user.update({ where: { id: u.id }, data: { prefsJson: JSON.stringify({ ...prefs, unitsManual: true }) } }); }
      continue;
    }
    const next = autoUnitChange(u);
    if (!next) continue;
    // Their own words: how many of their chat messages give weights in each unit.
    const conv = await prisma.agentConversation.findUnique({ where: { userId: u.id }, select: { messagesJson: true } });
    const msgs: any[] = (() => { try { return JSON.parse(conv?.messagesJson ?? '[]'); } catch { return []; } })();
    const wrote = msgs.filter((m) => m?.role === 'user').map((m) => unitWrittenIn(String(m.text ?? ''))).filter(Boolean);
    const agree = wrote.filter((w) => w === next).length, against = wrote.length - agree;
    if (!(agree > 0 && agree > against)) { console.log(`KEEP ${u.email ?? u.id} on ${u.unitPreference} (location says ${next}; chat: ${agree} for, ${against} against)`); continue; }
    switched++;
    console.log(`${apply ? 'SWITCH' : 'WOULD SWITCH'} ${u.email ?? u.id} ${u.unitPreference} → ${next} (${u.timezone})`);
    if (apply) await prisma.user.update({ where: { id: u.id }, data: { unitPreference: next } });
  }
  console.log(`\n${switched} ${apply ? 'switched' : 'would switch'}, ${marked} marked manual, of ${users.length} users.`);
}
main().finally(() => prisma.$disconnect());
