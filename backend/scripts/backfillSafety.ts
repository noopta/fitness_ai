// One-off (Oct 2026): users who hit a red flag at sign-up before safety records
// existed get coachProfile.safety, so Anakin asks the follow-up questions and
// keeps the plan within the rules. Their past choice is recorded as what it
// was — the screen they saw had no acknowledgement text, so none is claimed.
// Usage: npx tsx scripts/backfillSafety.ts [--apply]
import { PrismaClient } from '@prisma/client';
import { flaggedAnswers, type Safety } from '../src/services/safetyScreen.js';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const users = await prisma.user.findMany({ where: { coachProfile: { contains: 'redFlagRoute' } }, select: { id: true, email: true, createdAt: true, coachProfile: true } });
let n = 0;
for (const u of users) {
  let cp: any; try { cp = JSON.parse(u.coachProfile ?? '{}'); } catch { continue; }
  const answers = cp.answers ?? {};
  const route = answers.redFlagRoute ?? cp.redFlagRoute;
  const flags = flaggedAnswers({ ...answers, redFlagRoute: route });
  if (!route || !flags.length || cp.safety) continue;
  const since = u.createdAt.toISOString();
  const safety: Safety = { flags, status: route === 'cleared' ? 'cleared' : route === 'clinician' ? 'clinician' : 'gentle', since, ...(route === 'cleared' ? { clearedAt: since, clearedBy: 'self-reported at sign-up' } : {}) };
  const ack = { kind: `red_flag_${route}`, text: `Chose "${route === 'gentle' ? 'Start a gentle plan meanwhile' : route === 'cleared' ? "It's been checked — I'm cleared" : 'Find a physio near me'}" on the sign-up red-flag screen (before acknowledgement text was shown; recorded by backfill).`, at: since, termsVersion: 'pre-2026-10-20', detail: flags.join('; ') };
  console.log(`${apply ? 'SET' : 'WOULD SET'} ${u.email}: ${safety.status} — ${flags.join('; ')}`);
  if (apply) await prisma.user.update({ where: { id: u.id }, data: { coachProfile: JSON.stringify({ ...cp, safety, safetyAcks: [...(Array.isArray(cp.safetyAcks) ? cp.safetyAcks : []), ack] }) } });
  n++;
}
console.log(`\n${n} of ${users.length} users ${apply ? 'updated' : 'would be updated'}.`);
await prisma.$disconnect();
