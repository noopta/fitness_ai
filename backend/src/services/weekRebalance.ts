// Deterministic muscle-spacing helpers for the "swap a workout / review your
// week" flow. The LLM rebalancer (rebalanceWeekAfterSwap) is only a *hint*: it
// frequently places two same-focus days back-to-back because the day's `focus`
// field is the phase intent (e.g. "Corrective strength"), NOT the muscle group.
// The muscle group lives in the session NAME ("Upper — Horizontal Push/Pull"),
// and names like "Horizontal Push/Pull" vs "Vertical Push/Pull" read as
// different to the model even though both are Upper days. These helpers enforce
// the spacing rule in code so the schedule is correct regardless of the LLM.

export type RebSession = { day: string; focus?: string | null; [k: string]: any };

/**
 * Classify a session into coarse muscle buckets from its NAME. Returns the set
 * of large muscle regions the session trains hard. An empty set means "no major
 * region" (core/cardio/mobility) — those never block adjacency.
 */
export function classifyMuscleGroups(name: string): Set<string> {
  const s = (name || '').toLowerCase();
  const groups = new Set<string>();
  // Full / total body trains everything → conflicts with any hard day.
  if (/\bfull[\s-]?body\b|\btotal[\s-]?body\b/.test(s)) {
    groups.add('upper');
    groups.add('lower');
    return groups;
  }
  const upper = /\bupper\b|\bpush\b|\bpull\b|\bchest\b|\bback\b|\bshoulder|\bpress\b|\bbench\b|\barms?\b|\bbicep|\btricep|\blats?\b|\bdelt/;
  const lower = /\blower\b|\blegs?\b|\bhinge\b|\bsquat\b|\bquad|\bglute|\bham(string)?s?\b|\bposterior\b|\bdeadlift\b|\bcalf|\bcalv/;
  if (upper.test(s)) groups.add('upper');
  if (lower.test(s)) groups.add('lower');
  return groups;
}

/**
 * Two sessions conflict (cannot be on consecutive calendar days) when they
 * train an overlapping major muscle region. Rest days / null never conflict.
 */
export function sessionsConflict(a: RebSession | null | undefined, b: RebSession | null | undefined): boolean {
  if (!a || !b) return false;
  const ga = classifyMuscleGroups(a.day);
  const gb = classifyMuscleGroups(b.day);
  for (const g of ga) if (gb.has(g)) return true;
  return false;
}

/** Coarse one-word muscle label for a session name, used to enrich the LLM hint. */
export function muscleBucketLabel(name: string): string {
  const g = classifyMuscleGroups(name);
  if (g.has('upper') && g.has('lower')) return 'full body';
  if (g.has('upper')) return 'upper';
  if (g.has('lower')) return 'lower';
  return 'general';
}

const normName = (s: string) => (s || '').toLowerCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * Place pool sessions into the open day-slots so that no two adjacent calendar
 * days share a muscle region. Locked days (today's swapped-in session + past /
 * logged days) are fixed and only constrain their neighbors. `preference` is an
 * ordered list of session names (the LLM's suggested order) used as a soft hint:
 * we honor it where it doesn't create a conflict, otherwise we pick the first
 * non-conflicting pool session, falling back to a rest day if none fits.
 *
 * This is used both to repair the LLM's output and as the standalone fallback
 * when the LLM call fails — so behavior is identical either way.
 */
export function placeSessionsAvoidingConflicts(params: {
  days: Array<{ date: string; locked: boolean; session: RebSession | null }>;
  pool: RebSession[];
  preference?: string[];
}): { placement: Map<string, RebSession | null>; usedNames: Set<string> } {
  const { days, pool } = params;
  const prefIndex = new Map<string, number>();
  (params.preference ?? []).forEach((n, i) => {
    const k = normName(n);
    if (!prefIndex.has(k)) prefIndex.set(k, i);
  });

  // Stable sort the pool by preference order (preferred first, leftovers keep
  // their original relative order).
  const remaining = pool
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const pa = prefIndex.has(normName(a.s.day)) ? prefIndex.get(normName(a.s.day))! : Number.POSITIVE_INFINITY;
      const pb = prefIndex.has(normName(b.s.day)) ? prefIndex.get(normName(b.s.day))! : Number.POSITIVE_INFINITY;
      return pa !== pb ? pa - pb : a.i - b.i;
    })
    .map(x => x.s);

  const placement = new Map<string, RebSession | null>();
  const usedNames = new Set<string>();
  const finalized: Array<RebSession | null> = new Array(days.length).fill(null);

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (day.locked) {
      finalized[i] = day.session;
      continue;
    }
    const prev = i > 0 ? finalized[i - 1] : null;
    // Only the *next* day constrains us if it's already decided (a locked day);
    // future open slots are filled later and will avoid conflicting with us.
    const nextLocked = i + 1 < days.length && days[i + 1].locked ? days[i + 1].session : null;

    const idx = remaining.findIndex(s => !sessionsConflict(prev, s) && !sessionsConflict(s, nextLocked));
    if (idx >= 0) {
      const chosen = remaining.splice(idx, 1)[0];
      finalized[i] = chosen;
      placement.set(day.date, chosen);
      usedNames.add(chosen.day);
    } else {
      finalized[i] = null;
      placement.set(day.date, null);
    }
  }

  return { placement, usedNames };
}

/**
 * True if any two adjacent days in the ordered list share a muscle region.
 * Used in tests and as a guard before trusting any externally-supplied order.
 */
export function hasAdjacentConflict(sessions: Array<RebSession | null>): boolean {
  for (let i = 1; i < sessions.length; i++) {
    if (sessionsConflict(sessions[i - 1], sessions[i])) return true;
  }
  return false;
}

/**
 * Moving a session LATER in the week (sourceDate < date) — "I can't train
 * today, do it tomorrow". The session lands on `date`; `date`'s own session,
 * if it had one, takes `sourceDate` (a straight swap), otherwise `sourceDate`
 * becomes a rest day. Nothing else moves.
 *
 * The rebalancer in buildSwapProposal only handles pulling a session EARLIER:
 * it locks every day before the target as "past". Used for a move later, that
 * locked the source day too, so the session was added to the new day and never
 * removed from the old one — the same workout twice.
 *
 * Days before `today` and days with a logged workout are locked (never written).
 */
export function proposeMoveLater<D extends { date: string; dayLabel?: string; session?: RebSession | null }>(params: {
  weekDays: D[];
  date: string;
  sourceDate: string;
  today: string;
  loggedDates: Set<string>;
}): { proposedWeek: Array<D & { session: RebSession | null; isTrainingDay: boolean; isSwapped: boolean; locked: boolean }>; rationale: string } {
  const { weekDays, date, sourceDate, today, loggedDates } = params;
  const source = weekDays.find((d) => d.date === sourceDate);
  const target = weekDays.find((d) => d.date === date);
  const chosen = source?.session ?? null;
  if (!source || !target || !chosen) throw new Error('proposeMoveLater: source and target must be in the week, and the source must have a session');
  const displaced = target.session ?? null;

  const proposedWeek = weekDays.map((d) => {
    const locked = d.date < today || loggedDates.has(d.date);
    if (d.date === date) return { ...d, session: chosen, isTrainingDay: true, isSwapped: true, locked: false };
    if (d.date === sourceDate) return { ...d, session: displaced, isTrainingDay: !!displaced, isSwapped: true, locked: false };
    return { ...d, session: d.session ?? null, isTrainingDay: !!d.session, isSwapped: false, locked };
  });

  // Day labels repeat across two weeks, so say which Sunday when it isn't this week's.
  const label = (d: { date: string; dayLabel?: string }) => {
    const l = d.dayLabel ? d.dayLabel.charAt(0) + d.dayLabel.slice(1).toLowerCase() : d.date;
    return weekDays.findIndex((w) => w.date === d.date) >= 7 ? `next ${l}` : l;
  };
  const from = label(source);
  const to = label(target);
  const rationale = displaced
    ? `Moved ${chosen.day} from ${from} to ${to}; ${displaced.day} takes ${from} instead.`
    : `Moved ${chosen.day} from ${from} to ${to}; ${from} is now a rest day.`;
  return { proposedWeek, rationale };
}
