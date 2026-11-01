// Barcode scan → Portion sheet (handoff Nov 2026). One food, normalized once to
// per-gram values. `grams` is the single source of truth: a unit only changes how
// the amount is shown and stepped, and totals are computed, never edited. Rounding
// happens at display and in the log body, nowhere else. Pure — no React.

export type PortionUnitKey = 'g' | 'oz' | 'serving';
export interface PortionUnit { key: PortionUnitKey; label: string; tab: string; grams: number }

/** A barcode answer as the server sends it, kept verbatim so the next scan can start from it. */
export interface ScannedProduct {
  name?: string | null;
  brand?: string | null;
  per100g?: Record<string, unknown> | null;
  nutrients?: Record<string, unknown> | null;
  servingSize?: string | null;
  servingQuantityG?: number | null;
  servingSizeG?: number | null;
  servingGrams?: number | null;
  serving?: { grams?: number | null } | null;
  source?: string | null;
  originalSource?: string | null;
  yourFood?: { lastGrams?: number | null; lastLoggedAt?: string | null } | null;
  [k: string]: unknown;
}

export interface FoodBasis {
  barcode: string;
  name: string;
  brand: string | null;
  perGram: { kcal: number; proteinG: number; carbsG: number; fatG: number; nutrients: Record<string, number> };
  units: PortionUnit[];
  /** One label serving in grams, or null when the product only has per-100 g values. */
  servingGrams: number | null;
  /** "container", "bar", "serving". */
  servingWord: string;
  /** Where the numbers came from: printed on a label they read, or a food database. */
  fromLabel: boolean;
  sourceName: string;
  lastGrams: number | null;
  lastLoggedAt: string | null;
  product: ScannedProduct;
}

export interface PortionTotals { kcal: number; proteinG: number; carbsG: number; fatG: number; nutrients: Record<string, number> }

const OZ = 28.3495;
const MAX_GRAMS = 5000;
const MACRO_KEYS = new Set(['calories', 'kcal', 'proteinG', 'carbsG', 'fatG']);
const NOT_A_SERVING_WORD = /^(g|gr|gram|grams|kg|mg|ml|l|cl|oz|ounce|ounces|lb|tbsp|tsp|cup|cups|portion|serving|servings)$/i;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const finite = (v: unknown): number | null => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
const plural = (w: string) => (/(s|x|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "1 container (150 g)" → "container"; anything else, including "2 tbsp (32 g)", is a "serving". */
export function servingWordFrom(size: string | null | undefined): string {
  const m = String(size ?? '').trim().match(/^(?:(\d+(?:[.,]\d+)?|one|a|an)\s+)?([a-zA-Z][a-zA-Z-]{1,17})(?:\s*\(.*\))?$/i);
  if (!m) return 'serving';
  const qty = m[1];
  if (qty && /\d/.test(qty) && parseFloat(qty.replace(',', '.')) !== 1) return 'serving';
  const word = m[2].toLowerCase();
  return NOT_A_SERVING_WORD.test(word) ? 'serving' : word;
}

const SOURCE_NAMES: Record<string, string> = {
  openfoodfacts: 'Open Food Facts',
  community: 'Read from a label',
  user_label_scan: 'Read from a label',
  curated: 'Axiom',
  web: 'The web',
};

/** Any barcode answer (Open Food Facts, a label read, a web hit, Your foods) → the one model. */
export function basisFromProduct(p: ScannedProduct, barcode: string): FoodBasis {
  const per100 = (p.per100g ?? p) as Record<string, unknown>;
  const servingGrams = [p.servingQuantityG, p.servingSizeG, p.servingGrams, p.serving?.grams]
    .map(finite).find((g): g is number => g != null && g > 0) ?? null;
  const servingWord = servingWordFrom(p.servingSize);

  const nutrients: Record<string, number> = {};
  for (const src of [p.nutrients, per100] as (Record<string, unknown> | null | undefined)[]) {
    for (const [k, v] of Object.entries(src ?? {})) {
      const n = finite(v);
      if (!MACRO_KEYS.has(k) && n != null && n >= 0 && /^[a-zA-Z0-9]+$/.test(k)) nutrients[k] = n / 100;
    }
  }

  const units: PortionUnit[] = [
    { key: 'g', label: 'g', tab: 'Grams', grams: 1 },
    { key: 'oz', label: 'oz', tab: 'Ounces', grams: OZ },
  ];
  if (servingGrams) units.push({ key: 'serving', label: plural(servingWord), tab: cap(plural(servingWord)), grams: servingGrams });

  const origin = String(p.originalSource ?? p.source ?? '').toLowerCase();
  const lastGrams = finite(p.yourFood?.lastGrams);
  return {
    barcode,
    name: String(p.name ?? '').trim() || 'Unknown product',
    brand: p.brand ? String(p.brand) : null,
    perGram: {
      kcal: (finite(per100.calories ?? per100.kcal) ?? 0) / 100,
      proteinG: (finite(per100.proteinG) ?? 0) / 100,
      carbsG: (finite(per100.carbsG) ?? 0) / 100,
      fatG: (finite(per100.fatG) ?? 0) / 100,
      nutrients,
    },
    units,
    servingGrams,
    servingWord,
    fromLabel: origin === 'community' || origin === 'user_label_scan' || origin === 'label',
    sourceName: SOURCE_NAMES[origin] ?? (origin ? cap(origin) : 'Open Food Facts'),
    lastGrams: lastGrams != null && lastGrams > 0 ? lastGrams : null,
    lastLoggedAt: p.yourFood?.lastLoggedAt ?? null,
    product: p,
  };
}

/** Where the sheet opens: what they had last time, else one label serving, else 100 g. */
export const startingGrams = (b: FoodBasis) => b.lastGrams ?? b.servingGrams ?? 100;

export function scalePortion(b: FoodBasis, grams: number): PortionTotals {
  const g = Math.max(0, grams);
  const nutrients: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.perGram.nutrients)) nutrients[k] = v * g;
  return { kcal: b.perGram.kcal * g, proteinG: b.perGram.proteinG * g, carbsG: b.perGram.carbsG * g, fatG: b.perGram.fatG * g, nutrients };
}

export const unitOf = (b: FoodBasis, key: PortionUnitKey): PortionUnit => b.units.find((u) => u.key === key) ?? b.units[0];
export const amountIn = (grams: number, u: PortionUnit) => grams / u.grams;
/** An amount in a unit → grams, 0.1 g precision, never negative. */
export const gramsFrom = (amount: number, u: PortionUnit) => Math.min(MAX_GRAMS, Math.max(0, Math.round(amount * u.grams * 10) / 10));

export function fmtAmount(amount: number, key: PortionUnitKey): string {
  if (key === 'g') return String(Math.round(amount));
  if (key === 'oz') return amount.toFixed(1);
  return String(r2(amount));
}

/** The typed value in the current unit, or null for anything that isn't a number. Clamped to ≥ 0. */
export function parseAmount(raw: string, u: PortionUnit): number | null {
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? gramsFrom(n, u) : null;
}

/** "170 g", "6.0 oz", "1 container", "1.25 containers". */
export function portionText(grams: number, u: PortionUnit, servingWord: string): string {
  const a = amountIn(grams, u);
  if (u.key === 'serving' && r2(a) === 1) return `1 ${servingWord}`;
  return `${fmtAmount(a, u.key)} ${u.label}`;
}

/** The small conversion beside the hero. */
export function secondaryAmount(grams: number, b: FoodBasis, key: PortionUnitKey): string {
  if (key !== 'g') return `${Math.round(grams)} g`;
  if (!b.servingGrams) return `${amountIn(grams, unitOf(b, 'oz')).toFixed(1)} oz`;
  const n = r1(grams / b.servingGrams);
  return `${n} ${n === 1 ? b.servingWord : plural(b.servingWord)}`;
}

// ── The ruler ─────────────────────────────────────────────────────────────────

export interface RulerConfig { key: PortionUnitKey; step: number; px: number; minor: number; major: number; max: number; chunkMajors: number }
export interface RulerTick { x: number; kind: 'minor' | 'mid' | 'major'; label?: string }

const up = (n: number, to: number) => Math.ceil(n / to) * to;

/** Scale per unit. The range grows only when this product needs it (a 400 g tub). */
export function rulerFor(b: FoodBasis, key: PortionUnitKey): RulerConfig {
  const needG = Math.max(600, up(Math.max((b.servingGrams ?? 0) * 2, (b.lastGrams ?? 0) * 1.25), 50));
  if (key === 'oz') return { key, step: 0.1, px: 160, minor: 0.1, major: 1, max: needG > 600 ? Math.min(53, Math.ceil(needG / OZ)) : 21, chunkMajors: 5 };
  if (key === 'serving') return { key, step: 0.25, px: 240, minor: 0.25, major: 1, max: Math.max(4, Math.min(12, Math.ceil((b.lastGrams ?? 0) / (b.servingGrams || 1)) + 1)), chunkMajors: 3 };
  return { key, step: 1, px: 6, minor: 5, major: 50, max: Math.min(1500, needG), chunkMajors: 3 };
}

/** Every tick on the strip, from whole indexes so no float drift misplaces one. */
export function rulerTicks(c: RulerConfig): RulerTick[] {
  const majorEvery = Math.round(c.major / c.minor);
  const count = Math.round(c.max / c.minor);
  const out: RulerTick[] = [];
  for (let i = 0; i <= count; i++) {
    const v = i * c.minor;
    const x = Math.round(v * c.px * 100) / 100;
    if (i % majorEvery === 0) out.push({ x, kind: 'major', label: fmtAmount(v, c.key) });
    else out.push({ x, kind: c.key === 'g' && i % 5 === 0 ? 'mid' : 'minor' });
  }
  return out;
}

/** `1 CONTAINER` and `LAST` on the strip. Marks closer than 72 pt are dropped so they never overlap; the first stays. */
export function rulerMarks(b: FoodBasis, u: PortionUnit, c: RulerConfig): { label: string; x: number; grams: number }[] {
  const marks: { label: string; grams: number }[] = [];
  if (b.servingGrams) marks.push({ label: `1 ${b.servingWord}`, grams: b.servingGrams });
  if (b.lastGrams) marks.push({ label: 'last', grams: b.lastGrams });
  const kept: { label: string; x: number; grams: number }[] = [];
  for (const m of marks) {
    const x = amountIn(m.grams, u) * c.px;
    if (amountIn(m.grams, u) <= c.max && kept.every((o) => Math.abs(o.x - x) > 72)) kept.push({ ...m, x });
  }
  return kept;
}

/** The text links under the ruler. Two that land on the same grams show once. */
export function quickPicks(b: FoodBasis): { label: string; grams: number }[] {
  const picks: { label: string; grams: number }[] = [];
  if (b.servingGrams) {
    picks.push({ label: `½ ${b.servingWord}`, grams: r1(b.servingGrams / 2) });
    picks.push({ label: `1 ${b.servingWord}`, grams: b.servingGrams });
  } else {
    picks.push({ label: '50 g', grams: 50 });
  }
  picks.push({ label: '100 g', grams: 100 });
  if (b.lastGrams) picks.push({ label: `Last time · ${Math.round(b.lastGrams)} g`, grams: b.lastGrams });
  return picks.filter((p, i) => picks.findIndex((o) => Math.round(o.grams) === Math.round(p.grams)) === i);
}

// ── Day impact, micros, the label ─────────────────────────────────────────────

export interface DayNumbers { targetKcal: number | null; targetProtein?: number | null; eatenKcal: number; eatenProtein: number }
export interface DayImpact { eatenFrac: number; portionFrac: number; over: boolean; kcal: number; proteinLeft: number | null }

/** Null when no target is set: the bar and sentence hide. */
export function dayImpact(d: DayNumbers, t: Pick<PortionTotals, 'kcal' | 'proteinG'>): DayImpact | null {
  if (!d.targetKcal || d.targetKcal <= 0) return null;
  const eatenFrac = Math.min(1, Math.max(0, d.eatenKcal / d.targetKcal));
  const left = Math.round(d.targetKcal - d.eatenKcal - t.kcal);
  const proteinLeft = d.targetProtein ? Math.round(d.targetProtein - d.eatenProtein - t.proteinG) : null;
  return {
    eatenFrac,
    portionFrac: Math.min(1 - eatenFrac, Math.max(0, t.kcal / d.targetKcal)),
    over: left < 0,
    kcal: Math.abs(left),
    proteinLeft: proteinLeft != null && proteinLeft > 0 ? proteinLeft : null,
  };
}

export interface MicroTarget { key: string; label: string; target: number; unit?: string; direction: string; focus?: boolean }
export interface MicroRow { key: string; label: string; amount: string; pct: number; focus: boolean; limit: boolean }

export function fmtMicro(amount: number, unit = ''): string {
  const u = unit === 'mcg' ? 'µg' : unit;
  return `${amount < 10 ? r1(amount) : Math.round(amount)}${u ? ` ${u}` : ''}`;
}

/**
 * The "Of today's targets" rows. Default: the 5 most relevant, limits left out,
 * the plan's focus first. All: every nutrient on the label that has a target.
 */
export function microRows(nutrients: Record<string, number>, targets: MicroTarget[], all = false, n = 5): { rows: MicroRow[]; total: number; focus: MicroRow | null } {
  const every = targets
    .filter((t) => t.target > 0 && (nutrients[t.key] ?? 0) > 0)
    .map((t) => ({
      key: t.key, label: t.label, amount: fmtMicro(nutrients[t.key], t.unit),
      pct: Math.round((nutrients[t.key] / t.target) * 100),
      focus: !!t.focus && t.direction !== 'limit', limit: t.direction === 'limit',
    }))
    .sort((a, b) => Number(a.limit) - Number(b.limit) || Number(b.focus) - Number(a.focus) || b.pct - a.pct);
  const rows = all ? every : every.filter((r) => !r.limit).slice(0, n);
  return { rows, total: every.length, focus: rows.find((r) => r.focus) ?? null };
}

/** The label as printed: the basis everything scales from. It never changes with the amount. */
export function labelColumns(b: FoodBasis, per100: boolean): { heading: string; toggle: string | null; values: { value: string; label: string }[] } {
  const showServing = !!b.servingGrams && !per100;
  const g = showServing ? (b.servingGrams as number) : 100;
  const v = (n: number) => String(r1(n * g));
  return {
    heading: showServing ? `Label · per 1 ${b.servingWord} (${r1(g)} g)` : 'Label · per 100 g',
    toggle: b.servingGrams ? (showServing ? 'per 100 g' : `per ${b.servingWord}`) : null,
    values: [
      { value: String(Math.round(b.perGram.kcal * g)), label: 'kcal' },
      { value: `${v(b.perGram.proteinG)} g`, label: 'protein' },
      { value: `${v(b.perGram.carbsG)} g`, label: 'carbs' },
      { value: `${v(b.perGram.fatG)} g`, label: 'fat' },
    ],
  };
}

// ── Words ─────────────────────────────────────────────────────────────────────

/** "0 64420 05112 4" for a 12-digit UPC, "5 449000 000996" for a 13-digit EAN. */
export function fmtBarcode(code: string): string {
  if (/^\d{12}$/.test(code)) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code[11]}`;
  if (/^\d{13}$/.test(code)) return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
  return code;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today", "yesterday", "last Tuesday", or "on Oct 3" from a week back. */
export function whenLogged(iso: string | null | undefined, now = new Date()): string | null {
  const d = iso ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime())) return null;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `last ${WEEKDAYS[d.getDay()]}`;
  return `on ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** The `FOUND` receipt. */
export function foundText(b: FoodBasis, now = new Date()): string {
  if (b.lastGrams) {
    const when = whenLogged(b.lastLoggedAt, now);
    return `Your foods · logged ${Math.round(b.lastGrams)} g${when ? ` ${when}` : ''}`;
  }
  return `${b.sourceName} · label per ${b.servingGrams ? `${r1(b.servingGrams)} g` : '100 g'}`;
}

/** Same shape as every other log, plus the portion and the food to remember. */
export function portionLogBody(b: FoodBasis, grams: number, unit: PortionUnitKey, slot: string, date: string) {
  const t = scalePortion(b, grams);
  const u = unitOf(b, unit);
  const nutrients: Record<string, number> = {};
  for (const [k, v] of Object.entries(t.nutrients)) nutrients[k] = r2(v);
  const name = `${b.name}${b.brand ? ` · ${b.brand}` : ''}`.slice(0, 200);
  const macros = { calories: Math.round(t.kcal), proteinG: r1(t.proteinG), carbsG: r1(t.carbsG), fatG: r1(t.fatG) };
  const item = `${b.name} (${Math.round(grams)} g)`.slice(0, 120);
  return {
    date, mealType: slot, name, ...macros,
    ...(Object.keys(nutrients).length ? { nutrients } : {}),
    ingredients: [item],
    ingredientNutrients: [{ name: item, nutrients: { ...macros } }],
    source: 'barcode',
    barcode: b.barcode,
    portion: { grams: r1(grams), unit, unitLabel: unit === 'serving' ? b.servingWord : u.label },
    foodBasis: b.product,
  };
}

/** Anakin's line and the receipts on the confirmation. Only numbers we have. */
export function loggedRead(t: Pick<PortionTotals, 'kcal' | 'proteinG'>, d: DayNumbers): string {
  const p = Math.round(t.proteinG);
  if (p <= 0) return `${Math.round(t.kcal)} kcal in.`;
  if (!d.targetProtein) return `${p} g of protein in.`;
  const left = Math.round(d.targetProtein - d.eatenProtein - t.proteinG);
  return left > 0 ? `${p} g of protein in. ${left} g to go.` : `${p} g of protein in. That covers today’s target.`;
}

export function loggedReceipts(b: FoodBasis, grams: number, t: PortionTotals): { verb: 'Logged' | 'Saved'; text: string }[] {
  const g = Math.round(grams);
  return [
    { verb: 'Logged', text: `${b.name} · ${g} g — ${Math.round(t.kcal)} kcal · ${Math.round(t.proteinG)} P · ${Math.round(t.carbsG)} C · ${Math.round(t.fatG)} F` },
    { verb: 'Saved', text: `Your foods — next scan starts at ${g} g` },
  ];
}
