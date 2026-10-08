// Single source of truth for "where in the program is this user today?"
//
// Multiple endpoints used to inline this calculation; one (/coach/welcome)
// hardcoded phases[0], so the welcome message and any UI driven by it always
// said "Foundation" regardless of actual progression.

export interface ProgramPhase {
  phaseName?: string;
  name?: string;
  durationWeeks?: number;
  weeks?: number;
  trainingDays?: any[];
  days?: any[];
  [key: string]: any;
}

export interface SavedProgram {
  phases?: ProgramPhase[];
  durationWeeks?: number;
  [key: string]: any;
}

export interface PhaseState {
  weekNumber: number;
  phaseIndex: number;
  phaseNumber: number;
  phaseName: string | null;
  weekInPhase: number;
  daysSinceStart: number;
  currentPhase: ProgramPhase | null;
  trainingDays: any[];
  // Total weeks in the program (durationWeeks if present, else summed phases).
  totalWeeks: number;
  // True once daysSinceStart has carried the user past the final week. The
  // weekNumber field is *clamped* to totalWeeks so it never indicates overrun;
  // this flag is how callers know "they're done".
  isComplete: boolean;
}

function getESTDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function estMidnight(date: Date = new Date()): Date {
  return new Date(getESTDateString(date) + 'T12:00:00Z');
}

function phaseDuration(p: ProgramPhase): number {
  return p.durationWeeks ?? p.weeks ?? 1;
}

export function computePhaseState(
  program: SavedProgram | null,
  programStartDate: Date | null,
  now: Date = new Date(),
): PhaseState {
  const empty: PhaseState = {
    weekNumber: 1,
    phaseIndex: 0,
    phaseNumber: 1,
    phaseName: null,
    weekInPhase: 1,
    daysSinceStart: 0,
    currentPhase: null,
    trainingDays: [],
    totalWeeks: 0,
    isComplete: false,
  };

  if (!program) return empty;

  const phases = program.phases ?? [];
  const startDate = programStartDate ?? now;

  const todayMid = estMidnight(now);
  const startMid = estMidnight(startDate);
  const daysSinceStart = Math.max(
    0,
    Math.floor((todayMid.getTime() - startMid.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const totalWeeks =
    program.durationWeeks ??
    phases.reduce((sum, p) => sum + phaseDuration(p), 0) ??
    12;
  const weekNumber = Math.min(Math.floor(daysSinceStart / 7) + 1, Math.max(1, totalWeeks));
  // True only once the user has carried *past* the final week — we don't flag
  // mid-final-week as "done". Guards against a 0-week edge case.
  const isComplete = totalWeeks > 0 && daysSinceStart >= totalWeeks * 7;

  if (phases.length === 0) {
    return { ...empty, weekNumber, daysSinceStart, totalWeeks, isComplete };
  }

  let cumulative = 0;
  let phaseIndex = phases.length - 1;
  let weekInPhase = 1;
  for (let i = 0; i < phases.length; i++) {
    const dur = phaseDuration(phases[i]);
    if (weekNumber <= cumulative + dur) {
      phaseIndex = i;
      weekInPhase = weekNumber - cumulative;
      break;
    }
    cumulative += dur;
  }

  const currentPhase = phases[phaseIndex];
  return {
    weekNumber,
    phaseIndex,
    phaseNumber: phaseIndex + 1,
    phaseName: currentPhase?.phaseName ?? currentPhase?.name ?? null,
    weekInPhase: Math.max(1, weekInPhase),
    daysSinceStart,
    currentPhase,
    trainingDays: currentPhase?.trainingDays ?? currentPhase?.days ?? [],
    totalWeeks,
    isComplete,
  };
}

export function parseSavedProgram(savedProgram: string | null): SavedProgram | null {
  if (!savedProgram) return null;
  try {
    return JSON.parse(savedProgram) as SavedProgram;
  } catch {
    return null;
  }
}

/**
 * Which template day sits at a position in the week (0 = the program's start
 * weekday), or -1 for rest.
 *
 * With `weekSlots` (programs written since Oct 2026) the phase says which
 * positions train — e.g. [0, 2, 4] for three days with rest between — so a
 * 4-day program isn't four days straight. Without it (older programs), the
 * i-th position is the i-th day, and a day with an explicitly empty exercise
 * list is a rest placeholder holding its weekday ("Thursday — Rest").
 */
export function dayIndexAt(trainingDays: { exercises?: unknown[] }[] | null | undefined, i: number, weekSlots?: unknown): number {
  const days = trainingDays ?? [];
  const slots = Array.isArray(weekSlots) && weekSlots.length === days.length && weekSlots.every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 7) ? (weekSlots as number[]) : null;
  const idx = slots ? slots.indexOf(i) : i >= 0 && i < days.length ? i : -1;
  if (idx < 0) return -1;
  const d = days[idx];
  return d && !(Array.isArray(d.exercises) && d.exercises.length === 0) ? idx : -1;
}

/** The program day at a weekday position, or null for rest (see dayIndexAt). */
export function sessionAt<T extends { exercises?: unknown[] } | null | undefined>(trainingDays: T[], i: number, weekSlots?: unknown): T | null {
  const idx = dayIndexAt(trainingDays as any, i, weekSlots);
  return idx >= 0 ? trainingDays[idx] : null;
}
