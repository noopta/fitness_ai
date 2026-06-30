// Pure view-model helpers for the Program Reveal screen.
//
// All number-bearing logic lives here (not in the JSX) so it can be unit-tested
// and so the screen honours the design spec's hard rule: bind to the user's real
// generated program, derive what's derivable, and OMIT anything missing rather
// than fabricate it. Nothing here invents a value.

export type RevealSection = 'periodization' | 'exercise' | 'volume' | 'nutrition';

export interface RevealSource {
  id: string;
  source: string;
  chapter: string | null;
  sections: RevealSection[];
  snippet?: string;
}

// Brand constants — the two non-plan hero figures (spec §6: "first two are brand
// constants"). The third hero stat (studies cited) is real, per-plan.
export const BRAND_CERTIFICATIONS = 10;
export const BRAND_SCIENCE_PAGES = 7000;

/**
 * Macro split as whole percentages from gram targets (protein/carbs 4 kcal/g,
 * fat 9 kcal/g). Returns null when no usable macro data — caller omits the bar.
 * Percentages are forced to sum to exactly 100 (fat absorbs the rounding).
 */
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

/** Real per-plan citation count. Zero (→ omit the hero stat & sources block) when absent. */
export function studiesCitedCount(sources?: RevealSource[] | null): number {
  return Array.isArray(sources) ? sources.length : 0;
}

/** Sources that support a given construction section (for that section's inline ref chips). */
export function refsForSection(
  sources: RevealSource[] | null | undefined,
  section: RevealSection,
): RevealSource[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter((s) => Array.isArray(s.sections) && s.sections.includes(section));
}

export interface RevealPhase {
  name: string;
  weeksLabel: string;
  weeks: number;      // flex weight for the phase bar (>= 1)
  rationale: string;
  isCurrent: boolean; // first phase = the "Foundation" ink chip
}

/**
 * Normalise the generated program's phases into the phase-bar view model,
 * tolerating both the raw backend shape (phaseName/weeksLabel/durationWeeks)
 * and the client-normalised shape (name/weeks). Empty array when no phases.
 */
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
  tag: string | null;     // mono tag on the right (e.g. intensity)
  reason: string | null;  // 12px reason line; omitted when absent
}

/**
 * Exercises from the first training day of the first phase — the spec's §02
 * "stacked exercise cards". Tolerates trainingDays/days and exercise/name.
 * Returns at most `limit` cards.
 */
export function buildExercises(program: any, limit = 4): RevealExercise[] {
  const phase0 = program?.phases?.[0];
  const day0 = phase0?.trainingDays?.[0] ?? phase0?.days?.[0];
  const exercises = Array.isArray(day0?.exercises) ? day0.exercises : [];
  return exercises.slice(0, limit).map((ex: any): RevealExercise => {
    const name = (ex?.exercise ?? ex?.name ?? 'Exercise').toString();
    const tag = ex?.intensity ? ex.intensity.toString() : null;
    const reason = ex?.notes ? ex.notes.toString() : null;
    return { name, tag, reason };
  });
}

export interface RevealVolumeTile {
  value: string;
  label: string;
}

/**
 * §03 volume/intensity stat tiles. We only show tiles we can derive honestly
 * from the plan: sets/session and the working rep range. %e1RM is NOT generated
 * (programs are RPE-based), so that tile is omitted rather than faked.
 */
export function buildVolumeTiles(program: any): RevealVolumeTile[] {
  const tiles: RevealVolumeTile[] = [];
  const phase0 = program?.phases?.[0];
  const day0 = phase0?.trainingDays?.[0] ?? phase0?.days?.[0];
  const exercises: any[] = Array.isArray(day0?.exercises) ? day0.exercises : [];

  const totalSets = exercises.reduce((sum, ex) => sum + (Number(ex?.sets) || 0), 0);
  if (totalSets > 0) tiles.push({ value: String(totalSets), label: 'sets / session' });

  // Aggregate the rep range across the session's working sets.
  const repNums: number[] = [];
  for (const ex of exercises) {
    const reps = String(ex?.reps ?? '');
    const m = reps.match(/\d+/g);
    if (m) for (const n of m) repNums.push(Number(n));
  }
  if (repNums.length > 0) {
    const lo = Math.min(...repNums);
    const hi = Math.max(...repNums);
    tiles.push({ value: lo === hi ? `${lo}` : `${lo}–${hi}`, label: 'rep range' });
  }

  // Representative intensity (RPE) if every exercise carries one.
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

/** §04 nutrition view model, or null when the plan carries no macro data. */
export function buildNutrition(program: any): RevealNutrition | null {
  const macros = program?.nutritionPlan?.macros ?? program?.nutritionPlan ?? null;
  if (!macros) return null;
  const proteinG = Number.isFinite(macros.proteinG) ? Math.round(macros.proteinG) : null;
  const calories = Number.isFinite(macros.calories) ? Math.round(macros.calories) : null;
  const percents = macroPercents(macros);
  if (proteinG == null && calories == null && !percents) return null;
  return { proteinG, calories, percents };
}

/** First name for the headline, falling back to a neutral greeting. */
export function firstNameOf(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}
