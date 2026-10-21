// Osmow's (Canada) — the public data its own nutrition calculator loads
// (wp.osmows.com admin-ajax dodel_nutri: every meal with a "Base" or sized
// entry, plus each add-on's values). Numbers only.
//   node scripts/chains/adapters/osmows.mjs
import { politeFetch } from '../politeFetch.mjs';
import { writeMenu, num } from '../writeMenu.mjs';

const URL = 'https://wp.osmows.com/wp-admin/admin-ajax.php?action=dodel_nutri';
const cats = JSON.parse((await politeFetch(URL)).buf.toString());
const SIZES = { base: 'regular', regular: 'regular', small: 'small', medium: 'medium', large: 'large', kids: 'kids', 'kid\'s': 'kids', mini: 'small' };
const clean = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '\'').replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const facts = (n) => ({
  calories: num(n.calories), proteinG: num(n.protein), carbsG: num(n.carbohydrates), fatG: num(n.total_fat),
  micros: Object.fromEntries([['fiberG', n.fiber], ['sugarG', n.sugars], ['sodiumMg', n.sodium], ['saturatedFatG', n.saturated_fat], ['transFatG', n.trans_tat], ['cholesterolMg', n.cholesterol]].map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null)),
});

const items = new Map(); const seen = new Map();
const walk = (list, category) => {
  for (const c of list ?? []) {
    for (const m of c.children ?? []) {
      if (m.post_type !== 'meal' || m.post_status !== 'publish') { if (m.children) walk([m], clean(m.name)); continue; }
      // "Fattoush Salad (Large)": the size is in the name — one item, two sizes.
      const raw = clean(m.post_title);
      const sz = raw.match(/\((regular|small|medium|large|kids?|mini)\)\s*$/i);
      const name = sz ? raw.replace(sz[0], '').trim() : raw; const id = slug(name);
      if (!id) continue;
      const it = items.get(id) ?? { id, name, category: clean(c.name), sizes: [] };
      for (const n of m.nutritions ?? []) {
        const t = clean(n.title).toLowerCase();
        const f = facts(n);
        if (f.calories == null) continue;
        if (SIZES[t]) { const size = sz ? SIZES[sz[1].toLowerCase()] ?? SIZES[t] : SIZES[t]; if (!it.sizes.some((x) => x.size === size)) it.sizes.push({ size, ...f }); }
        else {
          // An add-on (Garlic Sauce, Tahini…): its most common published value becomes the modifier.
          const mid = slug(n.title); const k = `${mid}|${f.calories}`;
          const e = seen.get(mid) ?? { id: mid, name: clean(n.title), group: mid, counts: {} };
          e.counts[k] = { n: (e.counts[k]?.n ?? 0) + 1, f };
          seen.set(mid, e);
        }
      }
      if (it.sizes.length) items.set(id, it);
    }
    if (c.children?.some((x) => x.taxonomy)) walk(c.children.filter((x) => x.taxonomy), clean(c.name));
  }
};
walk(cats);
const modifiers = [...seen.values()].map((e) => ({ id: e.id, name: e.name, group: e.group, per: Object.values(e.counts).sort((a, b) => b.n - a.n)[0].f }));
writeMenu({
  chain: 'osmows', country: 'CA', defaultSize: 'regular',
  source: { url: 'https://osmows.com/nutrition-calculator', fetchedAt: new Date().toISOString().slice(0, 10), note: 'osmows public nutrition-calculator data (what its own calculator loads); numbers only' },
  items: [...items.values()], modifiers,
});
process.exit(0);
