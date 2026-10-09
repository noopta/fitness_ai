// Official chain menus, loaded from files — the first and most trusted check
// for anything ordered at a chain. Instant, exact and identical every time,
// unlike a web search.
//
// Data: backend/data/chains/
//   registry.json                    — every chain we know: names, aliases, official domains
//   menus/<chain>.<COUNTRY>.json      — one chain's published menu for one country
//
// An order is a base item in a size plus modifiers ("grande caramel protein
// latte, add a hazelnut shot, oat milk"). Modifiers the chain publishes come
// from its menu; ones it doesn't get a generic value that's labelled as an
// estimate — the base stays official.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { norm, productRecall } from './nameSearch.js';
import { coreProduct, menuSize, type BrandedFacts, type LabelMicros } from './brandedLookup.js';

export interface Macros { calories: number; proteinG: number; carbsG: number; fatG: number; micros?: LabelMicros }

export interface ChainEntry {
  id: string;
  name: string;
  aliases?: string[];
  countries?: string[];
  category?: string;
  officialDomains?: Record<string, string[]>;
  nutritionUrl?: Record<string, string | null>;
}

export interface MenuSize extends Macros {
  /** Normalized menu size ("grande", "medium", "footlong", "regular"). */
  size: string;
  label?: string;
  /** How many units of a modifier group this size already includes (e.g. { syrup: 4 }). */
  includes?: Record<string, number>;
}

export interface MenuItem {
  id: string;
  name: string;
  aliases?: string[];
  category?: string;
  sizes: MenuSize[];
  /** Modifier ids built into the item ("whipped-cream" on a mocha) — "no whip" subtracts them. */
  defaults?: string[];
  url?: string;
}

export interface Modifier {
  id: string;
  name: string;
  aliases?: string[];
  group?: string;
  /** Values for one unit (a pump, a shot, a slice, a side). */
  per?: Macros;
  /** Size-specific values (milk swaps, size-priced add-ons), keyed by menu size. */
  bySize?: Record<string, Macros>;
}

export interface ChainMenu {
  chain: string;
  country: string;
  source: { url: string; fetchedAt: string; note?: string };
  defaultSize?: string;
  items: MenuItem[];
  modifiers?: Modifier[];
}

const DATA_DIR = () => process.env.CHAIN_DATA_DIR || join(process.cwd(), 'data', 'chains');

let registry: ChainEntry[] | null = null;
let menus: Map<string, ChainMenu> | null = null;

export function loadRegistry(): ChainEntry[] {
  if (registry) return registry;
  try { registry = JSON.parse(readFileSync(join(DATA_DIR(), 'registry.json'), 'utf8')); } catch { registry = []; }
  return registry!;
}

export function loadMenus(): Map<string, ChainMenu> {
  if (menus) return menus;
  menus = new Map();
  const dir = join(DATA_DIR(), 'menus');
  if (!existsSync(dir)) return menus;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const m: ChainMenu = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      menus.set(`${m.chain}.${m.country}`, m);
    } catch (e) { console.error(`[chain-menus] bad menu file ${f}:`, (e as Error).message); }
  }
  return menus;
}

export function _setChainDataForTests(r: ChainEntry[] | null, m: ChainMenu[] | null): void {
  registry = r;
  menus = m ? new Map(m.map((x) => [`${x.chain}.${x.country}`, x])) : null;
}

/** The registry entry a typed brand refers to ("Tims", "Starbucks Coffee", "McDonald's"). */
export function findChain(brand: string, country?: string): ChainEntry | null {
  const b = norm(brand).replace(/\b(restaurant|restaurants|canada|usa|inc|co)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!b) return null;
  const squash = (s: string) => norm(s).replace(/ /g, '');
  const hits = loadRegistry().filter((c) => [c.name, c.id.replace(/-/g, ' '), ...(c.aliases ?? [])].some((n) => norm(n) === b || squash(n) === b.replace(/ /g, '')));
  // Same name, different companies (A&W Canada vs A&W US): the one in the user's country.
  return (country ? hits.find((c) => c.countries?.includes(country)) : null) ?? hits[0] ?? null;
}

/** Official domains for a chain in a country (falls back to every country's). */
export function officialDomains(chain: ChainEntry, country: string): string[] {
  const d = chain.officialDomains ?? {};
  const mine = d[country] ?? [];
  return mine.length ? mine : Object.values(d).flat();
}

/** Is this URL / site label on one of the chain's own domains? */
export function isOfficial(chain: ChainEntry, country: string, urlOrHost: string | null | undefined): boolean {
  if (!urlOrHost) return false;
  let host = urlOrHost.toLowerCase();
  try { host = new URL(urlOrHost).hostname.toLowerCase(); } catch { /* a bare host/title */ }
  host = host.replace(/^www\./, '');
  return officialDomains(chain, country).some((d) => host === d || host.endsWith(`.${d}`) || Object.values(chain.officialDomains ?? {}).flat().some((x) => host === x || host.endsWith(`.${x}`)));
}

/** The menu for a chain in the user's country, else the chain's other country (flagged). */
export function menuFor(chain: ChainEntry, country: string): { menu: ChainMenu; foreign: boolean } | null {
  const all = loadMenus();
  const mine = all.get(`${chain.id}.${country}`);
  if (mine) return { menu: mine, foreign: false };
  for (const c of chain.countries ?? ['US', 'CA']) {
    const m = all.get(`${chain.id}.${c}`);
    if (m) return { menu: m, foreign: true };
  }
  return null;
}

/** Best menu item for a typed product: same words both ways, aliases count. */
export function matchItem(menu: ChainMenu, product: string, brand: string): MenuItem | null {
  const want = coreProduct(product) || product;
  let best: { item: MenuItem; score: number } | null = null;
  for (const item of menu.items) {
    for (const name of [item.name, ...(item.aliases ?? [])]) {
      const a = productRecall({ brand, product: want }, name);
      const b = productRecall({ brand, product: name }, want);
      const score = Math.min(a, b) + (norm(name) === norm(want) ? 1 : 0);
      if (a >= 0.75 && b >= 0.6 && (!best || score > best.score)) best = { item, score };
    }
  }
  return best?.item ?? null;
}

export function pickSize(item: MenuItem, sizeText: string | null, menu: ChainMenu): MenuSize | null {
  const wanted = menuSize(sizeText) ?? (sizeText ? norm(sizeText) : null);
  if (wanted) {
    const s = item.sizes.find((x) => x.size === wanted || norm(x.label ?? '') === wanted);
    if (s) return s;
    return null; // asked for a size the item doesn't come in
  }
  return item.sizes.find((x) => x.size === menu.defaultSize) ?? (item.sizes.length === 1 ? item.sizes[0] : null);
}

// ── Modifiers ───────────────────────────────────────────────────────────────

/** Generic values for common add-ons a chain doesn't publish — always labelled as estimates. */
export const GENERIC_MODIFIERS: Array<{ re: RegExp; name: string; per: Macros }> = [
  // Order matters: the first pattern that matches wins.
  { re: /\b(sugar[- ]free|sf)\b.*\b(syrup|vanilla|caramel|hazelnut|mocha|pump|shot)\b/i, name: 'sugar-free syrup (pump)', per: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 } },
  { re: /\b(extra shot|espresso shot|add(ed)? shot|double shot)\b/i, name: 'espresso shot', per: { calories: 5, proteinG: 0.3, carbsG: 1, fatG: 0 } },
  { re: /\b(syrup|pump|flavou?r shot|hazelnut|vanilla|caramel|mocha sauce|cinnamon dolce|toffee nut|peppermint)\b/i, name: 'flavour syrup (pump)', per: { calories: 20, proteinG: 0, carbsG: 5, fatG: 0, micros: { sugarG: 5 } } },
  { re: /\bwhip(ped)?( cream)?\b/i, name: 'whipped cream', per: { calories: 80, proteinG: 0.5, carbsG: 3, fatG: 7, micros: { sugarG: 2, saturatedFatG: 4.5 } } },
  { re: /\bcold foam\b/i, name: 'cold foam', per: { calories: 60, proteinG: 1, carbsG: 7, fatG: 3, micros: { sugarG: 6 } } },
  { re: /\b(sugar|sweetener packet)\b/i, name: 'sugar (packet)', per: { calories: 15, proteinG: 0, carbsG: 4, fatG: 0, micros: { sugarG: 4 } } },
  { re: /\b(cream|creamer|half and half|half & half)\b/i, name: 'cream (serving)', per: { calories: 20, proteinG: 0.5, carbsG: 0.5, fatG: 2, micros: { saturatedFatG: 1.2 } } },
  { re: /\b(cheese|cheese slice)\b/i, name: 'cheese slice', per: { calories: 50, proteinG: 3, carbsG: 1, fatG: 4, micros: { sodiumMg: 200, saturatedFatG: 2.5, calciumMg: 100 } } },
  { re: /\bbacon\b/i, name: 'bacon (2 strips)', per: { calories: 80, proteinG: 6, carbsG: 0, fatG: 6, micros: { sodiumMg: 290, saturatedFatG: 2 } } },
  { re: /\b(mayo|mayonnaise|aioli|ranch|chipotle sauce|special sauce)\b/i, name: 'sauce (portion)', per: { calories: 90, proteinG: 0, carbsG: 1, fatG: 10, micros: { sodiumMg: 120 } } },
  { re: /\bavocado|guac(amole)?\b/i, name: 'avocado/guacamole (portion)', per: { calories: 80, proteinG: 1, carbsG: 4, fatG: 7, micros: { fiberG: 3 } } },
];

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, double: 2, triple: 3, extra: 1, half: 0.5 };

/** "2 pumps hazelnut" → 2, "a shot" → 1, "no whip" → -1 (remove). */
export function modifierQuantity(text: string): number {
  const t = text.toLowerCase();
  if (/\b(no|without|hold the|minus)\b/.test(t)) return -1;
  const n = t.match(/(\d+(?:\.\d+)?)/);
  if (n) return Math.min(10, Number(n[1]));
  for (const [w, v] of Object.entries(WORD_NUM)) if (new RegExp(`\\b${w}\\b`).test(t)) return v;
  return 1;
}

export interface AppliedModifier { text: string; name: string; quantity: number; official: boolean; calories: number }

function addMacros(a: Macros, b: Macros, k: number): Macros {
  const micros: LabelMicros = { ...(a.micros ?? {}) };
  for (const [key, v] of Object.entries(b.micros ?? {})) (micros as any)[key] = Math.max(0, ((micros as any)[key] ?? 0) + (v as number) * k);
  return {
    calories: Math.max(0, a.calories + b.calories * k), proteinG: Math.max(0, a.proteinG + b.proteinG * k),
    carbsG: Math.max(0, a.carbsG + b.carbsG * k), fatG: Math.max(0, a.fatG + b.fatG * k), micros,
  };
}

function matchModifier(menu: ChainMenu, text: string): Modifier | null {
  const t = norm(text.replace(/\b(add|added|with|extra|no|without|hold the|minus|pumps?|shots?|of|a|an|\d+)\b/gi, ' '));
  if (!t) return null;
  let best: { m: Modifier; score: number } | null = null;
  for (const m of menu.modifiers ?? []) {
    for (const name of [m.name, ...(m.aliases ?? [])]) {
      const n = norm(name);
      const want = t.split(' ').filter(Boolean);
      const have = new Set(n.split(' '));
      const recall = want.filter((w) => have.has(w) || have.has(w.replace(/s$/, ''))).length / want.length;
      const back = n.split(' ').filter((w) => t.split(' ').includes(w)).length / Math.max(1, n.split(' ').length);
      const score = recall + back;
      if (recall >= 0.6 && back >= 0.5 && (!best || score > best.score)) best = { m, score };
    }
  }
  return best?.m ?? null;
}

/**
 * Base item in a size, plus modifiers. Published modifiers come from the menu;
 * unpublished ones use GENERIC_MODIFIERS and are marked unofficial. A "no X"
 * only subtracts X if the item actually includes it.
 */
export function priceOrder(menu: ChainMenu, item: MenuItem, size: MenuSize, modifierTexts: string[]): { total: Macros; applied: AppliedModifier[]; unmatched: string[] } {
  let total: Macros = { calories: size.calories, proteinG: size.proteinG, carbsG: size.carbsG, fatG: size.fatG, micros: { ...(size.micros ?? {}) } };
  const applied: AppliedModifier[] = [];
  const unmatched: string[] = [];
  for (const text of modifierTexts) {
    const q = modifierQuantity(text);
    const m = matchModifier(menu, text);
    if (m) {
      const unit = m.bySize?.[size.size] ?? m.per;
      if (!unit) { unmatched.push(text); continue; }
      if (q < 0) {
        const included = (item.defaults ?? []).includes(m.id) || (m.group && (size.includes?.[m.group] ?? 0) > 0);
        if (!included) continue;
        const units = m.group && size.includes?.[m.group] ? size.includes[m.group] : 1;
        total = addMacros(total, unit, -units);
        applied.push({ text, name: m.name, quantity: -units, official: true, calories: -Math.round(unit.calories * units) });
      } else {
        total = addMacros(total, unit, q);
        applied.push({ text, name: m.name, quantity: q, official: true, calories: Math.round(unit.calories * q) });
      }
      continue;
    }
    const g = GENERIC_MODIFIERS.find((x) => x.re.test(text));
    if (g && q > 0) {
      total = addMacros(total, g.per, q);
      applied.push({ text, name: g.name, quantity: q, official: false, calories: Math.round(g.per.calories * q) });
    } else if (q > 0) unmatched.push(text);
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const micros: LabelMicros = {};
  for (const [k, v] of Object.entries(total.micros ?? {})) (micros as any)[k] = r1(v as number);
  return { total: { calories: Math.round(total.calories), proteinG: r1(total.proteinG), carbsG: r1(total.carbsG), fatG: r1(total.fatG), micros }, applied, unmatched };
}

export interface ChainMatch {
  facts: BrandedFacts;
  item: MenuItem;
  size: MenuSize;
  applied: AppliedModifier[];
  unmatched: string[];
  foreign: boolean;
}

/** Look an order up in the chain's official menu. Null when the chain, item or size isn't there. */
export function lookupChainMenu(
  order: { brand: string; product: string; size: string | null; modifiers?: string[] },
  country: string,
): ChainMatch | null {
  const chain = findChain(order.brand, country);
  if (!chain) return null;
  const found = menuFor(chain, country);
  if (!found) return null;
  const { menu, foreign } = found;
  const item = matchItem(menu, order.product, order.brand);
  if (!item) return null;
  const size = pickSize(item, order.size, menu);
  if (!size) return null;
  const { total, applied, unmatched } = priceOrder(menu, item, size, order.modifiers ?? []);
  const site = (chain.officialDomains?.[menu.country] ?? [])[0] ?? chain.name;
  return {
    item, size, applied, unmatched, foreign,
    facts: {
      name: [item.name, size.label ?? size.size].filter(Boolean).join(' · '),
      brand: chain.name,
      servingSize: size.label ?? size.size,
      calories: total.calories, proteinG: total.proteinG, carbsG: total.carbsG, fatG: total.fatG,
      micros: total.micros,
      sources: [{ title: foreign ? `${site} (${menu.country} menu)` : site, uri: item.url ?? menu.source.url }],
    },
  };
}
