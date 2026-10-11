// A&W Canada — public menu feed on web.aw.ca (robots.txt: allow all).
//   node scripts/chains/adapters/aw-ca.mjs
import { politeFetch } from '../politeFetch.mjs';
import { writeMenu, SIZE_OF, num } from '../writeMenu.mjs';
const BASE = 'https://web.aw.ca/api/menu';
const list = JSON.parse((await politeFetch(`${BASE}/`)).buf.toString());
const slugs = new Set();
for (const cat of Object.values(list)) for (const it of cat.items ?? []) slugs.add(it.slug);
const items = new Map();
for (const slug of slugs) {
  let d;
  try { d = JSON.parse((await politeFetch(`${BASE}/${slug}/default`)).buf.toString()); } catch (e) { console.log(`  ${slug}: ${String(e.message).slice(0, 80)}`); continue; }
  const variants = [{ slug, data: d }];
  for (const o of d.options ?? []) if (o.slug !== slug) {
    try { variants.push({ slug: o.slug, data: JSON.parse((await politeFetch(`${BASE}/${o.slug}/default`)).buf.toString()) }); } catch { /* skip variant */ }
  }
  for (const v of variants) {
    const x = v.data; const kcal = num(x.calories); if (kcal == null) continue;
    const name = String(x.item ?? v.slug).replace(/™|®/g, '').trim();
    const base = name.replace(/\s*\((small|medium|large|regular|kids|junior)\)\s*/i, ' ').trim();
    const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const size = { size: SIZE_OF(name), label: x.servingsize ? String(x.servingsize).slice(0, 40) : undefined, calories: kcal, proteinG: num(x.protein) ?? 0, carbsG: num(x.carbohydrates) ?? 0, fatG: num(x.fat) ?? 0,
      micros: Object.fromEntries([['fiberG', num(x.fibre)], ['sugarG', num(x.sugar)], ['sodiumMg', num(x.sodium)], ['saturatedFatG', num(x.satfat)], ['cholesterolMg', num(x.cholesterol)]].filter(([, val]) => val != null)) };
    const cur = items.get(id);
    if (cur) { if (!cur.sizes.some((s) => s.size === size.size)) cur.sizes.push(size); }
    else items.set(id, { id, name: base, category: x.category, url: `https://web.aw.ca/en/our-menu/${v.slug}`, sizes: [size] });
  }
}
writeMenu({ chain: 'a-and-w-canada', country: 'CA', defaultSize: 'regular', source: { url: 'https://web.aw.ca/en/our-menu', fetchedAt: new Date().toISOString().slice(0, 10), note: 'A&W Canada public menu feed; numbers only' }, items: [...items.values()], modifiers: [] });
process.exit(0);
