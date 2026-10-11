// Starbucks — the public ordering menu API behind starbucks.com / starbucks.ca
// (robots.txt allows /apiproxy/). Every size carries Starbucks' own nutrition
// and its recipe (how many pumps and shots it already contains).
//   node scripts/chains/adapters/starbucks.mjs <US|CA>
//
// Starbucks doesn't publish per-pump or per-shot nutrition, so add-ins are
// listed as modifiers with generic values marked `estimated`. Their `group`
// matches the size's `includes`, so "no caramel" removes exactly the pumps
// that drink has.
import { politeFetch } from '../politeFetch.mjs';
import { writeMenu, num } from '../writeMenu.mjs';

const cc = (process.argv[2] ?? 'US').toUpperCase();
const HOST = cc === 'CA' ? 'https://www.starbucks.ca' : 'https://www.starbucks.com';
const json = async (u) => JSON.parse((await politeFetch(u)).buf.toString());
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = (s) => String(s).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
const COFFEE_SIZES = ['short', 'tall', 'grande', 'venti', 'trenta'];

// Generic per-unit values (same as chainMenus GENERIC_MODIFIERS), marked estimated.
const EST = {
  syrup: { calories: 20, proteinG: 0, carbsG: 5, fatG: 0, micros: { sugarG: 5 } },
  sauce: { calories: 25, proteinG: 0.5, carbsG: 5, fatG: 0.5, micros: { sugarG: 4 } },
  sugarFree: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  shot: { calories: 5, proteinG: 0.3, carbsG: 1, fatG: 0 },
  whip: { calories: 80, proteinG: 0.5, carbsG: 3, fatG: 7, micros: { sugarG: 2, saturatedFatG: 4.5 } },
  foam: { calories: 60, proteinG: 1, carbsG: 7, fatG: 3, micros: { sugarG: 6 } },
};
function estimateFor(name) {
  const n = name.toLowerCase();
  if (/sugar[- ]free/.test(n)) return EST.sugarFree;
  if (/espresso shot|shot option|^shots?$/.test(n)) return EST.shot;
  if (/whipped cream/.test(n)) return EST.whip;
  if (/cold foam/.test(n)) return EST.foam;
  if (/sauce/.test(n)) return EST.sauce;
  if (/syrup/.test(n)) return EST.syrup;
  return null;
}
const optionName = (s) => clean(s).replace(/\s+Option$/i, '').replace(/^Add\s+/i, '');

function fact(n, id) {
  for (const f of n.additionalFacts ?? []) {
    if (f.id === id) return num(f.value);
    for (const sub of f.subfacts ?? []) if (sub.id === id) return num(sub.value);
  }
  return null;
}

const menu = await json(`${HOST}/apiproxy/v1/ordering/menu`);
const products = new Map();
(function walk(cats, path) {
  for (const c of cats ?? []) {
    for (const p of c.products ?? []) if (p.productNumber && p.formCode) products.set(`${p.productNumber}/${p.formCode}`, { ...p, category: path.concat(c.name).filter((x) => x !== 'The Latest').slice(-1)[0] });
    walk(c.children, path.concat(c.name));
  }
})(menu.menus, []);
console.log(`${products.size} products`);

const items = new Map();
const modifiers = new Map();
const addModifier = (name) => {
  const id = slug(name); if (!id || modifiers.has(id)) return id;
  const per = estimateFor(name);
  if (per) modifiers.set(id, { id, name, group: id, per, estimated: true, ...(/sugar[- ]free/i.test(name) ? { aliases: [name.replace(/sugar[- ]free/i, 'SF')] } : {}) });
  return id;
};

let n = 0;
for (const [key, p] of products) {
  if (++n % 50 === 0) console.log(`  ${n}/${products.size}`);
  let d;
  try { d = (await json(`${HOST}/apiproxy/v1/ordering/${key.toLowerCase()}`)).products?.[0]; } catch (e) { console.log(`  ${key}: ${String(e.message).slice(0, 80)}`); continue; }
  if (!d) continue;
  // Add-ins this product offers (syrups, sauces, whip, foam) become modifiers.
  (function walk(opts) { for (const o of opts ?? []) { for (const op of o.products ?? []) if (op.form?.name) addModifier(optionName(op.form.name)); walk(o.children); } })(d.productOptions);

  const name = clean(d.name ?? p.name);
  const form = String(d.formCode ?? p.formCode);
  const hasForm = name.toLowerCase().includes(form.toLowerCase());
  const id = slug(hasForm || !/^(iced|hot|frappuccino)$/i.test(form) ? name : `${name} ${form}`);
  const sizes = [];
  for (const s of d.sizes ?? []) {
    const nu = s.nutrition; const kcal = num(nu?.calories?.displayValue);
    if (!nu || kcal == null) continue;
    const sizeName = String(s.name ?? '').toLowerCase();
    const size = COFFEE_SIZES.find((x) => sizeName.includes(x)) ?? (sizes.length ? slug(sizeName) || 'regular' : 'regular');
    const includes = {};
    for (const r of s.recipe?.default ?? []) {
      const q = Number(r.quantity);
      if (!(q > 0) || r.sizeCode === 'no') continue;
      const mid = addModifier(optionName(r.skuName ?? ''));
      if (mid && modifiers.has(mid)) includes[mid] = (includes[mid] ?? 0) + q;
    }
    const micros = Object.fromEntries([['fiberG', fact(nu, 'dietaryFiber')], ['sugarG', fact(nu, 'sugars')], ['sodiumMg', fact(nu, 'sodium')], ['saturatedFatG', fact(nu, 'saturatedFat')], ['cholesterolMg', fact(nu, 'cholesterol')], ['caffeineMg', fact(nu, 'caffeine')]].filter(([, v]) => v != null));
    sizes.push({ size, label: clean(s.name ?? '') + (nu.servingSize?.displayValue ? ` (${clean(nu.servingSize.displayValue)})` : ''), calories: kcal, proteinG: fact(nu, 'protein') ?? 0, carbsG: fact(nu, 'totalCarbs') ?? 0, fatG: fact(nu, 'totalFat') ?? 0, micros, ...(Object.keys(includes).length ? { includes } : {}) });
  }
  if (!sizes.length) continue;
  const aliases = [];
  if (!hasForm && /^(iced|hot)$/i.test(form)) aliases.push(`${form} ${name}`);
  if (/caff[eè]/i.test(name)) aliases.push(name.replace(/caff[eè]\s*/i, ''));
  items.set(id, { id, name: hasForm || !/^(iced|hot)$/i.test(form) ? name : `${form} ${name}`, ...(aliases.length ? { aliases } : {}), category: p.category, url: `${HOST}/menu/product/${key.toLowerCase()}`, sizes });
}

writeMenu({
  chain: 'starbucks', country: cc, defaultSize: 'grande',
  source: { url: `${HOST}/menu`, fetchedAt: new Date().toISOString().slice(0, 10), note: 'Starbucks public ordering menu; numbers only. Add-in values are generic estimates (Starbucks does not publish per-pump nutrition).' },
  items: [...items.values()], modifiers: [...modifiers.values()],
});
process.exit(0);
