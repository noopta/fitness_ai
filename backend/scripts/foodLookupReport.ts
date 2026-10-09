/**
 * Food lookup report: which check answered typed branded items, how long it
 * took, what it cost — and whether looked-up meals get corrected less often
 * than estimated ones (the real test of whether lookups help).
 *
 * Usage (from backend/, prod data): npx tsx scripts/foodLookupReport.ts [--days 14]
 *
 * Reads .runtime/food-lookups.jsonl (resolver decisions),
 * .runtime/meal-edits.jsonl (calorie/macro corrections) and MealEntry.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 14;
const since = Date.now() - days * 86_400_000;
const readJsonl = (f: string): any[] => {
  try { return readFileSync(join(process.cwd(), '.runtime', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

async function main() {
  const decisions = readJsonl('food-lookups.jsonl').filter((d) => Date.parse(d.at) >= since);
  const edits = readJsonl('meal-edits.jsonl').filter((e) => Date.parse(e.at) >= since);

  console.log(`\nFood lookups — last ${days} days`);
  console.log(`Items resolved: ${decisions.length}  ·  web searches: ${decisions.reduce((n, d) => n + (d.webCalls || 0), 0)}`);
  const bySteps = new Map<string, number[]>();
  for (const d of decisions) bySteps.set(d.step, [...(bySteps.get(d.step) ?? []), d.ms]);
  for (const step of ['history', 'records', 'database', 'web', 'estimate']) {
    const ms = bySteps.get(step) ?? [];
    console.log(`  ${step.padEnd(9)} ${String(ms.length).padStart(4)}  (${pct(ms.length, decisions.length)})  median ${(median(ms) / 1000).toFixed(1)} s`);
  }
  const gates = new Map<string, number>();
  for (const d of decisions) if (d.gate) gates.set(d.gate, (gates.get(d.gate) ?? 0) + 1);
  if (gates.size) console.log(`  Web gate reasons: ${[...gates].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const surfaces = new Map<string, number>();
  for (const d of decisions) surfaces.set(d.surface, (surfaces.get(d.surface) ?? 0) + 1);
  console.log(`  By surface: ${[...surfaces].map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);

  const prisma = new PrismaClient();
  const meals = await prisma.mealEntry.findMany({
    where: { createdAt: { gte: new Date(since) }, source: { in: ['text', 'describe', 'agent-parsed', 'voice'] } },
    select: { id: true, notes: true },
  });
  await prisma.$disconnect();
  const edited = new Set(edits.map((e) => e.mealId));
  const looked = meals.filter((m) => /: from /.test(m.notes ?? ''));
  const estimated = meals.filter((m) => !/: from /.test(m.notes ?? ''));
  const rate = (xs: { id: string }[]) => `${xs.filter((m) => edited.has(m.id)).length}/${xs.length} (${pct(xs.filter((m) => edited.has(m.id)).length, xs.length)})`;
  console.log(`\nTyped meals corrected afterwards (calories/macros changed):`);
  console.log(`  looked up  ${rate(looked)}`);
  console.log(`  estimated  ${rate(estimated)}`);
  console.log(`  (edits are recorded from 9 Oct 2026; earlier meals count as unedited)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
