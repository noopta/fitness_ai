// Nutrition plan page (RN spec bug fixes, 5 Oct 2026 — 2b/2c). Pure shaping
// over the latest NutritionPlan row and the last 7 days of meals:
//
//   summarizePlan  → the GET /nutrition/plan summary (week N of 8, focus
//                    nutrients with coverage, the gut week, supplements)
//   planChanges    → validates a proposed change list against the current
//                    plan and returns the before → after diff rows
//   applyChanges   → the new plan/targets a proposal writes on Apply
//
// The route and the agent op do the loading and saving; everything that
// decides a number lives here so it is unit-tested without a DB.

import { statusFor, type MicroTarget, type MicroTargetResult } from './microTargetsService.js';
import { distinctPlants, PLANT_TARGET } from './gutHealthScoreService.js';
import type { GeneratedNutritionPlan, PlanSource } from './nutritionPlanService.js';

/** A plan runs eight weeks; "Week 2 of 8". */
export const PLAN_WEEKS = 8;
const WEEK_MS = 7 * 86_400_000;

export interface GutTargets { plants: number; fermentedDays: number; upfMax: number }
export const GUT_DEFAULTS: GutTargets = { plants: PLANT_TARGET, fermentedDays: 5, upfMax: 20 };

/** A target moving gradually: from → to over `weeks`, starting `startedAt`. */
export interface Ramp { from: number; to: number; weeks: number; startedAt: string }

/** What a saved plan carries beyond the generated narrative. */
export type StoredPlan = GeneratedNutritionPlan & {
  /** When this plan's eight weeks began — kept across edits so a tweak doesn't restart week 1. */
  startedAt?: string;
  gutTargets?: Partial<GutTargets>;
  ramps?: Record<string, Ramp>;
  supplements: Array<GeneratedNutritionPlan['supplements'][number] & { when?: string | null }>;
};

export interface WindowMeal {
  date: string;
  nutrientsJson: string | null;
  plantsJson: string | null;
  fermentedJson: string | null;
  ultraProcessed: boolean;
}

export interface PlanSummary {
  week: number;
  weeks: number;
  onTrack: number;
  total: number;
  focus: { key: string; nutrient: string; amount: number; target: number; unit: string; onTrack: boolean }[];
  gut: {
    plants: { n: number; target: number };
    fiberG: { n: number; target: number };
    fermentedDays: { n: number; target: number };
    upfPct: { n: number; max: number };
  };
  supplements: { name: string; dose: string; when: string | null }[];
  sources: PlanSource[];
}

const parse = <T>(s: string | null, d: T): T => { if (!s) return d; try { return JSON.parse(s) as T; } catch { return d; } };
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Copy says µg, never mcg. */
export const displayUnit = (u: string) => (u === 'mcg' ? 'µg' : u);

export function gutTargetsOf(plan: Pick<StoredPlan, 'gutTargets'>): GutTargets {
  return { ...GUT_DEFAULTS, ...(plan.gutTargets ?? {}) };
}

/** A ramped target's value today; otherwise the stored target. */
export function effectiveTarget(key: string, base: number, ramps: StoredPlan['ramps'], now: Date): number {
  const r = ramps?.[key];
  if (!r) return base;
  const t = Math.max(0, Math.min(1, (now.getTime() - new Date(r.startedAt).getTime()) / (Math.max(1, r.weeks) * WEEK_MS)));
  return r1(r.from + (r.to - r.from) * t);
}

/** "with dinner", "before bed", "in the morning" — from the plan's rationale when it doesn't say. */
export function whenOf(s: { when?: string | null; rationale?: string }): string | null {
  if (s.when) return s.when;
  const m = String(s.rationale ?? '').match(/\b((?:with|after|before|at)\s+(?:breakfast|lunch|dinner|a meal|meals|food|bed|bedtime|night|training|your workout)|in the (?:morning|evening))\b/i);
  return m ? m[1].toLowerCase() : null;
}

export function summarizePlan(input: {
  plan: StoredPlan; targets: MicroTargetResult; sources: PlanSource[]; generatedAt: Date;
  meals: WindowMeal[]; days: number; now: Date;
}): PlanSummary {
  const { plan, targets, now } = input;
  const days = Math.max(1, Math.min(7, input.days));
  const started = new Date(plan.startedAt ?? input.generatedAt);
  const week = Math.max(1, Math.min(PLAN_WEEKS, Math.floor((now.getTime() - started.getTime()) / WEEK_MS) + 1));

  const totals: Record<string, number> = {};
  const plantLists: string[][] = [];
  const fermentedDates = new Set<string>();
  let upf = 0;
  for (const m of input.meals) {
    const n = parse<Record<string, unknown>>(m.nutrientsJson, {});
    for (const [k, v] of Object.entries(n)) { const x = Number(v); if (Number.isFinite(x)) totals[k] = (totals[k] ?? 0) + x; }
    const plants = parse<unknown>(m.plantsJson, []);
    if (Array.isArray(plants)) plantLists.push(plants.map(String));
    const ferm = parse<unknown>(m.fermentedJson, []);
    if (Array.isArray(ferm) && ferm.length) fermentedDates.add(m.date);
    if (m.ultraProcessed) upf += 1;
  }
  const avg = (k: string) => r1((totals[k] ?? 0) / days);
  const byKey = new Map(targets.targets.map((t) => [t.key, t]));

  const focus = targets.focus.map((k) => byKey.get(k)).filter((t): t is MicroTarget => !!t).map((t) => {
    const target = effectiveTarget(t.key, t.target, plan.ramps, now);
    const amount = avg(t.key);
    return { key: t.key, nutrient: t.label, amount, target, unit: displayUnit(t.unit), onTrack: statusFor({ ...t, target }, amount) === 'ok' };
  });

  const gt = gutTargetsOf(plan);
  const fiber = byKey.get('fiberG');
  return {
    week, weeks: PLAN_WEEKS,
    onTrack: focus.filter((f) => f.onTrack).length,
    total: focus.length,
    focus,
    gut: {
      plants: { n: distinctPlants(plantLists).length, target: effectiveTarget('plants', gt.plants, plan.ramps, now) },
      fiberG: { n: avg('fiberG'), target: effectiveTarget('fiberG', fiber?.target ?? 30, plan.ramps, now) },
      fermentedDays: { n: fermentedDates.size, target: gt.fermentedDays },
      upfPct: { n: input.meals.length ? Math.round((upf / input.meals.length) * 100) : 0, max: gt.upfMax },
    },
    supplements: (plan.supplements ?? []).map((s) => ({ name: s.name, dose: s.doseRange, when: whenOf(s) })),
    sources: input.sources,
  };
}

// ─── Changes (Proposal card P-04) ─────────────────────────────────────────────

export const MACRO_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;
export type MacroField = typeof MACRO_FIELDS[number];
const MACRO_LABEL: Record<MacroField, [string, string]> = { calories: ['Calories', ' kcal'], proteinG: ['Protein', ' g'], carbsG: ['Carbs', ' g'], fatG: ['Fat', ' g'] };
const GUT_LABEL: Record<keyof GutTargets, [string, string]> = { plants: ['Plants a week', ''], fermentedDays: ['Fermented days', ' a week'], upfMax: ['Ultra-processed', '% max'] };

/** One requested change, as the model sends it. `field`: a nutrient key ("fiberG"), "focus", "supplement", "plants" / "fermentedDays" / "upfMax", or a macro. */
export interface RequestedChange { field: string; to: unknown; name?: string; ramp?: { weeks?: number } | null }

/** A validated change: what the op applies, and the diff row the card shows. */
export interface PlanChange {
  field: string;
  kind: 'target' | 'focus' | 'supplement' | 'gut' | 'macro';
  to: number | string[] | { name: string; dose: string; when: string | null } | null;
  name?: string;
  ramp?: { weeks: number };
  row: { key: string; from?: string; to: string; removed?: boolean };
}

export interface PlanState { plan: StoredPlan | null; targets: MicroTargetResult | null; macros: Partial<Record<MacroField, number>> | null }

const fmt = (n: number, unit: string) => `${Number.isInteger(n) ? n : r1(n)}${unit}`;
const listLabel = (labels: string[]) => labels.map((l, i) => (i ? l.charAt(0).toLowerCase() + l.slice(1) : l)).join(', ');
const supplementLine = (s: { doseRange?: string; dose?: string; when?: string | null }) => [s.doseRange ?? s.dose, s.when].filter(Boolean).join(' · ') || 'Daily';

/** Resolve "iron", "Vitamin D", "vitaminDIU" → a target key. */
export function nutrientKey(targets: MicroTargetResult, raw: string): string | null {
  const q = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = targets.targets.find((t) => t.key.toLowerCase() === q || t.label.toLowerCase().replace(/[^a-z0-9]/g, '') === q)
    ?? targets.targets.find((t) => t.label.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(q) || q.startsWith(t.label.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return hit?.key ?? null;
}

/** Validate a change list against the current plan. Throws with a sentence the user can read. */
export function planChanges(state: PlanState, requested: RequestedChange[], now = new Date()): PlanChange[] {
  const out: PlanChange[] = [];
  for (const c of requested) {
    const field = String(c.field ?? '').trim();
    const rampWeeks = c.ramp?.weeks && c.ramp.weeks > 0 ? Math.min(12, Math.round(c.ramp.weeks)) : undefined;
    const ramp = rampWeeks ? { weeks: rampWeeks } : undefined;
    const rampNote = rampWeeks ? ` over ${rampWeeks} week${rampWeeks === 1 ? '' : 's'}` : '';

    if ((MACRO_FIELDS as readonly string[]).includes(field)) {
      const to = Number(c.to);
      if (!state.macros) throw new Error('There are no daily targets to change yet.');
      if (!Number.isFinite(to) || to <= 0) throw new Error(`Give a number for ${MACRO_LABEL[field as MacroField][0].toLowerCase()}.`);
      const [label, unit] = MACRO_LABEL[field as MacroField];
      out.push({ field, kind: 'macro', to: Math.round(to), row: { key: label, from: fmt(Number(state.macros[field as MacroField] ?? 0), unit), to: fmt(Math.round(to), unit) } });
      continue;
    }

    if (!state.plan || !state.targets) throw new Error('There’s no nutrition plan yet — build one from your gut check-in first.');
    const targets = state.targets;

    if (field in GUT_DEFAULTS) {
      const key = field as keyof GutTargets;
      const to = Math.round(Number(c.to));
      if (!Number.isFinite(to) || to < 0) throw new Error('Give a number for that target.');
      const [label, unit] = GUT_LABEL[key];
      const from = effectiveTarget(key, gutTargetsOf(state.plan)[key], state.plan.ramps, now);
      out.push({ field, kind: 'gut', to, ramp, row: { key: label, from: fmt(from, unit), to: `${fmt(to, unit)}${rampNote}` } });
      continue;
    }

    if (field === 'focus') {
      const raw = Array.isArray(c.to) ? c.to : String(c.to ?? '').split(/,|\band\b/);
      const keys = [...new Set(raw.map((x) => nutrientKey(targets, String(x).trim())).filter((k): k is string => !!k))];
      if (!keys.length) throw new Error('Name the nutrients to focus on.');
      const label = (ks: string[]) => listLabel(ks.map((k) => targets.targets.find((t) => t.key === k)?.label ?? k));
      out.push({ field, kind: 'focus', to: keys.slice(0, 6), row: { key: 'Focus', from: label(targets.focus), to: label(keys.slice(0, 6)) } });
      continue;
    }

    if (field === 'supplement') {
      const name = String(c.name ?? (typeof c.to === 'object' && c.to ? (c.to as any).name : '') ?? '').trim();
      const current = state.plan.supplements ?? [];
      const existing = current.find((s) => s.name.toLowerCase() === name.toLowerCase())
        ?? (name ? current.find((s) => s.name.toLowerCase().includes(name.toLowerCase())) : current.length === 1 ? current[0] : undefined);
      if (c.to == null || c.to === '' || c.to === false) {
        if (!existing) throw new Error(name ? `There’s no ${name} in the plan.` : 'There’s no supplement in the plan.');
        out.push({ field, kind: 'supplement', name: existing.name, to: null, row: { key: existing.name, from: supplementLine({ ...existing, when: whenOf(existing) }), to: 'Dropped', removed: true } });
        continue;
      }
      const t: any = typeof c.to === 'object' ? c.to : { dose: String(c.to) };
      const next = { name: String(t.name ?? name ?? existing?.name ?? '').trim(), dose: String(t.dose ?? t.doseRange ?? existing?.doseRange ?? '').trim(), when: t.when ? String(t.when) : existing ? whenOf(existing) : null };
      if (!next.name || !next.dose) throw new Error('Give the supplement a name and a dose.');
      out.push({ field, kind: 'supplement', name: next.name, to: next, row: { key: next.name, from: existing ? supplementLine({ ...existing, when: whenOf(existing) }) : 'None', to: supplementLine(next) } });
      continue;
    }

    const key = nutrientKey(targets, field);
    if (key) {
      const t = targets.targets.find((x) => x.key === key)!;
      const to = Number(c.to);
      if (!Number.isFinite(to) || to <= 0) throw new Error(`Give a number for ${t.label.toLowerCase()}.`);
      const unit = ` ${displayUnit(t.unit)}`;
      const from = effectiveTarget(key, t.target, state.plan.ramps, now);
      out.push({ field: key, kind: 'target', to: r1(to), ramp, row: { key: `${t.label} target`, from: fmt(from, unit), to: `${fmt(r1(to), unit)}${rampNote}` } });
      continue;
    }
    throw new Error(`I can’t change “${field}” in the plan.`);
  }
  if (!out.length) throw new Error('Say what to change in the plan.');
  return out;
}

/** The plan and targets after the non-macro changes. Macros are applied separately (they live on the program). */
export function applyChanges(plan: StoredPlan, targets: MicroTargetResult, changes: PlanChange[], generatedAt: Date, now = new Date()): { plan: StoredPlan; targets: MicroTargetResult } {
  const p: StoredPlan = JSON.parse(JSON.stringify(plan));
  const t: MicroTargetResult = JSON.parse(JSON.stringify(targets));
  p.startedAt = plan.startedAt ?? generatedAt.toISOString();
  const rampOf = (key: string, from: number, to: number, weeks?: number) => {
    p.ramps = { ...(p.ramps ?? {}) };
    if (weeks) p.ramps[key] = { from, to, weeks, startedAt: now.toISOString() };
    else delete p.ramps[key];
  };
  for (const c of changes) {
    if (c.kind === 'target') {
      const row = t.targets.find((x) => x.key === c.field);
      if (!row) continue;
      rampOf(c.field, effectiveTarget(c.field, row.target, plan.ramps, now), c.to as number, c.ramp?.weeks);
      row.target = c.to as number;
      if (!t.focus.includes(c.field) && row.direction === 'meet') t.focus = [...t.focus, c.field].slice(0, 6);
    } else if (c.kind === 'gut') {
      const key = c.field as keyof GutTargets;
      rampOf(key, effectiveTarget(key, gutTargetsOf(p)[key], plan.ramps, now), c.to as number, c.ramp?.weeks);
      p.gutTargets = { ...(p.gutTargets ?? {}), [key]: c.to as number };
    } else if (c.kind === 'focus') {
      t.focus = c.to as string[];
      // Narrative rows follow the focus list; new nutrients get a bare row until the next rebuild.
      p.focusNutrients = t.focus.map((k) => p.focusNutrients.find((f) => f.key === k) ?? (() => {
        const row = t.targets.find((x) => x.key === k)!;
        return { key: k, label: row.label, target: row.target, unit: row.unit, why: '', foods: [], citationIds: [] };
      })());
    } else if (c.kind === 'supplement') {
      const rest = (p.supplements ?? []).filter((s) => s.name.toLowerCase() !== String(c.name).toLowerCase());
      if (c.to == null) p.supplements = rest;
      else {
        const s = c.to as { name: string; dose: string; when: string | null };
        const prev = (p.supplements ?? []).find((x) => x.name.toLowerCase() === s.name.toLowerCase());
        p.supplements = [...rest, { name: s.name, doseRange: s.dose, when: s.when, rationale: prev?.rationale ?? '', citationIds: prev?.citationIds ?? [] }];
      }
    }
  }
  // Keep focus rows' targets in step with the target table.
  p.focusNutrients = p.focusNutrients.map((f) => ({ ...f, target: t.targets.find((x) => x.key === f.key)?.target ?? f.target }));
  return { plan: p, targets: t };
}

/** "Fiber target 25 g → 35 g over 3 weeks; Magnesium dropped" — the change-log line. */
export function changeSummary(changes: PlanChange[]): string {
  return changes.map((c) => (c.row.removed ? `${c.row.key} dropped` : `${c.row.key} ${c.row.from ? `${c.row.from} → ` : ''}${c.row.to}`)).join('; ');
}
