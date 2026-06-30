// Pure view-model helpers for the web Program Reveal screen.
//
// All number-bearing logic lives here (not in JSX) so it's unit-testable and so
// the screen honours the spec's hard rule: bind to the user's real generated
// program, derive what's derivable, and OMIT anything missing rather than
// fabricate it. Nothing here invents a value. (Mirror of the mobile helper.)

import type { ProgramSource, ProgramSourceSection } from './ProgramSetup';

// Brand constants — the two non-plan hero figures (spec §6). The third hero stat
// (studies cited) is real and per-plan.
export const BRAND_CERTIFICATIONS = 10;
export const BRAND_SCIENCE_PAGES = 7000;

export function macroPercents(macros: {
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
} | null | undefined): { protein: number; carbs: number; fat: number } | null {
  if (!macros) return null;
  const pCal = Math.max(0, macros.proteinG ?? 0) * 4;
  const cCal = Math.max(0, macros.carbsG ?? 0) * 4;
  const fCal = Math.max(0, macros.fatG ?? 0) * 9;
  const total = pCal + cCal + fCal;
  if (total <= 0) return null;
  const protein = Math.round((pCal / total) * 100);
  const carbs = Math.round((cCal / total) * 100);
  const fat = Math.max(0, 100 - protein - carbs);
  return { protein, carbs, fat };
}

export function studiesCitedCount(sources?: ProgramSource[] | null): number {
  return Array.isArray(sources) ? sources.length : 0;
}

export function refsForSection(
  sources: ProgramSource[] | null | undefined,
  section: ProgramSourceSection,
): ProgramSource[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter((s) => Array.isArray(s.sections) && s.sections.includes(section));
}

export interface RevealPhase {
  name: string;
  weeksLabel: string;
  weeks: number;
  rationale: string;
  isCurrent: boolean;
}

export function buildPhases(program: any): RevealPhase[] {
  const phases = Array.isArray(program?.phases) ? program.phases : [];
  return phases.map((p: any, i: number): RevealPhase => {
    const weeks = Number(p?.durationWeeks ?? p?.weeks) || 1;
    const name = (p?.phaseName ?? p?.name ?? `Phase ${i + 1}`).toString();
    const weeksLabel = (p?.weeksLabel ?? (weeks ? `${weeks} wk${weeks === 1 ? '' : 's'}` : '')).toString();
    return {
      name,
      weeksLabel,
      weeks: Math.max(1, weeks),
      rationale: (p?.rationale ?? '').toString(),
      isCurrent: i === 0,
    };
  });
}

export interface RevealExercise {
  name: string;
  tag: string | null;
  reason: string | null;
}

export function buildExercises(program: any, limit = 4): RevealExercise[] {
  const phase0 = program?.phases?.[0];
  const day0 = phase0?.trainingDays?.[0] ?? phase0?.days?.[0];
  const exercises = Array.isArray(day0?.exercises) ? day0.exercises : [];
  return exercises.slice(0, limit).map((ex: any): RevealExercise => ({
    name: (ex?.exercise ?? ex?.name ?? 'Exercise').toString(),
    tag: ex?.intensity ? ex.intensity.toString() : null,
    reason: ex?.notes ? ex.notes.toString() : null,
  }));
}

export interface RevealVolumeTile {
  value: string;
  label: string;
}

export function buildVolumeTiles(program: any): RevealVolumeTile[] {
  const tiles: RevealVolumeTile[] = [];
  const phase0 = program?.phases?.[0];
  const day0 = phase0?.trainingDays?.[0] ?? phase0?.days?.[0];
  const exercises: any[] = Array.isArray(day0?.exercises) ? day0.exercises : [];

  const totalSets = exercises.reduce((sum, ex) => sum + (Number(ex?.sets) || 0), 0);
  if (totalSets > 0) tiles.push({ value: String(totalSets), label: 'sets / session' });

  const repNums: number[] = [];
  for (const ex of exercises) {
    const m = String(ex?.reps ?? '').match(/\d+/g);
    if (m) for (const n of m) repNums.push(Number(n));
  }
  if (repNums.length > 0) {
    const lo = Math.min(...repNums);
    const hi = Math.max(...repNums);
    tiles.push({ value: lo === hi ? `${lo}` : `${lo}–${hi}`, label: 'rep range' });
  }

  const rpe = exercises
    .map((ex) => String(ex?.intensity ?? '').match(/RPE\s*([\d.]+)/i)?.[1])
    .filter(Boolean) as string[];
  if (rpe.length > 0) {
    const nums = rpe.map(Number);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    tiles.push({ value: lo === hi ? `RPE ${lo}` : `RPE ${lo}–${hi}`, label: 'target effort' });
  }

  return tiles;
}

export interface RevealNutrition {
  proteinG: number | null;
  calories: number | null;
  percents: { protein: number; carbs: number; fat: number } | null;
}

export function buildNutrition(program: any): RevealNutrition | null {
  const macros = program?.nutritionPlan?.macros ?? program?.nutritionPlan ?? null;
  if (!macros) return null;
  const proteinG = Number.isFinite(macros.proteinG) ? Math.round(macros.proteinG) : null;
  const calories = Number.isFinite(macros.calories) ? Math.round(macros.calories) : null;
  const percents = macroPercents(macros);
  if (proteinG == null && calories == null && !percents) return null;
  return { proteinG, calories, percents };
}

export function firstNameOf(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}
