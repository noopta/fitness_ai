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

  if (phases.length === 0) {
    return { ...empty, weekNumber, daysSinceStart };
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
