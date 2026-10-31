// The silent test for one account, against a COPY of the database: what the
// extractor would file under Working on, the dossier the reasoner reads, the
// candidates it returns and what the gate says, the screen follow-ups.
// Nothing is posted or pushed; the only writes land in the copy.
//
//   DATABASE_URL=file:./dryrun.db ./node_modules/.bin/tsx scripts/proactiveDryRun.ts anuptaislam33@gmail.com

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

process.env.PROACTIVE_V2_ENABLED = '1';
process.env.PROACTIVE_V2_DRY_RUN = '1';
process.env.AGENT_ENABLED = 'true';
process.env.UI_V2_ENABLED = '1';
// Loopback calls (agent ops → our own routes) must never reach the live server from a dry run.
process.env.PORT = '3999';
if (!process.env.DATABASE_URL?.includes('dryrun')) { console.error('Refusing: DATABASE_URL must point at a dryrun copy.'); process.exit(1); }

const email = process.argv[2];
if (!email) { console.error('usage: proactiveDryRun.ts <email>'); process.exit(1); }

async function main() {
  const prisma = new PrismaClient();
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, tier: true, timezone: true } });
  if (!u) throw new Error(`No user ${email}`);
  console.log(`\n== ${email} · ${u.tier} · ${u.timezone ?? 'no tz'} · ${u.id}\n`);

  const threads = await import('../src/proactive/threads.js');
  const ext = await threads.extractThreads(u.id, { minNew: 1 });
  console.log(`-- Working on: extraction created=${ext.created} updated=${ext.updated}`);
  for (const t of await threads.listThreads(u.id)) console.log(`   [${t.kind}/${t.status}] ${t.title}${t.checkBackAt ? ` · check back ${t.checkBackAt}` : ''}${t.eventDate ? ` · ${t.eventDate}` : ''}\n      “${t.sourceQuote}”`);

  const { buildDossier, renderDossier } = await import('../src/proactive/reasoner.js');
  const d = await buildDossier(u.id);
  if (d) { console.log('\n-- Dossier\n'); console.log(renderDossier(d)); }

  const { evaluateUser } = await import('../src/proactive/sweep.js');
  const r = await evaluateUser(u.id, { dryRun: true });
  console.log('\n-- Candidates → gate');
  if (!r?.gated.length) console.log('   (nothing worth raising today)');
  for (const g of r?.gated ?? []) console.log(`   ${g.allow ? 'WOULD SEND' : 'held: ' + g.reason} · ${g.candidate.kind} · ${g.candidate.topic}\n      "${g.candidate.question}" [${g.candidate.primary}]\n      evidence: ${g.candidate.evidence.join(', ')}${g.candidate.pushWhyNow ? ` · push: ${g.candidate.pushWhyNow}` : ''}`);
  console.log(`   outcome reports due: ${r?.outcomes ?? 0}`);

  const { loadScreens } = await import('../src/proactive/screens.js');
  const s = await loadScreens(u.id, {});
  console.log('\n-- Screens');
  console.log(`   Home event: ${s.event ? `${s.event.title} · ${s.event.daysOut} days out` : 'none'}`);
  console.log(`   Fuel insight: ${s.fuelInsight ? s.fuelInsight.headline : 'none (gate not met or no approved pair)'}`);
  console.log(`   Safety: ${s.safety ? s.safety.headline : 'none'}`);
  console.log(`   Sparse note: ${s.sparse ? s.sparse.text : 'no'}`);

  const events = await prisma.proactiveEvent.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
  console.log(`\n-- ProactiveEvent rows in the copy: ${events.length} (all channel=${[...new Set(events.map((e) => e.channel))].join(',') || '-'})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
