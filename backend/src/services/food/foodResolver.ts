// Where a typed branded item's numbers come from — checked cheapest and most
// trustworthy first, stopping at the first confident answer:
//
//   1. history   — the user's own barcode scans of that product
//   2. records   — products we've already verified (a scanned label, or an
//                  earlier database/web match, shared across users)
//   3. database  — Open Food Facts + USDA Branded Foods, by name (~0.5 s)
//   4. web       — grounded search, ONLY when the gate says it's worth it
//   5. estimate  — the parser's own number, labelled as an estimate
//
// The web gate is what keeps search from firing on vague text: the brand has
// to be a known chain or exist in a food database, the product has to be
// specific (a flavour, a menu item — not just "protein bar"), and the item has
// to matter (≥100 kcal) — unless the user asked us to look it up.
//
// Every decision is appended to .runtime/food-lookups.jsonl so we can see
// which step answered, how long it took, and what it cost.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { brandedCacheKey, lookupBranded, mentionsBrand, type BrandedFacts, type BrandedItem, type BrandedLookup } from './brandedLookup.js';
import { norm, productRecall, searchDatabases, type DbOutcome } from './nameSearch.js';

const prisma = new PrismaClient();

export type ResolveStep = 'history' | 'records' | 'database' | 'web' | 'estimate';

export interface ResolveEvent { item: number; brand: string; phase: ResolveStep; state: 'checking' | 'found' | 'missed' | 'skipped'; text: string }

export interface ResolvedItem {
  result: BrandedLookup;
  step: ResolveStep;
  /** Why the web was or wasn't used — for the log and for tests. */
  web: 'used' | 'not_needed' | 'gated';
  gateReason?: string;
  ms: number;
}

// ── The gate ────────────────────────────────────────────────────────────────

/** Chains that publish nutrition for their menus (US + Canada). Normalized names. */
export const KNOWN_CHAINS = new Set([
  'starbucks', 'tim hortons', 'tims', 'mcdonalds', 'mcdonald s', 'burger king', 'wendys', 'wendy s', 'subway', 'chipotle',
  'chick fil a', 'taco bell', 'kfc', 'popeyes', 'a and w', 'a w', 'harveys', 'mary browns', 'pizza pizza', 'pizza hut',
  'dominos', 'domino s', 'papa johns', 'little caesars', 'five guys', 'shake shack', 'in n out', 'panera', 'panera bread',
  'dunkin', 'dunkin donuts', 'second cup', 'booster juice', 'jamba', 'smoothie king', 'freshii', 'osmows', 'osmow s',
  'mr sub', 'quiznos', 'jersey mikes', 'firehouse subs', 'jimmy johns', 'arbys', 'sonic', 'dairy queen', 'culvers',
  'whataburger', 'carls jr', 'hardees', 'jack in the box', 'del taco', 'qdoba', 'moes', 'sweetgreen', 'cava', 'noodles and company',
  'panda express', 'pf changs', 'olive garden', 'red lobster', 'applebees', 'chilis', 'ihop', 'dennys', 'cracker barrel',
  'the keg', 'boston pizza', 'east side marios', 'swiss chalet', 'st hubert', 'montanas', 'kelseys', 'earls', 'cactus club',
  'joeys', 'milestones', 'white spot', 'triple o s', 'fatburger', 'nandos', 'pita pit', 'mucho burrito', 'barburrito', 'quesada',
  'manchu wok', 'thai express', 'sushi shop', 'costco', 'costco food court', 'ikea', 'krispy kreme', 'cinnabon',
  'auntie annes', 'pret a manger', 'pret', 'greggs', 'leon', 'itsu', 'wasabi', 'nandos', 'dutch bros', 'peets', 'caribou coffee',
  'blenz', 'balzacs', 'dave s hot chicken', 'daves hot chicken', 'raising canes', 'wingstop', 'zaxbys', 'bojangles', 'el pollo loco',
]);

export function isKnownChain(brand: string): boolean {
  const b = norm(brand).replace(/\b(restaurant|restaurants|coffee|canada|usa|inc|co)\b/g, '').replace(/\s+/g, ' ').trim();
  return KNOWN_CHAINS.has(b) || KNOWN_CHAINS.has(b.replace(/ /g, ''));
}

/** Words that name a category, not a product ("protein bar", "iced coffee"). */
const GENERIC = new Set([
  'protein', 'bar', 'bars', 'drink', 'drinks', 'shake', 'shakes', 'smoothie', 'coffee', 'tea', 'latte', 'iced', 'hot', 'cold',
  'chips', 'crisps', 'cookie', 'cookies', 'cracker', 'crackers', 'snack', 'snacks', 'candy',
  'any', 'some', 'flavor', 'flavour', 'flavors', 'flavours', 'unknown', 'unspecified', 'kind', 'type', 'variety', 'assorted',
  'yogurt', 'yoghurt', 'cereal', 'granola', 'powder', 'scoop', 'sandwich', 'burger', 'wrap', 'bowl', 'salad', 'pizza', 'fries',
  'meal', 'combo', 'item', 'food', 'one', 'small', 'medium', 'large', 'regular', 'piece', 'pieces', 'pack', 'bag', 'bottle', 'can',
]);

/**
 * The product name without asides: "Protein Drink (any flavor, e.g., Caramel
 * Cashew, Chocolate)" → "Protein Drink". The parser lists example flavours in
 * brackets; they aren't the one the user had. (Logged a vague drink as
 * specific on 9 Oct 2026.)
 */
export function coreProduct(product: string): string {
  return product
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(e\.?\s?g\.?|such as|like|for example)\b.*$/i, ' ')
    .replace(/,\s*(any|some|unknown|unspecified)\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does the product name pin down one product? Chains: any menu name does. Packaged: needs a flavour/variant word or a size. */
export function isSpecific(item: Pick<BrandedItem, 'brand' | 'product' | 'size'>): boolean {
  const brandWords = new Set(norm(item.brand).split(' '));
  const words = norm(coreProduct(item.product)).split(' ').filter((w) => w && !brandWords.has(w));
  if (!words.length) return false;
  if (isKnownChain(item.brand)) return true;
  // A size alone ("330 ml") doesn't say which flavour — the parser often adds one.
  return words.some((w) => !GENERIC.has(w));
}

/**
 * A match far from the estimate is more likely a wrong product (a bulk pack,
 * a different item) than a bad estimate: eval 9 Oct 2026 matched a Starbucks
 * grande latte to a 3,888 kcal retail product. Pure.
 */
export function plausible(item: BrandedItem, facts: BrandedFacts): boolean {
  const est = item.estimate.calories;
  const got = facts.calories * (item.servings || 1);
  if (est < 50 || got < 50) return true;
  const ratio = got / est;
  return ratio >= 0.4 && ratio <= 2.5;
}

export function webGate(item: BrandedItem, ctx: { explicit?: boolean; brandSeen: boolean }): { allowed: boolean; reason: string } {
  if (ctx.explicit) return { allowed: true, reason: 'asked' };
  if (!isSpecific(item)) return { allowed: false, reason: 'not_specific' };
  if (item.estimate.calories * (item.servings || 1) < 100) return { allowed: false, reason: 'small_item' };
  if (isKnownChain(item.brand)) return { allowed: true, reason: 'chain' };
  if (ctx.brandSeen) return { allowed: true, reason: 'brand_in_database' };
  return { allowed: false, reason: 'unknown_brand' };
}

/**
 * Should chat ask before logging? A named brand whose product is too vague to
 * look up, worth ≥100 kcal. Returns the question, or null. Pure.
 */
export function clarifyQuestion(item: BrandedItem): string | null {
  if (isSpecific(item)) return null;
  if (item.estimate.calories * (item.servings || 1) < 100) return null;
  const brandWords = new Set(norm(item.brand).split(' '));
  const rest = norm(coreProduct(item.product)).split(' ').filter((w) => w && !brandWords.has(w) && !['any', 'some', 'flavor', 'flavour', 'unknown', 'unspecified'].includes(w)).join(' ');
  const what = rest ? ` ${rest}` : '';
  return isKnownChain(item.brand)
    ? `Which ${item.brand} item was it?`
    : `Which ${item.brand}${what} was it — the flavour or exact name?`;
}

// ── Records: verified results shared across users, kept on disk ─────────────

const STORE_FILE = process.env.FOOD_RECORDS_PATH || join(process.cwd(), '.runtime', 'food-records.json');
const LOG_FILE = process.env.FOOD_LOOKUP_LOG_PATH || join(process.cwd(), '.runtime', 'food-lookups.jsonl');
type StoredRecord = { facts: BrandedFacts; step: ResolveStep; at: string };
let store: Map<string, StoredRecord> | null = null;
let saveTimer: NodeJS.Timeout | null = null;

async function loadStore(): Promise<Map<string, StoredRecord>> {
  if (store) return store;
  try { store = new Map(Object.entries(JSON.parse(await readFile(STORE_FILE, 'utf8')))); } catch { store = new Map(); }
  return store;
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { await mkdir(dirname(STORE_FILE), { recursive: true }); await writeFile(STORE_FILE, JSON.stringify(Object.fromEntries(store ?? []))); } catch { /* best effort */ }
  }, 1000);
  saveTimer.unref?.();
}
export function _resetFoodRecordsForTests() { store = new Map(); }

/** Menus differ by country, not by zone: key records on the zone's country group. */
export function countryKey(tz?: string | null): string {
  if (!tz) return '';
  if (/^America\/(Toronto|Edmonton|Vancouver|Winnipeg|Halifax|Regina|St_Johns|Moncton|Montreal|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay)/.test(tz)) return 'CA';
  if (/^(America|Pacific\/Honolulu|US\/)/.test(tz)) return 'US';
  return tz.split('/')[0];
}

async function fromRecords(item: BrandedItem, tz?: string | null): Promise<BrandedFacts | null> {
  const s = await loadStore();
  const hit = s.get(brandedCacheKey(item, countryKey(tz)));
  if (hit) return hit.facts;
  // Scanned labels: ProductBarcode rows (per 100 g + serving weight).
  try {
    const rows = await prisma.productBarcode.findMany({ where: { servingQuantityG: { not: null } }, take: 400, orderBy: { scanCount: 'desc' } });
    const row = rows.find((r) => r.brand && mentionsBrand(`${r.brand} ${r.name}`, item.brand) && productRecall(item, r.name) >= 0.7);
    if (row && row.servingQuantityG) {
      const f = row.servingQuantityG / 100;
      return { name: row.name, brand: row.brand ?? item.brand, servingSize: row.servingSize, calories: Math.round(row.caloriesPer100g * f), proteinG: Math.round(row.proteinG * f * 10) / 10, carbsG: Math.round(row.carbsG * f * 10) / 10, fatG: Math.round(row.fatG * f * 10) / 10, sources: [{ title: 'a scanned label', uri: '' }] };
    }
  } catch { /* table unavailable */ }
  return null;
}

async function remember(item: BrandedItem, tz: string | null | undefined, facts: BrandedFacts, step: ResolveStep) {
  const s = await loadStore();
  s.set(brandedCacheKey(item, countryKey(tz)), { facts, step, at: new Date().toISOString() });
  scheduleSave();
}

/** The user's own barcode scans of this product, newest first. One scan = one serving. */
async function fromHistory(userId: string, item: BrandedItem): Promise<BrandedFacts | null> {
  const since = new Date(Date.now() - 365 * 86_400_000);
  const rows = await prisma.mealEntry.findMany({
    where: { userId, source: 'barcode', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' }, take: 200,
    select: { name: true, date: true, calories: true, proteinG: true, carbsG: true, fatG: true },
  }).catch(() => []);
  const row = rows.find((r) => mentionsBrand(r.name, item.brand) && productRecall(item, r.name) >= 0.7);
  if (!row) return null;
  const day = new Date(`${row.date}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { name: row.name, brand: item.brand, servingSize: null, calories: Math.round(row.calories), proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG, sources: [{ title: `your scan on ${day}`, uri: '' }] };
}

// ── The ladder ──────────────────────────────────────────────────────────────

export interface ResolverDeps {
  history: (userId: string, item: BrandedItem) => Promise<BrandedFacts | null>;
  records: (item: BrandedItem, tz?: string | null) => Promise<BrandedFacts | null>;
  database: (item: BrandedItem, tz?: string | null) => Promise<DbOutcome>;
  web: (item: BrandedItem, tz?: string | null) => Promise<BrandedLookup>;
  remember: (item: BrandedItem, tz: string | null | undefined, facts: BrandedFacts, step: ResolveStep) => Promise<void>;
  log: (entry: Record<string, unknown>) => void;
}

const defaultDeps: ResolverDeps = {
  history: fromHistory,
  records: fromRecords,
  database: (item, tz) => searchDatabases(item, { preferCanada: countryKey(tz) === 'CA' }),
  web: (item, tz) => lookupBranded(item, { tz }),
  remember,
  log: (entry) => {
    console.log(`[food-lookup] ${JSON.stringify(entry)}`);
    mkdir(dirname(LOG_FILE), { recursive: true }).then(() => appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`)).catch(() => {});
  },
};

export interface ResolveCtx {
  userId?: string | null;
  tz?: string | null;
  surface: 'chat' | 'describe' | 'lookup' | 'api';
  explicit?: boolean;
  onEvent?: (e: ResolveEvent) => void;
  deps?: Partial<ResolverDeps>;
}

const found = (facts: BrandedFacts): BrandedLookup => ({ kind: 'found', facts });

export async function resolveItem(item: BrandedItem, index: number, ctx: ResolveCtx): Promise<ResolvedItem> {
  const d = { ...defaultDeps, ...(ctx.deps ?? {}) };
  const t0 = Date.now();
  const emit = (phase: ResolveStep, state: ResolveEvent['state'], text: string) => ctx.onEvent?.({ item: index, brand: item.brand, phase, state, text });
  const what = [item.brand, item.product].join(' ');
  const done = (r: ResolvedItem) => {
    d.log({ at: new Date().toISOString(), userId: ctx.userId ?? null, surface: ctx.surface, brand: item.brand, product: item.product, size: item.size, step: r.step, kind: r.result.kind, reason: r.result.kind === 'found' ? null : r.result.reason, web: r.web, gate: r.gateReason ?? null, ms: r.ms, webCalls: r.web === 'used' ? 1 : 0 });
    return r;
  };

  if (ctx.userId) {
    emit('history', 'checking', `${what} — your past scans`);
    const h = await d.history(ctx.userId, item).catch(() => null);
    if (h && plausible(item, h)) { emit('history', 'found', `${what} — from ${h.sources[0]?.title}`); return done({ result: found(h), step: 'history', web: 'not_needed', ms: Date.now() - t0 }); }
  }
  const rec = await d.records(item, ctx.tz).catch(() => null);
  if (rec && plausible(item, rec)) { emit('records', 'found', `${what} — already verified`); return done({ result: found(rec), step: 'records', web: 'not_needed', ms: Date.now() - t0 }); }

  // Food databases hold chains' grocery products (bottled Frappuccino), not
  // their menu items — so a chain's menu item skips straight to the web gate.
  const chain = isKnownChain(item.brand);
  if (!chain) emit('database', 'checking', `${what} — food databases`);
  const db: DbOutcome = chain
    ? { kind: 'not_found', reason: 'chain_menu_item', brandSeen: true }
    : await d.database(item, ctx.tz).then((r) => (r.kind === 'found' && !plausible(item, r.facts) ? { kind: 'not_found' as const, reason: 'implausible', brandSeen: true } : r)).catch((): DbOutcome => ({ kind: 'unavailable', reason: 'error', brandSeen: false }));
  if (db.kind === 'found') {
    emit('database', 'found', `${what} — from ${db.facts.sources[0]?.title}`);
    void d.remember(item, ctx.tz, db.facts, 'database');
    return done({ result: found(db.facts), step: 'database', web: 'not_needed', ms: Date.now() - t0 });
  }

  const gate = webGate(item, { explicit: ctx.explicit, brandSeen: db.brandSeen });
  if (!gate.allowed) {
    emit('estimate', 'skipped', `${what} — not in food databases, estimated`);
    return done({ result: { kind: 'not_found', reason: `gated:${gate.reason}` }, step: 'estimate', web: 'gated', gateReason: gate.reason, ms: Date.now() - t0 });
  }
  emit('web', 'checking', `${what} — searching the web`);
  const w0 = await d.web(item, ctx.tz).catch((): BrandedLookup => ({ kind: 'unavailable', reason: 'error' }));
  const w: BrandedLookup = w0.kind === 'found' && !plausible(item, w0.facts) ? { kind: 'not_found', reason: 'implausible' } : w0;
  if (w.kind === 'found') {
    emit('web', 'found', `${what} — from ${w.facts.sources[0]?.title ?? 'the web'}`);
    void d.remember(item, ctx.tz, w.facts, 'web');
    return done({ result: w, step: 'web', web: 'used', gateReason: gate.reason, ms: Date.now() - t0 });
  }
  emit('estimate', 'missed', `${what} — not published, estimated`);
  return done({ result: w, step: 'estimate', web: 'used', gateReason: gate.reason, ms: Date.now() - t0 });
}

export async function resolveAll(items: BrandedItem[], ctx: ResolveCtx): Promise<ResolvedItem[]> {
  return Promise.all(items.map((it, i) => resolveItem(it, i, ctx)));
}

/** "look it up", "search for it", or a pasted link — the user asked for a search. */
export function asksForLookup(text: string): boolean {
  return /\b(look (it |this |that )?up|search (for )?(it|this|that)|google (it|this|that)|check online)\b/i.test(text) || /https?:\/\//i.test(text);
}
