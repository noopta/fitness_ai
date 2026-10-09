// Name search in the structured food databases — Open Food Facts and USDA's
// Branded Foods — for a typed branded item ("Barebells cookies & cream bar").
//
// Both answer in ~0.5 s and are free, so they run before any web search. A
// hit only counts when the candidate is from the SAME brand (USDA happily
// returns Quest bars for a Barebells query) and names the product, and its
// values are for one serving as sold (a bar, a bag, a bottle).

import { mentionsBrand, type BrandedFacts, type BrandedItem } from './brandedLookup.js';

const OFF_SEARCH = 'https://search.openfoodfacts.org/search';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const TIMEOUT_MS = 3000;
const UA = 'Axiom/1.0 (support@axiomtraining.io)';

export interface DbCandidate {
  db: 'off' | 'usda';
  brand: string;
  name: string;
  servingSize: string | null;
  /** Per serving as sold; null when the source has no serving. */
  perServing: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  canada: boolean;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'of', 'in', 'on', 'from', 'by', 'flavour', 'flavor', 'flavored', 'flavoured']);
export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s: string) => norm(s).split(' ').filter((t) => t && !STOP.has(t));

/** Share of the product's words (brand words removed) found in the candidate's name. */
export function productRecall(item: Pick<BrandedItem, 'brand' | 'product'>, candidateName: string): number {
  const brandWords = new Set(toks(item.brand));
  const want = toks(item.product).filter((t) => !brandWords.has(t));
  if (!want.length) return 0;
  const have = new Set(toks(candidateName));
  // Light stemming: "bars" ~ "bar", "chips" ~ "chip".
  const hit = want.filter((t) => have.has(t) || have.has(t.replace(/s$/, '')) || have.has(`${t}s`)).length;
  return hit / want.length;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function addsUp(m: { calories: number; proteinG: number; carbsG: number; fatG: number }): boolean {
  const k = 4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG;
  if (m.calories <= 0) return k <= 20;
  return k === 0 || Math.abs(k - m.calories) / m.calories <= 0.35;
}

/** One OFF search-a-licious hit → candidate. Exported for tests. */
export function offCandidate(p: any): DbCandidate | null {
  const brand = Array.isArray(p?.brands) ? p.brands.join(', ') : String(p?.brands ?? '');
  const name = String(p?.product_name ?? '').trim();
  if (!brand || !name) return null;
  const n = p?.nutriments ?? {};
  let perServing: DbCandidate['perServing'] = null;
  const ks = num(n['energy-kcal_serving']);
  if (ks != null) {
    perServing = { calories: ks, proteinG: num(n.proteins_serving) ?? 0, carbsG: num(n.carbohydrates_serving) ?? 0, fatG: num(n.fat_serving) ?? 0 };
  } else {
    const g = num(p?.serving_quantity);
    const k100 = num(n['energy-kcal_100g']);
    if (g && k100 != null) {
      const f = g / 100;
      perServing = { calories: k100 * f, proteinG: (num(n.proteins_100g) ?? 0) * f, carbsG: (num(n.carbohydrates_100g) ?? 0) * f, fatG: (num(n.fat_100g) ?? 0) * f };
    }
  }
  const countries: string[] = Array.isArray(p?.countries_tags) ? p.countries_tags : [];
  return { db: 'off', brand, name, servingSize: typeof p?.serving_size === 'string' ? p.serving_size : null, perServing, canada: countries.includes('en:canada') };
}

const USDA_IDS = { calories: [1008, 2047, 2048], proteinG: [1003], carbsG: [1005], fatG: [1004] };
function usdaNutrient(food: any, ids: number[]): number | null {
  const list = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const hit = list.find((x: any) => ids.includes(x?.nutrientId) && Number.isFinite(x?.value));
  return hit ? Number(hit.value) : null;
}

/** One FDC Branded hit → candidate (FDC states branded values per 100 g/ml). Exported for tests. */
export function usdaCandidate(f: any): DbCandidate | null {
  const brand = [f?.brandName, f?.brandOwner].filter((x) => typeof x === 'string' && x.trim()).join(', ');
  const name = String(f?.description ?? '').trim();
  if (!brand || !name) return null;
  const size = num(f?.servingSize);
  const unit = String(f?.servingSizeUnit ?? '').toLowerCase();
  let perServing: DbCandidate['perServing'] = null;
  const k100 = usdaNutrient(f, USDA_IDS.calories);
  if (size && k100 != null && /^(g|grm|ml|mlt)$/.test(unit)) {
    const k = size / 100;
    perServing = { calories: k100 * k, proteinG: (usdaNutrient(f, USDA_IDS.proteinG) ?? 0) * k, carbsG: (usdaNutrient(f, USDA_IDS.carbsG) ?? 0) * k, fatG: (usdaNutrient(f, USDA_IDS.fatG) ?? 0) * k };
  }
  const serving = [f?.householdServingFullText, size ? `${size} ${unit.replace('grm', 'g').replace('mlt', 'ml')}` : null].filter(Boolean).join(' · ') || null;
  return { db: 'usda', brand, name, servingSize: serving, perServing, canada: false };
}

type Fetch = typeof fetch;

async function getJson(url: string, init: RequestInit, fetchImpl: Fetch): Promise<any | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

export async function searchOff(q: string, fetchImpl: Fetch = fetch): Promise<DbCandidate[] | null> {
  const url = `${OFF_SEARCH}?q=${encodeURIComponent(q)}&page_size=10&fields=product_name,brands,serving_size,serving_quantity,nutriments,countries_tags`;
  const j = await getJson(url, { headers: { 'User-Agent': UA } }, fetchImpl);
  if (!j) return null;
  return (Array.isArray(j.hits) ? j.hits : []).map(offCandidate).filter(Boolean) as DbCandidate[];
}

export async function searchUsdaBranded(q: string, fetchImpl: Fetch = fetch, apiKey = process.env.USDA_API_KEY ?? ''): Promise<DbCandidate[] | null> {
  if (!apiKey) return null;
  const j = await getJson(`${USDA_SEARCH}?api_key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, pageSize: 10, dataType: ['Branded'] }),
  }, fetchImpl);
  if (!j) return null;
  return (Array.isArray(j.foods) ? j.foods : []).map(usdaCandidate).filter(Boolean) as DbCandidate[];
}

export interface DbMatch { kind: 'found'; facts: BrandedFacts; db: 'off' | 'usda' }
export type DbOutcome = DbMatch | { kind: 'not_found'; reason: string; brandSeen: boolean } | { kind: 'unavailable'; reason: string; brandSeen: boolean };

/**
 * Pick the best same-brand candidate that names the product and has a
 * serving. Pure; exported for tests. `brandSeen` (the brand exists in a
 * database) feeds the web-search gate even when nothing matched.
 */
export function pickDbMatch(item: Pick<BrandedItem, 'brand' | 'product' | 'size'>, cands: DbCandidate[], preferCanada: boolean): DbOutcome {
  const sameBrand = cands.filter((c) => mentionsBrand(c.brand, item.brand) || mentionsBrand(c.name, item.brand));
  if (!sameBrand.length) return { kind: 'not_found', reason: 'no_brand_match', brandSeen: false };
  const scored = sameBrand
    .map((c) => ({ c, score: productRecall(item, c.name) + (preferCanada && c.canada ? 0.05 : 0) + (c.db === 'off' ? 0.01 : 0) }))
    .filter((x) => x.score >= 0.6 && x.c.perServing && addsUp(x.c.perServing))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.c;
  if (!best || !best.perServing) return { kind: 'not_found', reason: 'no_product_match', brandSeen: true };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kind: 'found', db: best.db,
    facts: {
      name: best.name.slice(0, 160), brand: best.brand.split(',')[0].trim().slice(0, 80), servingSize: best.servingSize,
      calories: Math.round(best.perServing.calories), proteinG: r1(best.perServing.proteinG), carbsG: r1(best.perServing.carbsG), fatG: r1(best.perServing.fatG),
      sources: [{ title: best.db === 'off' ? 'Open Food Facts' : 'USDA FoodData Central', uri: '' }],
    },
  };
}

/** Both databases in parallel, one outcome. */
export async function searchDatabases(
  item: Pick<BrandedItem, 'brand' | 'product' | 'size'>,
  opts: { preferCanada?: boolean; fetchImpl?: Fetch } = {},
): Promise<DbOutcome> {
  const q = `${item.brand} ${item.product}`.trim();
  const [off, usda] = await Promise.all([searchOff(q, opts.fetchImpl), searchUsdaBranded(q, opts.fetchImpl)]);
  if (off == null && usda == null) return { kind: 'unavailable', reason: 'databases_down', brandSeen: false };
  return pickDbMatch(item, [...(off ?? []), ...(usda ?? [])], !!opts.preferCanada);
}
