// Shared writer: quality gate, then data/chains/menus (live) or menus-review.
import fs from 'node:fs';
import path from 'node:path';
// The same rule as src/services/food/chainNutritionGate.ts (kept in step by
// chainNutritionGate.test.ts): a size without full, sound macros is never
// published — it goes to menus-review/<chain>.<CC>.rejects.json with the reason.
const ALCOHOL = /\b(beer|lager|ale|ipa|stout|wine|sangria|mimosa|margarita|martini|mojito|cocktail|caesar\b(?!\s*salad)|bellini|spritz|sour|daiquiri|whisk(?:e)?y|vodka|rum|tequila|gin|bourbon|sake|soju|seltzer|cider|punch|negroni|paloma|pi[nñ]a colada|mule|old fashioned|long island|bloody mary)\b/i;
export function nutritionProblem(f, name = '') {
  const k = f.calories, p = f.proteinG, c = f.carbsG, fat = f.fatG;
  if (k == null || p == null || c == null || fat == null) return 'incomplete';
  const atwater = 4 * p + 4 * c + 9 * fat;
  if (k > 50 && atwater === 0) return 'calories_only';
  if (k >= 40 && Math.abs(atwater - k) / k > 0.25 && Math.abs(atwater - k) > 40) {
    if (ALCOHOL.test(name) && atwater < k) return null;
    return 'macros_mismatch';
  }
  return null;
}

// Shared writer: per-size quality gate, then data/chains/menus (live) or menus-review.
export function writeMenu(menu, { minItems = 8 } = {}) {
  const dataDir = path.join(process.cwd(), 'data', 'chains');
  const rejects = []; let sizesN = 0;
  menu.items = menu.items.map((it) => {
    const sizes = it.sizes.filter((s) => { sizesN++; const why = nutritionProblem(s, it.name); if (why) rejects.push({ item: it.name, size: s.size, why, calories: s.calories, proteinG: s.proteinG, carbsG: s.carbsG, fatG: s.fatG }); return !why; });
    return { ...it, sizes };
  }).filter((it) => it.sizes.length);
  menu.source = { ...menu.source, verified: 'every size has full macros that match its calories (chainNutritionGate)' };
  const ok = menu.items.length >= minItems;
  const out = path.join(dataDir, ok ? 'menus' : 'menus-review', `${menu.chain}.${menu.country}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(menu, null, 1));
  const stale = path.join(dataDir, ok ? 'menus-review' : 'menus', `${menu.chain}.${menu.country}.json`);
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
  const rej = path.join(dataDir, 'menus-review', `${menu.chain}.${menu.country}.rejects.json`);
  if (rejects.length) { fs.mkdirSync(path.dirname(rej), { recursive: true }); fs.writeFileSync(rej, JSON.stringify(rejects, null, 1)); } else if (fs.existsSync(rej)) fs.unlinkSync(rej);
  console.log(`${menu.chain}.${menu.country}: ${ok ? 'LIVE' : 'REVIEW'} ${menu.items.length} items, ${sizesN - rejects.length}/${sizesN} sizes passed, ${rejects.length} rejected, ${(menu.modifiers ?? []).length} modifiers → ${path.relative(process.cwd(), out)}`);
  return ok;
}
export const SIZE_OF = (name) => { const m = String(name).toLowerCase().match(/\b(kids|small|medium|large|regular|junior|snack)\b/); return m ? m[1] : 'regular'; };
export const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null; };
