// The research test set (Nov 2026): real questions users asked, with what the
// library should do for each. Run after changing floors, the feed filter or the
// web source rules:
//
//   npx tsx scripts/researchProbe.ts            # library only (cheap)
//   npx tsx scripts/researchProbe.ts --web      # + one web search per question
//
// Reads the library and the feed (DATABASE_URL); writes nothing.

import '../src/agent/toolkits/health.js';
import { HEALTH_TOOLS } from '../src/agent/toolkits/health.js';
import { searchWeb } from '../src/services/webSearch.js';
import { isTrialRegistration } from '../src/services/research/relevance.js';

/** library: the library should answer it. empty: it has nothing on this, and must say so instead of showing loose matches. */
const QUESTIONS: { q: string; library: 'answers' | 'empty' }[] = [
  { q: 'achilles tendon rupture rehab protocol early weight bearing', library: 'empty' },
  { q: 'return to running after achilles repair criteria', library: 'empty' },
  { q: 'vitamin C and zinc for tendon healing', library: 'empty' },
  { q: 'collagen before rehab sessions for tendons', library: 'empty' },
  { q: 'protein intake for muscle growth per kg', library: 'answers' },
  { q: 'how many sets per muscle group per week for hypertrophy', library: 'answers' },
  { q: 'creatine dosing and loading phase', library: 'answers' },
  { q: 'caffeine timing before training', library: 'answers' },
  { q: 'sleep and muscle recovery', library: 'answers' },
  { q: 'progressive overload for beginners', library: 'answers' },
];

const tool: any = HEALTH_TOOLS.find((t: any) => t.name === 'query_research');
const web = process.argv.includes('--web');
let fails = 0;
for (const { q, library } of QUESTIONS) {
  const r = await tool.execute({ query: q }, 'probe');
  const trials = (r.results ?? []).filter((x: any) => isTrialRegistration(x.source)).length;
  const ok = (library === 'empty' ? r.count === 0 && !!r.note : r.count > 0) && trials === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  library ${library.padEnd(7)} got ${r.count}  "${q}"`);
  for (const x of (r.results ?? []).slice(0, 4)) console.log(`        · ${x.title}`);
  if (web) {
    const w = await searchWeb(q);
    console.log(`        web ${w.kind} · ${w.sources.length} sources · ${w.claims?.length ?? 0} claims · ${w.ms} ms`);
    for (const s of w.sources) console.log(`        ↳ ${s.title} (${s.site ?? 'no site'})`);
  }
}
console.log(`\n${QUESTIONS.length - fails}/${QUESTIONS.length} as expected`);
process.exit(fails ? 1 : 0);
