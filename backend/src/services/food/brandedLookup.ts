// Web lookup for branded and restaurant foods a user TYPED ("Starbucks grande
// iced sugar-free caramel protein latte"), in chat or Fuel's describe box.
//
// The meal parser estimates every item from memory. For a generic food that
// is fine; for a branded drink or a chain's menu item the real numbers are
// published, so we look them up instead: Gemini with Google Search grounding
// finds the brand's nutrition page and reads the values for that item.
//
// Same rules as the barcode lookup (webFoodLookup.ts), adapted to names:
//   - the answer must be grounded in at least one cited source,
//   - it must be the exact product from that brand, in the size asked for —
//     a sibling product or a different size is not a match,
//   - the values are per serving as sold (or per 100 g with a serving weight),
//   - protein, carbs and fat must roughly add up to the calories.
// Anything that fails stays an estimate, labelled as one. A lookup never
// blocks logging: it has a time budget and falls back to the estimate.
//
// Temperature stays at the Gemini 3 default (lowering it loops/degrades).

import { GoogleGenAI } from '@google/genai';
import { LruCache } from './mealPhotoCache.js';
// Not imported from webFoodLookup.ts: that module builds its schema with the
// SDK's Type enum at load time, and this one is loaded by llmService.ts, which
// many test suites import with a minimal @google/genai mock.
const WEB_FOOD_MODEL = process.env.WEB_FOOD_SEARCH_MODEL || 'gemini-3-flash-preview';

export interface WebSource { title: string | null; uri: string }

export function sourcesFrom(response: any): WebSource[] {
  const chunks: any[] = response?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const out: WebSource[] = [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri;
    if (typeof uri === 'string' && uri) out.push({ title: typeof ch.web.title === 'string' ? ch.web.title : null, uri });
  }
  return out;
}

/** A named-brand item the meal parser found, with its own estimate. */
export interface BrandedItem {
  brand: string;
  product: string;
  size: string | null;
  servings: number;
  /** The parser's estimate for this item (already inside the meal totals). */
  estimate: { calories: number; proteinG: number; carbsG: number; fatG: number };
}

/** Label micronutrients for one serving — only what the source states (keys as Micronutrients). */
export type LabelMicros = Partial<Record<'fiberG' | 'sugarG' | 'sodiumMg' | 'saturatedFatG' | 'cholesterolMg' | 'vitaminAIU' | 'vitaminCMg' | 'vitaminDIU' | 'vitaminEMg' | 'vitaminB12Mcg' | 'folateMcg' | 'ironMg' | 'calciumMg' | 'magnesiumMg' | 'zincMg' | 'potassiumMg' | 'omega3G' | 'omega6G', number>>;

export interface BrandedFacts {
  name: string;
  brand: string;
  servingSize: string | null;
  /** Per one serving as sold. */
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  micros?: LabelMicros;
  sources: WebSource[];
}

export type BrandedLookup =
  | { kind: 'found'; facts: BrandedFacts }
  | { kind: 'not_found'; reason: string }
  | { kind: 'unavailable'; reason: string };

/** What the meal ended up using for one branded item — shown to the user. */
export interface ItemLookupResult {
  brand: string;
  product: string;
  size: string | null;
  status: 'found' | 'estimated';
  /** Which check answered: your scans, verified records, a food database, the web — or an estimate. */
  step?: 'history' | 'records' | 'database' | 'web' | 'estimate';
  /** Domain of the first source, e.g. "starbucks.ca", when found. */
  sourceDomain: string | null;
  sourceUrl: string | null;
  calories: number;
}

export const TEXT_LOOKUP_ENABLED = () => process.env.WEB_FOOD_TEXT_LOOKUP !== '0';
// Measured 9 Oct 2026: grounded lookups take 11–33 s (median ~23 s).
const DEFAULT_BUDGET_MS = Number(process.env.WEB_FOOD_TEXT_LOOKUP_BUDGET_MS) || 40_000;
const MAX_ITEMS = 3;

export const BRANDED_ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    name: { type: 'STRING', nullable: true, description: 'Product name exactly as the source lists it' },
    brand: { type: 'STRING', nullable: true },
    basis: { type: 'STRING', nullable: true, description: "'per_serving' (as sold) or 'per_100g'" },
    servingSize: { type: 'STRING', nullable: true, description: 'Serving/size text as the source prints it, e.g. "Grande (16 fl oz)"' },
    servingGrams: { type: 'NUMBER', nullable: true },
    sizeMatches: { type: 'BOOLEAN', nullable: true, description: 'true if these values are for the size that was asked for' },
    fiberG: { type: 'NUMBER', nullable: true }, sugarG: { type: 'NUMBER', nullable: true }, saturatedFatG: { type: 'NUMBER', nullable: true },
    sodiumMg: { type: 'NUMBER', nullable: true }, cholesterolMg: { type: 'NUMBER', nullable: true }, potassiumMg: { type: 'NUMBER', nullable: true },
    calciumMg: { type: 'NUMBER', nullable: true }, ironMg: { type: 'NUMBER', nullable: true },
    calories: { type: 'NUMBER', nullable: true },
    proteinG: { type: 'NUMBER', nullable: true },
    carbsG: { type: 'NUMBER', nullable: true },
    fatG: { type: 'NUMBER', nullable: true },
  },
  required: ['found'],
  propertyOrdering: ['found', 'name', 'brand', 'basis', 'servingSize', 'servingGrams', 'calories', 'proteinG', 'carbsG', 'fatG'],
};

export function buildBrandedPrompt(item: Pick<BrandedItem, 'brand' | 'product' | 'size'>, tz?: string | null): string {
  const what = [item.brand, item.product, item.size ? `(size: ${item.size})` : ''].filter(Boolean).join(' ');
  const where = tz ? `\nThe user's time zone is ${tz}; use that country's menu or label if it differs between countries.` : '';
  return `Use Google Search to find the official nutrition facts for this item: ${what}.${where}

Rules:
- Prefer the brand's own nutrition page or menu; a major nutrition database listing for this exact item is acceptable.
- Only report it if the source is clearly this exact product from ${item.brand}. A different product, flavour or variant of the same brand is NOT a match — set found=false.
${item.size ? `- The values must be for the ${item.size} size; set sizeMatches=true when they are. If the source only lists a different size, set found=false.\n` : ''}- Report the values exactly as the source states them. Do not estimate or fill gaps from general knowledge. Fibre, sugar, saturated fat, sodium, cholesterol, potassium, calcium and iron: only when the source lists them (mg for minerals), else null.
- basis: "per_serving" for values per item/serving as sold (servingSize as printed), or "per_100g" with servingGrams.
- If you are not certain, set found=false.`;
}

const WEAK_SOURCE = /\b(facebook|instagram|tiktok|reddit|youtube|pinterest|twitter|x\.com|threads|quora|scribd)\b/i;

const MENU_SIZES = ['extra large', 'x large', 'kids', 'short', 'tall', 'grande', 'venti', 'trenta', 'small', 'medium', 'large', 'regular', 'junior', 'footlong', '6 inch', 'single', 'double', 'triple'];
/** The menu size named in `size`, normalized ("Grande (16 fl oz)" → "grande"), else null. */
export function menuSize(size: string | null | undefined): string | null {
  if (!size) return null;
  const n = ` ${norm(size).replace(/\bxl\b/, 'x large').replace(/\bfoot long\b/, 'footlong').replace(/\b6 in\b/, '6 inch')} `;
  return MENU_SIZES.find((w) => n.includes(` ${w} `)) ?? null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Does `text` name `brand`? Tolerates "Starbucks Coffee", "Tim Hortons®", "Tims". */
export function mentionsBrand(text: string, brand: string): boolean {
  const t = ` ${norm(text)} `;
  const b = norm(brand);
  if (!b) return false;
  if (t.includes(` ${b} `)) return true;
  // First significant word of the brand ("tim" of "tim hortons" is too short to trust alone).
  const word = b.split(' ').find((w) => w.length >= 4);
  return !!word && t.includes(` ${word}`);
}

/** Checks + per-serving values. Pure; exported for tests. */
export function validateBrandedAnswer(raw: any, sources: WebSource[], item: Pick<BrandedItem, 'brand' | 'size'>): BrandedLookup {
  if (!raw || raw.found !== true) return { kind: 'not_found', reason: 'model_not_found' };
  if (!sources.length) return { kind: 'not_found', reason: 'ungrounded' };
  // A Facebook post or a shared PDF isn't a nutrition source; at least one cited page must be.
  if (sources.every((s) => WEAK_SOURCE.test(`${s.title ?? ''} ${domainOf(s.uri) ?? ''}`))) return { kind: 'not_found', reason: 'weak_source' };
  const name = String(raw.name ?? '').trim();
  if (!name) return { kind: 'not_found', reason: 'no_name' };

  const brandText = `${raw.brand ?? ''} ${name} ${sources.map((s) => `${s.title ?? ''} ${s.uri}`).join(' ')}`;
  if (!mentionsBrand(brandText, item.brand)) return { kind: 'not_found', reason: 'brand_mismatch' };

  const servingSize = typeof raw.servingSize === 'string' && raw.servingSize.trim() ? raw.servingSize.trim().slice(0, 80) : null;
  // Only menu sizes are checked ("grande", "medium", "footlong") — the parser
  // also puts "sandwich" or "14 fl oz" in size, which a label won't echo.
  const sizeWord = menuSize(item.size);
  if (sizeWord && raw.sizeMatches !== true) {
    const sized = norm(`${servingSize ?? ''} ${name}`);
    if (!sized.includes(sizeWord)) return { kind: 'not_found', reason: 'size_mismatch' };
  }

  let kcal = num(raw.calories);
  if (kcal == null) return { kind: 'not_found', reason: 'no_calories' };
  let p = num(raw.proteinG) ?? 0, c = num(raw.carbsG) ?? 0, f = num(raw.fatG) ?? 0;

  if (raw.basis === 'per_100g') {
    const g = num(raw.servingGrams);
    if (!g) return { kind: 'not_found', reason: 'no_serving_weight' };
    const k = g / 100;
    kcal *= k; p *= k; c *= k; f *= k;
  }

  // Zero-calorie drinks are real (black coffee); otherwise the macros must add up.
  const fromMacros = 4 * p + 4 * c + 9 * f;
  if (kcal > 0 && fromMacros > 0 && Math.abs(fromMacros - kcal) / kcal > 0.35) return { kind: 'not_found', reason: 'macros_mismatch' };
  if (kcal === 0 && fromMacros > 20) return { kind: 'not_found', reason: 'macros_mismatch' };
  if (kcal > 3000) return { kind: 'not_found', reason: 'implausible' };

  const r1 = (x: number) => Math.round(x * 10) / 10;
  const k = raw.basis === 'per_100g' ? (num(raw.servingGrams) ?? 100) / 100 : 1;
  const micros: LabelMicros = {};
  for (const key of ['fiberG', 'sugarG', 'saturatedFatG', 'sodiumMg', 'cholesterolMg', 'potassiumMg', 'calciumMg', 'ironMg'] as const) {
    const v = num(raw[key]);
    if (v != null) micros[key] = r1(v * k);
  }
  return {
    kind: 'found',
    facts: {
      micros,
      name: name.slice(0, 160),
      brand: String(raw.brand ?? item.brand).trim().slice(0, 80) || item.brand,
      servingSize,
      calories: Math.round(kcal),
      proteinG: r1(p),
      carbsG: r1(c),
      fatG: r1(f),
      sources: sources.slice(0, 3),
    },
  };
}

type Generate = (args: { model: string; contents: string; config: any }) => Promise<any>;

let client: GoogleGenAI | null = null;
function defaultGenerate(): Generate {
  client ??= new GoogleGenAI({
    vertexai: true,
    project: process.env.GCP_PROJECT_NUMBER ?? '656267185967',
    location: process.env.GCP_LOCATION ?? 'global',
  });
  return (args) => client!.models.generateContent(args);
}

// Found items keep for a week (menus change slowly); misses for a day so a
// retry tomorrow can succeed. Outages are never cached.
const FOUND_TTL = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL = 24 * 60 * 60 * 1000;
const found = new LruCache<BrandedLookup>(1000, FOUND_TTL);
const missed = new LruCache<BrandedLookup>(1000, MISS_TTL);

export function brandedCacheKey(item: Pick<BrandedItem, 'brand' | 'product' | 'size'>, tz?: string | null): string {
  // Country-level menus differ, so the zone's region ("America", "Europe"…) isn't enough;
  // the full zone is cheap and safe.
  return [norm(item.brand), norm(item.product), norm(item.size ?? ''), tz ?? ''].join('|');
}

export function _resetBrandedCache(): void { found.clear(); missed.clear(); }

export async function lookupBranded(
  item: Pick<BrandedItem, 'brand' | 'product' | 'size'>,
  opts: { tz?: string | null; generate?: Generate; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<BrandedLookup> {
  const key = brandedCacheKey(item, opts.tz);
  const hit = found.get(key) ?? missed.get(key);
  if (hit) return hit;
  const generate = opts.generate ?? defaultGenerate();
  let response: any;
  try {
    response = await Promise.race([
      generate({
        model: WEB_FOOD_MODEL,
        contents: buildBrandedPrompt(item, opts.tz),
        config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json', responseSchema: BRANDED_ANSWER_SCHEMA },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), opts.timeoutMs ?? DEFAULT_BUDGET_MS)),
    ]);
  } catch (err: any) {
    return { kind: 'unavailable', reason: err?.message === 'timeout' ? 'timeout' : 'model_error' };
  }
  let raw: any = null;
  try { raw = JSON.parse(String(response?.text ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()); } catch { raw = null; }
  let result = validateBrandedAnswer(raw, sourcesFrom(response), item);
  if (result.kind === 'found') result = { kind: 'found', facts: { ...result.facts, sources: await resolveSources(result.facts.sources, opts.fetchImpl) } };
  (result.kind === 'found' ? found : missed).set(key, result);
  return result;
}

/**
 * Grounding links are short-lived Vertex redirects. Follow each once to the
 * real page so the app can open it (and it still works next week).
 * A link that won't resolve is dropped, never shown as a dead redirect.
 */
export async function resolveSources(sources: WebSource[], fetchImpl: typeof fetch = fetch): Promise<WebSource[]> {
  return Promise.all(sources.map(async (s) => {
    if (!/vertexaisearch\.cloud\.google\.com/.test(s.uri)) return s;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    try {
      const r = await fetchImpl(s.uri, { method: 'GET', redirect: 'manual', signal: ac.signal });
      const loc = r.headers.get('location');
      return { ...s, uri: loc && /^https?:\/\//.test(loc) && !/vertexaisearch/.test(loc) ? loc : '' };
    } catch { return { ...s, uri: '' }; } finally { clearTimeout(t); }
  }));
}

export function domainOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const host = new URL(uri).hostname.replace(/^www\./, '');
    // Grounding links come through a Vertex redirect; the page title carries the real site.
    return host.includes('vertexaisearch') ? null : host;
  } catch { return null; }
}

/** "starbucks.ca" from a source: the URL's host, else a domain-looking title. */
export function sourceLabel(s: WebSource | undefined): string | null {
  if (!s) return null;
  // The title names the source as people know it ("starbucks.ca", "Open Food
  // Facts"); the link's host ("world.openfoodfacts.org") is the fallback.
  const t = (s.title ?? '').trim();
  if (t) return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t) ? t.toLowerCase().replace(/^www\./, '') : t;
  return domainOf(s.uri);
}

export interface MacroTotals { calories: number; proteinG: number; carbsG: number; fatG: number }

/**
 * Swap each found item's estimate for its looked-up values (× servings) in
 * the meal totals. Pure; exported for tests. Totals never go below zero.
 */
export function applyBrandedLookups(
  totals: MacroTotals,
  items: BrandedItem[],
  results: BrandedLookup[],
  steps: Array<ItemLookupResult['step']> = [],
): { totals: MacroTotals; lookups: ItemLookupResult[] } {
  const out = { ...totals };
  const lookups: ItemLookupResult[] = [];
  items.forEach((item, i) => {
    const r = results[i];
    if (r?.kind === 'found') {
      const k = item.servings > 0 ? item.servings : 1;
      out.calories += r.facts.calories * k - item.estimate.calories;
      out.proteinG += r.facts.proteinG * k - item.estimate.proteinG;
      out.carbsG += r.facts.carbsG * k - item.estimate.carbsG;
      out.fatG += r.facts.fatG * k - item.estimate.fatG;
      lookups.push({ brand: item.brand, product: item.product, size: item.size, status: 'found', ...(steps[i] ? { step: steps[i] } : {}), sourceDomain: sourceLabel(r.facts.sources[0]), sourceUrl: domainOf(r.facts.sources[0]?.uri) ? r.facts.sources[0].uri : null, calories: Math.round(r.facts.calories * k) });
    } else {
      lookups.push({ brand: item.brand, product: item.product, size: item.size, status: 'estimated', step: 'estimate', sourceDomain: null, sourceUrl: null, calories: Math.round(item.estimate.calories) });
    }
  });
  const r1 = (x: number) => Math.max(0, Math.round(x * 10) / 10);
  return { totals: { calories: Math.max(0, Math.round(out.calories)), proteinG: r1(out.proteinG), carbsG: r1(out.carbsG), fatG: r1(out.fatG) }, lookups };
}

const LABEL_KEYS = ['fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'cholesterolMg', 'vitaminAIU', 'vitaminCMg', 'vitaminDIU', 'vitaminEMg', 'vitaminB12Mcg', 'folateMcg', 'ironMg', 'calciumMg', 'magnesiumMg', 'zincMg', 'potassiumMg', 'omega3G', 'omega6G'] as const;

/**
 * Micronutrients for a meal after lookups. Each found item's share of the
 * whole-meal estimate (by calories) is replaced: by the label's value where
 * the source states one, otherwise rescaled to the item's real calories.
 * Never below zero. Pure; exported for tests.
 */
export function applyLabelMicros(
  meal: { calories: number; nutrients: Record<string, any>; nutrientMap?: Record<string, number> },
  items: BrandedItem[],
  results: BrandedLookup[],
): { nutrients: Record<string, any>; nutrientMap: Record<string, number>; fromLabel: string[] } {
  const nutrients: Record<string, any> = { ...meal.nutrients };
  const fromLabel = new Set<string>();
  const total = meal.calories > 0 ? meal.calories : 0;
  items.forEach((item, i) => {
    const r = results[i];
    if (r?.kind !== 'found') return;
    const k = item.servings > 0 ? item.servings : 1;
    const share = total > 0 ? Math.min(1, item.estimate.calories / total) : 1;
    const scale = item.estimate.calories > 0 ? (r.facts.calories * k) / item.estimate.calories : 1;
    for (const key of LABEL_KEYS) {
      const cur = typeof nutrients[key] === 'number' && Number.isFinite(nutrients[key]) ? nutrients[key] : 0;
      const part = cur * share;
      const label = r.facts.micros?.[key];
      const next = label != null ? cur - part + label * k : cur - part + part * scale;
      if (label != null) fromLabel.add(key);
      nutrients[key] = Math.max(0, Math.round(next * 10) / 10);
    }
  });
  const nutrientMap: Record<string, number> = { ...(meal.nutrientMap ?? {}) };
  for (const key of LABEL_KEYS) {
    const v = nutrients[key];
    if (typeof v === 'number' && v > 0) nutrientMap[key] = v; else delete nutrientMap[key];
  }
  return { nutrients, nutrientMap, fromLabel: [...fromLabel] };
}

/** Coerce the parser's `branded` array. Pure; exported for tests. */
export function coerceBrandedItems(raw: unknown): BrandedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BrandedItem[] = [];
  for (const it of raw) {
    const brand = typeof it?.brand === 'string' ? it.brand.trim().slice(0, 80) : '';
    const product = typeof it?.product === 'string' ? it.product.trim().slice(0, 120) : '';
    if (!brand || !product) continue;
    const size = typeof it?.size === 'string' && it.size.trim() && it.size.trim().toLowerCase() !== 'null' ? it.size.trim().slice(0, 40) : null;
    const n = (v: unknown) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(x) && x >= 0 ? x : 0; };
    const servings = n(it?.servings) || 1;
    out.push({ brand, product, size, servings: Math.min(servings, 20), estimate: { calories: n(it?.calories), proteinG: n(it?.proteinG), carbsG: n(it?.carbsG), fatG: n(it?.fatG) } });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Look up every branded item in parallel, inside one time budget. */
export async function lookupAll(
  items: BrandedItem[],
  opts: { tz?: string | null; generate?: Generate; budgetMs?: number } = {},
): Promise<BrandedLookup[]> {
  return Promise.all(items.map((it) => lookupBranded(it, { tz: opts.tz, generate: opts.generate, timeoutMs: opts.budgetMs ?? DEFAULT_BUDGET_MS })));
}
