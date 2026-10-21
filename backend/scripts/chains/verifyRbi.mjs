// Independent check: every item the brand's nutrition explorer shows vs our menu
// file — calories, protein, carbs, fat (as served). Prints a per-chain report.
//   node scripts/chains/verifyRbi.mjs <th|bk|plk> <CA|US>
import fs from 'node:fs';
import { politeFetch } from './politeFetch.mjs';
const [brand, cc0] = process.argv.slice(2); const cc = (cc0 ?? 'CA').toUpperCase();
const CHAIN = { th: 'tim-hortons', bk: 'burger-king', plk: 'popeyes' }[brand];
const PROJECT = brand === 'bk' ? 'kjfd81ul' : 'czqk28jt';
const GROQ = `https://${PROJECT}.apicdn.sanity.io/v1/data/query/prod_${brand}_${cc.toLowerCase()}`;
const groq = async (q, params = {}) => JSON.parse((await politeFetch(`${GROQ}?${new URLSearchParams({ query: q, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [`$${k}`, JSON.stringify(v)])) })}`)).buf.toString()).result;
const page = await groq('*[_type=="staticPage" && path.current=="nutrition-explorer"][0]{widgets}');
const root = (page?.widgets ?? []).find((w) => w._type === 'nutritionExplorerWidget')?.menu?._ref;
if (!root) { console.log(`${CHAIN}.${cc}: no nutrition explorer`); process.exit(0); }
const LEAF = new Set(['item', 'modifier', 'modifierMultiplier', 'itemOption', 'sanity.imageAsset']);
const ids = new Set(); const seen = new Set([root]); let frontier = [root];
while (frontier.length) {
  const batch = frontier.slice(0, 80); frontier = frontier.slice(80);
  for (const d of await groq('*[_id in $ids]', { ids: batch })) {
    if (d._type === 'item') { ids.add(d._id); continue; }
    if (LEAF.has(d._type)) continue;
    for (const [, ref] of JSON.stringify(d).matchAll(/"_ref":"([^"]+)"/g)) if (!seen.has(ref) && !ref.startsWith('image-')) { seen.add(ref); frontier.push(ref); }
  }
}
const items = await groq('*[_id in $ids]{_id,"name":name.en,"n":coalesce(nutritionWithModifiers, nutrition)}', { ids: [...ids] });
const file = JSON.parse(fs.readFileSync(`data/chains/menus/${CHAIN}.${cc}.json`, 'utf8'));
const clean = (s) => String(s ?? '').replace(/[​-‍﻿®™ ]/g, ' ').replace(/\s*-\s*Reusable Cup\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
const all = file.items.flatMap((it) => it.sizes.map((s) => ({ name: clean(it.name), size: s.size, ...s })));
let ok = 0, off = 0, missing = 0; const bad = [];
for (const it of items) {
  if (it.n?.calories == null) continue;
  const name = clean(it.name);
  const cands = all.filter((r) => name === r.name || name.endsWith(` ${r.name}`) || name.startsWith(`${r.name} `));
  if (!cands.length) { missing++; continue; }
  const close = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= Math.max(1, 0.03 * Math.abs(b ?? 0));
  const hit = cands.find((r) => close(r.calories, it.n.calories) && close(r.proteinG, it.n.proteins) && close(r.carbsG, it.n.carbohydrates) && close(r.fatG, it.n.fat));
  if (hit) ok++; else { off++; if (bad.length < 10) bad.push(`${it.name}: site ${it.n.calories}/${it.n.proteins}/${it.n.carbohydrates}/${it.n.fat} vs ours ${cands.map((c) => `${c.size} ${c.calories}/${c.proteinG}/${c.carbsG}/${c.fatG}`).join(', ')}`); }
}
console.log(`${CHAIN}.${cc}: explorer ${items.length} items — ${ok} match, ${off} differ, ${missing} not in our file`);
for (const b of bad) console.log('   ', b);
