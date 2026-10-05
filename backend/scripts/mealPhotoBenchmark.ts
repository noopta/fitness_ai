// Meal-photo benchmark: legacy analyzer vs itemised v2, on labeled photos.
// Makes REAL Vertex (and, if USDA_API_KEY is set, USDA) calls — costs money.
// Run from backend/:
//
//   npx tsx scripts/mealPhotoBenchmark.ts <imageDir> [runsPerPhoto=3] [--only=v2|legacy]
//
// <imageDir>/labels.json:
//   [ { "file": "chicken-rice.jpg", "items": ["chicken breast", "white rice", "broccoli", "olive oil"], "approxKcal": 650 }, … ]
//
// Prints per photo and overall, for each analyzer:
//   - item recall: share of labeled items found (fuzzy token match on names)
//   - same-photo calorie spread: (max − min) / mean across the N runs
//   - kcal vs label: mean absolute % error against approxKcal, when given
//   - latency: median and max seconds per analysis
//
// v2 runs bypass the image-hash cache on purpose (it would make the spread
// trivially 0) — this measures the model + USDA pricing, the thing the cache
// sits in front of. Release gates (docs/FREESTYLE_RELEASE_2026-10.md):
// recall ≥ 96%, retake spread ≤ 5%.

import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { analyzeMealPhoto, analyzeMealPhotoItems } from '../src/services/llmService.js';
import { resolveItems, sumItems } from '../src/services/food/mealPhotoItems.js';
import { tokens } from '../src/services/food/usdaLookup.js';

interface Label {
  file: string;
  items: string[];
  approxKcal?: number;
}

interface RunResult {
  names: string[];
  kcal: number;
}

type Analyzer = (base64: string, mimeType: string) => Promise<RunResult>;

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' };

const legacy: Analyzer = async (b64, mime) => {
  const d = await analyzeMealPhoto(b64, mime);
  return { names: d.ingredients.length ? d.ingredients : [d.name], kcal: d.calories };
};

const v2: Analyzer = async (b64, mime) => {
  const raw = await analyzeMealPhotoItems([{ base64: b64, mimeType: mime }]);
  const { items } = await resolveItems(raw.items, 'bench00000');
  return { names: items.map((i) => i.name), kcal: sumItems(items).calories };
};

/** A labeled item counts as found when ≥ half its words appear in one predicted name. */
export function itemFound(label: string, predicted: string[]): boolean {
  const want = tokens(label);
  if (!want.length) return true;
  return predicted.some((p) => {
    const have = new Set(tokens(p));
    return want.filter((t) => have.has(t)).length / want.length >= 0.5;
  });
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean > 0 ? (Math.max(...values) - Math.min(...values)) / mean : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npx tsx scripts/mealPhotoBenchmark.ts <imageDir> [runs=3] [--only=v2|legacy]');
    process.exit(1);
  }
  const runs = Math.max(1, Number(process.argv[3]) || 3);
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const labels: Label[] = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const present = new Set(readdirSync(dir));

  const analyzers: Array<[string, Analyzer]> = ([['legacy', legacy], ['v2', v2]] as Array<[string, Analyzer]>)
    .filter(([n]) => !only || n === only);

  for (const [name, analyze] of analyzers) {
    let found = 0, wanted = 0, kcalErrSum = 0, kcalErrN = 0;
    const spreads: number[] = [];
    const allSecs: number[] = [];
    console.log(`\n=== ${name} (${runs} run(s) per photo) ===`);
    for (const label of labels) {
      if (!present.has(label.file)) { console.warn(`  skip ${label.file}: not found`); continue; }
      const mime = MIME[extname(label.file).toLowerCase()] ?? 'image/jpeg';
      const b64 = readFileSync(join(dir, label.file)).toString('base64');
      const kcals: number[] = [];
      const secs: number[] = [];
      let photoFound = 0;
      for (let i = 0; i < runs; i++) {
        try {
          const t0 = Date.now();
          const r = await analyze(b64, mime);
          secs.push((Date.now() - t0) / 1000);
          allSecs.push(secs[secs.length - 1]);
          kcals.push(r.kcal);
          const hit = label.items.filter((it) => itemFound(it, r.names)).length;
          photoFound += hit;
          found += hit;
          wanted += label.items.length;
          if (label.approxKcal) { kcalErrSum += Math.abs(r.kcal - label.approxKcal) / label.approxKcal; kcalErrN++; }
        } catch (err) {
          console.warn(`  ${label.file} run ${i + 1} failed: ${(err as Error).message}`);
        }
      }
      const s = spread(kcals);
      spreads.push(s);
      const recall = label.items.length && kcals.length ? photoFound / (label.items.length * kcals.length) : 0;
      console.log(`  ${label.file}: recall ${pct(recall)}  kcal [${kcals.join(', ')}]  spread ${pct(s)}  ${secs.map((x) => x.toFixed(1)).join('/')}s${label.approxKcal ? `  label ${label.approxKcal}` : ''}`);
    }
    const meanSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;
    console.log(`  -- item recall ${wanted ? pct(found / wanted) : 'n/a'} | mean same-photo spread ${pct(meanSpread)} | max spread ${pct(Math.max(0, ...spreads))} | kcal vs label MAPE ${kcalErrN ? pct(kcalErrSum / kcalErrN) : 'n/a'} | latency median ${median(allSecs).toFixed(1)}s max ${Math.max(0, ...allSecs).toFixed(1)}s`);
  }
}

if (process.argv[1]?.includes('mealPhotoBenchmark')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
