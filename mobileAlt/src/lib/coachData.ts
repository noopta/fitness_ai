// Shared coach-screen data helpers, extracted so the boot-time prefetcher
// can warm the same cache entry the Coach screen reads on mount. The cache
// key + TTL + shape live here as the single source of truth — both
// CoachScreen and prefetch import from this module.

import { coachApi } from './api';

export const COACH_INIT_TTL_MS = 30 * 60 * 1000; // 30 min

export const coachInitCacheKey = (userId: string): string => `coach:init:${userId}`;

export interface CoachInitCacheShape {
  coachData: any;
  hasProgram: boolean;
}

/**
 * A program is only valid if it has a `phases` array with at least one entry.
 * The raw input can be the program object itself, wrapped under `program`, or
 * stringified JSON — all three shapes show up in different responses.
 */
export function extractProgram(raw: any): any | null {
  if (!raw) return null;
  let prog: any;
  if (typeof raw === 'object' && 'program' in raw) {
    prog = raw.program;
  } else if (typeof raw === 'object' && 'savedProgram' in raw) {
    prog = raw.savedProgram;
  } else {
    prog = raw;
  }
  if (typeof prog === 'string') {
    try { prog = JSON.parse(prog); } catch { return null; }
  }
  if (prog && typeof prog === 'object' && Array.isArray(prog.phases) && prog.phases.length > 0) {
    return prog;
  }
  return null;
}

/**
 * Fetch the data the Coach screen needs on mount: chat messages + the user's
 * saved program. Errors are swallowed individually so a flaky /program call
 * doesn't sink /messages (the prior behavior in CoachScreen.fetchCoachInit).
 *
 * `userSavedProgram` lets a caller pass through `user.savedProgram` from the
 * auth context as a third-tier fallback. Optional — the screen passes it,
 * the prefetcher doesn't have it and skips the fallback (program resolution
 * still works from the explicit /program response).
 */
export async function fetchCoachInit(
  userSavedProgram?: any,
): Promise<CoachInitCacheShape> {
  const [data, programResult] = await Promise.all([
    coachApi.getMessages().catch(() => ({})),
    coachApi.getProgram().catch(() => null),
  ]);
  const resolvedProgram =
    extractProgram(programResult)
    ?? extractProgram(userSavedProgram)
    ?? extractProgram((data as any)?.savedProgram)
    ?? null;
  return {
    coachData: { ...(data as any), savedProgram: resolvedProgram },
    hasProgram: !!resolvedProgram,
  };
}
