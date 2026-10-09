/**
 * Evaluate typed-food lookups against hand-verified label values.
 *
 * For each case in eval/food-lookup-cases.json it runs the real meal parser
 * (the estimate) and the real resolver (scans → records → databases → web),
 * then compares both with the verified truth. A case with truth null is
 * reported but not scored.
 *
 * Usage (from backend/, needs the prod .env for OpenAI/Vertex/USDA):
 *   npx tsx scripts/evalFoodLookup.ts [--tz America/Edmonton] [--only 3,7]
 *
 * Costs real model calls (one parse per case, a grounded search per web step).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMealMacros, finishLookups } from '../src/services/llmService.js';
import { resolveAll } from '../src/services/food/foodResolver.js';

interface Case { id: number; description: string; truth: { calories: number; proteinG: number; carbsG: number; fatG: number } | null; source?: string; notes?: string }

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const tz = arg('--tz') ?? 'America/Edmonton';
const only = arg('--only')?.split(',').map(Number);
const cases: Case[] = JSON.parse(readFileSync(join(process.cwd(), 'eval', 'food-lookup-cases.json'), 'utf8')).filter((c: Case) => !only || only.includes(c.id));

const pctErr = (got: number, want: number) => (want === 0 ? (got === 0 ? 0 : 1) : Math.abs(got - want) / want);

async function main() {
  const rows: string[] = [];
  const est: number[] = [], res: number[] = [], estP: number[] = [], resP: number[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    const parsed = await parseMealMacros(c.description, 'global', { tz, lookup: false });
    const items = parsed.brandedItems ?? [];
    const resolved = items.length ? await resolveAll(items, { tz, surface: 'api', deps: { log: () => {} } }) : [];
    const final = items.length ? finishLookups(parsed, items, resolved) : parsed;
    const ms = Date.now() - t0;
    const steps = resolved.map((r) => r.step).join('+') || 'none';
    if (c.truth) {
      est.push(pctErr(parsed.calories, c.truth.calories)); res.push(pctErr(final.calories, c.truth.calories));
      estP.push(Math.abs(parsed.proteinG - c.truth.proteinG)); resP.push(Math.abs(final.proteinG - c.truth.proteinG));
    }
    rows.push([
      String(c.id).padStart(2), c.description.slice(0, 46).padEnd(46),
      `est ${String(Math.round(parsed.calories)).padStart(4)}`, `got ${String(Math.round(final.calories)).padStart(4)}`,
      `truth ${c.truth ? String(c.truth.calories).padStart(4) : '   ?'}`, steps.padEnd(9), `${(ms / 1000).toFixed(1)}s`,
      parsed.clarify?.length ? `asks: ${parsed.clarify[0]}` : '',
    ].join('  '));
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(rows.join('\n'));
  console.log(`\nScored cases: ${est.length}`);
  console.log(`Calories, mean abs % error — estimate ${(mean(est) * 100).toFixed(1)}%  ·  with lookups ${(mean(res) * 100).toFixed(1)}%`);
  console.log(`Protein, mean abs error (g) — estimate ${mean(estP).toFixed(1)}  ·  with lookups ${mean(resP).toFixed(1)}`);
  console.log(`Within 10% of label — estimate ${est.filter((e) => e <= 0.1).length}/${est.length}  ·  with lookups ${res.filter((e) => e <= 0.1).length}/${res.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
