/**
 * Check every chain menu file before it ships.
 *
 * Usage (from backend/): npx tsx scripts/chains/validateMenus.ts
 * Exits non-zero on errors. Warnings are printed but don't fail.
 *
 * Errors: unknown chain id, duplicate item ids, an item with no sizes, a size
 * with no calories, a modifier with no values. Warnings: macros that don't
 * add up to the calories (±35%, the same tolerance as the lookups) — chains
 * round, and fibre/alcohol/sugar alcohols skew it, so these need a look,
 * not an automatic rejection.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainEntry, ChainMenu } from '../../src/services/food/chainMenus.js';

const dir = process.env.CHAIN_DATA_DIR || join(process.cwd(), 'data', 'chains');
const registry: ChainEntry[] = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
const ids = new Set(registry.map((c) => c.id));
const errors: string[] = [];
const warnings: string[] = [];

const menusDir = join(dir, 'menus');
const files = existsSync(menusDir) ? readdirSync(menusDir).filter((f) => f.endsWith('.json')) : [];
let items = 0, sizes = 0, modifiers = 0;
for (const f of files) {
  let m: ChainMenu;
  try { m = JSON.parse(readFileSync(join(menusDir, f), 'utf8')); } catch (e) { errors.push(`${f}: not valid JSON (${(e as Error).message})`); continue; }
  if (!ids.has(m.chain)) errors.push(`${f}: chain "${m.chain}" is not in registry.json`);
  if (f !== `${m.chain}.${m.country}.json`) errors.push(`${f}: file name should be ${m.chain}.${m.country}.json`);
  if (!m.source?.url) errors.push(`${f}: no source.url`);
  const seen = new Set<string>();
  for (const it of m.items ?? []) {
    items++;
    if (seen.has(it.id)) errors.push(`${f}: duplicate item id ${it.id}`);
    seen.add(it.id);
    if (!it.sizes?.length) { errors.push(`${f}: ${it.id} has no sizes`); continue; }
    for (const s of it.sizes) {
      sizes++;
      if (typeof s.calories !== 'number') { errors.push(`${f}: ${it.id}/${s.size} has no calories`); continue; }
      const k = 4 * (s.proteinG ?? 0) + 4 * (s.carbsG ?? 0) + 9 * (s.fatG ?? 0);
      if (s.calories > 40 && k > 0 && Math.abs(k - s.calories) / s.calories > 0.35) warnings.push(`${f}: ${it.id}/${s.size} macros give ${Math.round(k)} kcal vs ${s.calories}`);
    }
  }
  for (const mod of m.modifiers ?? []) {
    modifiers++;
    if (!mod.per && !mod.bySize) errors.push(`${f}: modifier ${mod.id} has no values`);
  }
}

console.log(`${files.length} menus · ${items} items · ${sizes} sizes · ${modifiers} modifiers · ${registry.length} chains in registry`);
for (const w of warnings.slice(0, 50)) console.log(`warn  ${w}`);
if (warnings.length > 50) console.log(`warn  …and ${warnings.length - 50} more`);
for (const e of errors) console.log(`ERROR ${e}`);
process.exit(errors.length ? 1 : 0);
