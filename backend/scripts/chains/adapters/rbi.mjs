// Tim Hortons, Burger King and Popeyes (Restaurant Brands International) —
// the public Sanity CDN their sites read the menu from (no robots.txt on the
// host). Each size is its own document with its own nutrition, and every
// add-in row carries its own published values for that size, so modifiers
// here are official — including milk swaps.
//   node scripts/chains/adapters/rbi.mjs <th|bk|plk> <US|CA>
import { politeFetch } from '../politeFetch.mjs';
import { writeMenu, num } from '../writeMenu.mjs';

const brand = process.argv[2]; const cc = (process.argv[3] ?? 'CA').toUpperCase();
const CHAIN = { th: 'tim-hortons', bk: 'burger-king', plk: 'popeyes' }[brand];
if (!CHAIN) { console.error('usage: rbi.mjs <th|bk|plk> <US|CA>'); process.exit(2); }
const SITE = { th: { CA: 'https://www.timhortons.ca', US: 'https://www.timhortons.com' }, bk: { CA: 'https://www.burgerking.ca', US: 'https://www.bk.com' }, plk: { CA: 'https://www.popeyeschicken.ca', US: 'https://www.popeyes.com' } }[brand][cc];
const API = `https://czqk28jt.apicdn.sanity.io/v1/graphql/prod_${brand}_${cc.toLowerCase()}/default`;
const NUT = 'calories proteins carbohydrates fat fiber sugar sodium saturatedFat cholesterol';
const Q = (limit, offset) => `{allItems(limit:${limit}, offset:${offset}){_id name{en} isDummyItem nutrition{${NUT}} options{name{en} options{name{en} default nutrition{${NUT}} modifierMultiplier{multiplier modifier{name{en}}}}}}}`;

const docs = [];
for (let off = 0; ; off += 400) {
  const r = JSON.parse((await politeFetch(`${API}?query=${encodeURIComponent(Q(400, off))}`)).buf.toString());
  if (r.errors) throw new Error(JSON.stringify(r.errors[0]));
  docs.push(...r.data.allItems);
  if (r.data.allItems.length < 400) break;
}
console.log(`${docs.length} documents`);

// Only items the live menu reaches (menu → sections → pickers → items). The
// dataset also holds retired recipes under the same names (two "Medium Latte"
// records, 124 and 229 kcal); the site shows the one its menu points to.
const GROQ = `https://czqk28jt.apicdn.sanity.io/v1/data/query/prod_${brand}_${cc.toLowerCase()}`;
const groq = async (q, params = {}) => JSON.parse((await politeFetch(`${GROQ}?${new URLSearchParams({ query: q, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [`$${k}`, JSON.stringify(v)])) })}`)).buf.toString()).result;
const LEAF = new Set(['item', 'modifier', 'modifierMultiplier', 'itemOption', 'configOffer', 'offer', 'reward', 'systemwideOffer', 'sanity.imageAsset', 'restaurant']);
const reachable = new Set();
{
  const roots = (await groq('*[_type=="menu" && !(_id in path("drafts.**"))]{_id,"n":name.en}')).filter((m) => !/catering/i.test(m.n ?? '')).map((m) => m._id);
  const seen = new Set(roots); let frontier = [...roots];
  while (frontier.length) {
    const batch = frontier.slice(0, 80); frontier = frontier.slice(80);
    for (const d of await groq('*[_id in $ids]', { ids: batch })) {
      if (d._type === 'item') { reachable.add(d._id); continue; }
      if (LEAF.has(d._type)) continue;
      for (const [, ref] of JSON.stringify(d).matchAll(/"_ref":"([^"]+)"/g)) if (!seen.has(ref) && !ref.startsWith('image-')) { seen.add(ref); frontier.push(ref); }
    }
  }
  console.log(`${reachable.size} items on the live menu`);
}

const clean = (s) => String(s ?? '').replace(/[​-‍﻿®™]/g, '').replace(/\s*-\s*Reusable Cup\s*$/i, '').replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/%/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SIZES = [['extra large', /^(extra[- ]large|x-?large|xl)\s+/i], ['small', /^small\s+/i], ['medium', /^medium\s+/i], ['large', /^large\s+/i], ['kids', /^(kids?|junior)\s+/i]];
const TRAILING = [['extra large', /\s+(extra[- ]large|x-?large)$/i], ['small', /\s+small$/i], ['medium', /\s+medium$/i], ['large', /\s+large$/i]];
const splitSize = (name) => {
  for (const [size, re] of SIZES) if (re.test(name)) return { size, base: name.replace(re, '') };
  for (const [size, re] of TRAILING) if (re.test(name)) return { size, base: name.replace(re, '') };
  return { size: 'regular', base: name };
};
// Back-office records ("Coffee Dark Roast SM-(US)", "Bagel BELT Each") aren't menu names.
const BACK_OFFICE = /\b(SM|MD|LG|XL)-|\((US|CA)\)|\bEach$|\bmodifier\b|\btest\b|^zz|\bdo not use\b/i;
const macros = (n, k = 1) => {
  const r1 = (v) => Math.round((v / k) * 10) / 10;
  const micros = Object.fromEntries([['fiberG', n.fiber], ['sugarG', n.sugar], ['sodiumMg', n.sodium], ['saturatedFatG', n.saturatedFat], ['cholesterolMg', n.cholesterol]].filter(([, v]) => num(v) != null).map(([key, v]) => [key, r1(v)]));
  return { calories: Math.round(n.calories / k), proteinG: r1(n.proteins ?? 0), carbsG: r1(n.carbohydrates ?? 0), fatG: r1(n.fat ?? 0), micros };
};
const today = new Date().toISOString().slice(0, 10);

const items = new Map(); const modifiers = new Map();
for (const d of docs) {
  const raw = clean(d.name?.en);
  if (!raw || d.isDummyItem || BACK_OFFICE.test(raw) || num(d.nutrition?.calories) == null) continue;
  if (reachable.size && !reachable.has(d._id)) continue;
  const { size, base } = splitSize(raw);
  const includes = {}; const modValues = {};
  for (const g of d.options ?? []) {
    const rows = (g.options ?? []).filter((m) => m.modifierMultiplier);
    const names = new Set(rows.map((m) => clean(m.name?.en ?? m.modifierMultiplier.modifier?.name?.en)));
    // Several choices in one group = pick one (milks). All dairy groups are one swap group.
    const gName = clean(g.name?.en);
    const swapGroup = names.size > 1 ? (/dairy|milk|cream|beverage/i.test(gName) ? 'dairy' : slug(gName.replace(/\b(for|small|medium|large|extra|frozen|hot|iced|beverage)\b/gi, ' '))) : undefined;
    for (const m of rows) {
      const name = clean(m.name?.en ?? m.modifierMultiplier.modifier?.name?.en).replace(/\s+modifier.*$/i, '');
      const mult = Number(m.modifierMultiplier.multiplier);
      if (!name || !(mult > 0)) continue;
      const id = slug(name);
      if (m.default) includes[id] = Math.round(mult * 100) / 100;
      if (num(m.nutrition?.calories) == null) continue;
      const mod = modifiers.get(id) ?? { id, name, group: id, ...(swapGroup ? { swapGroup } : {}), seen: {} };
      // Prefer the "1" row for the unit value; other quantities are multiples of it.
      if (!modValues[id] || Math.abs(mult - 1) < 0.01) modValues[id] = macros(m.nutrition, mult);
      modifiers.set(id, mod);
    }
  }
  const id = slug(base);
  const entry = items.get(id) ?? { id, name: base, sizes: [] };
  if (!entry.sizes.some((s) => s.size === size)) {
    // Only count includes we can price; the rest can't be removed or swapped anyway.
    entry.sizes.push({ size, ...macros(d.nutrition), ...(Object.keys(includes).length ? { includes } : {}), modValues });
    for (const [mid, v] of Object.entries(modValues)) { const k = `${size}|${v.calories}`; const seen = modifiers.get(mid).seen; seen[k] = { n: (seen[k]?.n ?? 0) + 1, v }; }
  }
  items.set(id, entry);
}
// Each modifier's menu-wide value per size is its most common one; a drink
// keeps its own value only where it differs (cream in a coffee ≠ in a frozen drink).
for (const m of modifiers.values()) {
  m.bySize = {};
  for (const { n, v } of Object.values(m.seen).sort((a, b) => b.n - a.n)) { const size = Object.keys(m.seen).find((k) => m.seen[k].v === v).split('|')[0]; if (!m.bySize[size]) m.bySize[size] = v; }
  delete m.seen;
}
// Tim's shorthand orders, built from published parts: Original Blend plus N
// cream and N sugar at that size ("double double" = 2 and 2), using the values
// published for that coffee.
const coffee = items.get('coffee-original-blend');
if (brand === 'th' && coffee) {
  for (const [id, name, n] of [['regular-coffee', 'Regular', 1], ['double-double', 'Double Double', 2], ['triple-triple', 'Triple Triple', 3], ['four-by-four', 'Four by Four', 4]]) {
    const sizes = coffee.sizes.filter((s) => s.modValues?.cream && s.modValues?.sugar).map((s) => {
      const add = (k) => Math.round((s[k] + n * (s.modValues.cream[k] + s.modValues.sugar[k])) * 10) / 10;
      return { size: s.size, calories: Math.round(add('calories')), proteinG: add('proteinG'), carbsG: add('carbsG'), fatG: add('fatG'), includes: { cream: n, sugar: n }, modValues: s.modValues };
    });
    if (sizes.length) items.set(id, { id, name, aliases: [`${name} coffee`], sizes });
  }
}
for (const it of items.values()) for (const s of it.sizes) {
  for (const [mid, v] of Object.entries(s.modValues ?? {})) if (modifiers.get(mid)?.bySize[s.size]?.calories === v.calories) delete s.modValues[mid];
  if (!Object.keys(s.modValues ?? {}).length) delete s.modValues;
}
// Drop includes that never got a price (e.g. a foam with no values).
for (const it of items.values()) for (const s of it.sizes) if (s.includes) { for (const k of Object.keys(s.includes)) if (!modifiers.has(k)) delete s.includes[k]; if (!Object.keys(s.includes).length) delete s.includes; }

writeMenu({
  chain: CHAIN, country: cc, defaultSize: brand === 'th' ? 'medium' : 'regular',
  source: { url: `${SITE}/menu`, fetchedAt: today, note: `${CHAIN} public menu data (the CDN its own site reads); numbers only` },
  items: [...items.values()], modifiers: [...modifiers.values()].map((m) => ({ ...m, per: m.bySize.medium ?? m.bySize.regular ?? Object.values(m.bySize)[0] })),
});
process.exit(0);
