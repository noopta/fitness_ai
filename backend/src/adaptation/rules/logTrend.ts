// Rules: log trends → next-session plans and proposal drafts. Pure.
//
// Works with or without a program. The detectors (../detectors.ts) say what a
// lift's logs show; this file decides what to do about it and explains why in
// plain training terms:
//
//   getting easier   → add load (smallest step) — or a rep first on dumbbells /
//                      machines, where one step is a big jump (double progression)
//   steady           → hold, or add a rep / set depending on the phase
//   plateau          → escalation ladder: low volume → +2 sets; high volume +
//                      high RPE → deload; else rep-range change → frequency 2×/wk
//                      → a close variation
//   single-lift dip  → reset ~10% and build back; suggest a form check
//   time off         → resume ~90% and ramp over two sessions
//   early fatigue    → drop a set, keep the load
//   several lifts    → one deload week (volume −40–50%, intensity kept)
//   volume per muscle→ volume_balance (advisory)
//
// The phase (contract 6) colours every decision: in a cut, flat strength is a
// win, not a plateau; building muscle favours sets/reps; building strength
// favours load; rebuilding consistency only resumes and ramps.
//
// Nothing here writes anything. planForSignal also powers the "suggestion"
// line on the log sheet, so a card and the sheet never disagree.

import { classifyLoad, loadForReps, nextLoad, roundToIncrement } from '../targets.js';
import { formatWeight, type UnitPreference } from '../../services/weightUnits.js';
import {
  detectLiftSignal, detectSystemicFatigue, detectVolumeBalance, weeklySetsByMuscle, daysBetween, dateStr,
  type LiftSignal, type WellnessPoint, type SystemicFatigue, type VolumeFinding,
} from '../detectors.js';
import type { EvidenceLine, Exposure, ProposalDraft, SuggestionAction, TrainingPhase, NextSessionPayload } from '../types.js';

export function fmtKg(kg: number | null | undefined, pref: UnitPreference): string {
  return kg == null ? 'bodyweight' : (formatWeight(kg, pref, pref === 'metric' ? 1 : 0) ?? '—');
}

export interface NextPlan {
  action: SuggestionAction;
  toWeightKg: number | null;
  reps: string;
  sets: number;
  rpe: number | null;
  /** One line for the log sheet. */
  note: string;
  strategy?: string;
  /** Worth a proposal card (vs only the sheet's suggestion line). */
  worthy: boolean;
  /** Card copy — only meaningful when worthy. */
  title: string;
  reasoning: string;
  priority: number;
  /** A plateau that should become a deload card instead of next_session. */
  deload?: { reason: 'plateau_high_volume'; volumeCutPct: number };
}

export interface PlanOpts {
  phase?: TrainingPhase;
  /** How many plateau proposals this lift has already had (ladder step). */
  plateauStep?: number;
}

/** A close variation that changes the stimulus without changing the pattern. */
export function variationFor(name: string): string {
  const s = name.toLowerCase();
  if (/bench/.test(s)) return 'paused or close-grip bench';
  if (/front squat/.test(s)) return 'pause front squat';
  if (/squat/.test(s)) return 'pause squat or front squat';
  if (/deadlift|rdl|romanian/.test(s)) return 'paused or deficit deadlift';
  if (/overhead|ohp|shoulder press|military/.test(s)) return 'push press or seated dumbbell press';
  if (/row/.test(s)) return 'chest-supported row';
  if (/pull[- ]?up|chin|pulldown/.test(s)) return 'a different grip (neutral or chin-up)';
  if (/curl/.test(s)) return 'incline or hammer curl';
  return 'a close variation (grip, tempo or implement)';
}

const PHASE_LABEL: Record<TrainingPhase, string> = {
  building_strength: 'building strength',
  cutting: 'cutting',
  cut_too_aggressive: 'in a steep cut',
  building_muscle: 'building muscle',
  recomp: 'recomping',
  plateau: 'in a plateau',
  rebuilding_consistency: 'rebuilding consistency',
  unknown: '',
};

function setLine(e: Exposure, pref: UnitPreference): string {
  const loaded = e.sets.filter(s => s.weightKg != null);
  const reps = loaded.map(s => s.reps).join(', ');
  return `${fmtKg(e.top?.weightKg ?? null, pref)} × ${reps}${e.top?.rpe != null ? ` @ RPE ${e.top.rpe}` : ''}`;
}

function hold(sig: LiftSignal, note: string, worthy: boolean, title: string, reasoning: string, priority = 20): NextPlan {
  return {
    action: 'hold', toWeightKg: sig.lastLoadKg, reps: String(sig.lastReps), sets: sig.lastSets, rpe: sig.lastRpe,
    note, worthy, title, reasoning, priority,
  };
}

/**
 * The next session for one lift, given what its logs show. Always returns a
 * plan (the sheet always has something to say); `worthy` decides whether it
 * becomes a card.
 */
export function planForSignal(sig: LiftSignal, pref: UnitPreference, opts: PlanOpts = {}): NextPlan {
  const phase = opts.phase ?? 'unknown';
  const name = sig.name;
  const L = sig.lastLoadKg;
  const r = sig.lastReps;
  const n = Math.max(1, sig.lastSets);
  const rpe = sig.lastRpe;
  const cls = classifyLoad(name);
  const cutting = phase === 'cutting' || phase === 'cut_too_aggressive';
  const rebuilding = phase === 'rebuilding_consistency';
  const repeat = (): NextPlan => ({
    action: 'repeat', toWeightKg: L, reps: String(r), sets: n, rpe,
    note: `Match last session: ${fmtKg(L, pref)} × ${r}`, worthy: false, title: '', reasoning: '', priority: 0,
  });

  switch (sig.kind) {
    case 'detraining': {
      const ref = sig.refLoadKg ?? L ?? 0;
      const step = (sig.postGapSessions ?? 0) <= 1 ? 0.9 : 0.95;
      let to = roundToIncrement(ref * step, name, pref);
      if (L != null && to <= L) to = Math.min(roundToIncrement(ref, name, pref), nextLoad(L, name, pref));
      return {
        action: 'resume', toWeightKg: to, reps: String(r), sets: n, rpe: null,
        note: `Coming back from ${sig.gapDays} days off — ${fmtKg(to, pref)} × ${r}, then back to ${fmtKg(ref, pref)}`,
        worthy: true, priority: 60,
        title: `Ease back into ${name}`,
        reasoning: `You had ${sig.gapDays} days away from ${name}, so the lower numbers are detraining, not a stall — strength comes back far faster than it was first built. Start around ${Math.round(step * 100)}% of where you left off (${fmtKg(ref, pref)}) and ramp back over two sessions rather than testing the old weight cold.`,
      };
    }
    case 'decline': {
      if (L == null) return repeat();
      if (phase === 'cut_too_aggressive' || rebuilding) {
        return hold(sig, `Hold ${fmtKg(L, pref)} × ${r} — recovery is the limiter right now`, false, '', '');
      }
      const to = roundToIncrement(L * 0.9, name, pref);
      const pct = Math.round((sig.dropPct ?? 0) * 100);
      return {
        action: 'reset', toWeightKg: to, reps: String(r), sets: n, rpe: 7,
        note: `Reset to ${fmtKg(to, pref)} × ${r} and build back`,
        worthy: true, priority: 70,
        title: `${name} has slipped — reset and rebuild`,
        reasoning: `Your best ${name} set has dropped about ${pct}% over the last few weeks${cutting ? ' — not unusual in a calorie deficit' : ''}. Grinding at a weight that's moving backwards usually digs the hole deeper. Dropping ~10% and building back with clean reps (RPE ~7) lets you overshoot the old number within a few weeks. If it keeps sliding, film a set — a form check often finds the leak.`,
      };
    }
    case 'early_fatigue': {
      const sets = Math.max(2, n - 1);
      if (rebuilding) return hold(sig, `Hold ${fmtKg(L, pref)} × ${r}`, false, '', '');
      const why = sig.rpeBased
        ? `RPE at ${fmtKg(L, pref)} has crept up by ${sig.rpeDelta} over the last ${sig.chainLength} sessions with no extra reps`
        : `your reps are falling off more across the sets than they used to (${Math.round((sig.dropOff ?? 0) * 100)}% from first to last set)`;
      return {
        action: 'drop_set', toWeightKg: L, reps: String(r), sets, rpe: rpe != null ? Math.min(rpe, 8) : null,
        note: `Same load, one fewer set: ${sets} × ${r} at ${fmtKg(L, pref)}`,
        worthy: true, priority: 55,
        title: `${name} is starting to feel heavier`,
        reasoning: `On ${name}, ${why}. That's early fatigue — the same work costing more. RPE autoregulation says keep the load (so strength is maintained) and trim one set so recovery catches up, before it turns into a real decline.`,
      };
    }
    case 'easier': {
      if (L == null) return repeat();
      if (rebuilding) return hold(sig, `Hold ${fmtKg(L, pref)} × ${r} — consistency first`, false, '', '');
      const clearly = sig.rpeBased || (sig.repsDelta ?? 0) >= 2;
      if (cutting && !clearly) {
        return hold(sig, `Hold ${fmtKg(L, pref)} × ${r} — keeping strength in a cut is the win`, false, '', '');
      }
      const why = sig.rpeBased
        ? `the same ${fmtKg(L, pref)} × ${r} went from RPE ${Math.round(((rpe ?? 0) - (sig.rpeDelta ?? 0)) * 10) / 10} to RPE ${rpe} over ${sig.chainLength} sessions`
        : `you've added ${sig.repsDelta} rep${sig.repsDelta === 1 ? '' : 's'} at ${fmtKg(L, pref)} over ${sig.chainLength} sessions`;
      const wantsReps = phase === 'building_muscle' ? r < 12 : (cls === 'dumbbell' || cls === 'machine') && (sig.repsDelta ?? 0) < 2 && phase !== 'building_strength';
      if (wantsReps) {
        return {
          action: 'add_rep', toWeightKg: L, reps: String(r + 1), sets: n, rpe,
          note: `Getting easier — same ${fmtKg(L, pref)}, aim for ${r + 1} reps`,
          worthy: true, priority: 45,
          title: `${name} is getting easier`,
          reasoning: `${capitalize(why)}. Double progression: add reps at the same weight first${cls !== 'barbell' ? ` — one load step on ${cls === 'dumbbell' ? 'dumbbells' : 'a machine'} is a big jump` : ''}, then add load once the reps are there. That's progressive overload without a jump you can't recover from.`,
        };
      }
      const to = nextLoad(L, name, pref);
      const repsTo = (sig.repsDelta ?? 0) >= 2 ? Math.max(5, r - 2) : r;
      return {
        action: 'add_load', toWeightKg: to, reps: String(repsTo), sets: n, rpe: rpe != null ? Math.max(rpe, 7) : null,
        note: `Last ${sig.chainLength} sessions felt easier at ${fmtKg(L, pref)} × ${r} — try ${fmtKg(to, pref)}`,
        worthy: true, priority: 45,
        title: `${name} is getting easier`,
        reasoning: `${capitalize(why)}. That's reps in reserve you aren't using. Progressive overload says add the smallest step — ${fmtKg(to - L, pref)} — ${repsTo < r ? `and let reps settle back to ${repsTo} before building them again (double progression)` : 'and keep the reps'}.${phase === 'building_strength' ? ' You\'re building strength, so load is the lever.' : ''}`,
      };
    }
    case 'plateau': {
      if (L == null) return repeat();
      if (cutting) {
        return hold(sig, `Holding ${fmtKg(L, pref)} × ${r} in a cut is a win`, true,
          `Holding ${name} steady in a cut`,
          `Your ${name} has held at ${fmtKg(L, pref)} × ${r} for ${sig.spark.length} weeks while you're ${PHASE_LABEL[phase]}. In a calorie deficit, keeping strength IS progress — it means you're keeping muscle while losing fat. Hold the load, keep the reps crisp, and don't chase PRs until you're back at maintenance.`, 25);
      }
      if (rebuilding) return hold(sig, `Hold ${fmtKg(L, pref)} × ${r}`, false, '', '');
      const weeks = sig.spark.length;
      // Rung 1 — low volume: more hard sets is the cheapest stimulus.
      if (sig.weeklySets < 6) {
        const add = sig.sessionsPerWeek >= 1.5 ? 1 : 2;
        const sets = Math.min(8, n + add);
        return {
          action: 'add_set', toWeightKg: L, reps: String(r), sets, rpe, strategy: 'volume',
          note: `Stalled at low volume — ${sets} sets of ${r} at ${fmtKg(L, pref)}`,
          worthy: true, priority: 50,
          title: `${name} has stalled — add volume`,
          reasoning: `Your best ${name} set has been flat for ${weeks} weeks on about ${sig.weeklySets} hard sets a week. The volume dose-response is strongest at the low end: two more hard sets a week is usually enough to get a stalled lift moving again, without changing anything else.`,
        };
      }
      // Rung 2 — high volume and grinding: the stall is fatigue, not stimulus.
      if (sig.weeklySets >= 10 && (sig.avgTopRpe ?? 0) >= 8.5) {
        return {
          action: 'deload', toWeightKg: L, reps: String(r), sets: Math.max(1, Math.round(n * 0.5)), rpe: 7,
          note: `Deload week — same load, half the sets`,
          worthy: true, priority: 55, deload: { reason: 'plateau_high_volume', volumeCutPct: 50 },
          title: `${name} has stalled under a lot of work`,
          reasoning: `${name} has been flat for ${weeks} weeks at ${sig.weeklySets} sets a week with top sets averaging RPE ${sig.avgTopRpe}. That's fatigue masking fitness. A one-week deload — same weights, about half the sets — lets it dissipate; lifters usually come back stronger the week after.`,
        };
      }
      // Rung 3+ — change the stimulus.
      const ladder: string[] = ['rep_range'];
      if (sig.sessionsPerWeek < 1.5) ladder.push('frequency');
      ladder.push('variation');
      const strategy = ladder[Math.min(opts.plateauStep ?? 0, ladder.length - 1)];
      if (strategy === 'rep_range') {
        const lighter = phase === 'building_muscle' || r <= 5;
        const repsTo = lighter ? 10 : 5;
        const to = roundToIncrement(loadForReps(sig.lastE1rmKg, repsTo, 8), name, pref);
        return {
          action: to > L ? 'add_load' : 'reset', toWeightKg: to, reps: lighter ? '10-12' : '4-6', sets: n, rpe: 8, strategy,
          note: `Stalled — switch to ${lighter ? '10–12' : '4–6'} reps at ${fmtKg(to, pref)}`,
          worthy: true, priority: 50,
          title: `${name} has stalled — change the rep range`,
          reasoning: `${name} has been flat for ${weeks} weeks at ${fmtKg(L, pref)} × ${r}. Volume isn't the problem (${sig.weeklySets} sets a week), so change the stimulus: a ${lighter ? 'lighter, higher-rep block builds work capacity and muscle' : 'heavier, lower-rep block trains the strength side'} for 3–4 weeks, then come back to ${r}s. Same lift, new adaptation — progressive overload by a different route.`,
        };
      }
      if (strategy === 'frequency') {
        return {
          action: 'add_set', toWeightKg: L, reps: String(r), sets: n, rpe, strategy,
          note: `Stalled — train ${name} twice a week`,
          worthy: true, priority: 50,
          title: `${name} has stalled — train it twice a week`,
          reasoning: `${name} has been flat for ${weeks} weeks and you train it about ${sig.sessionsPerWeek}× a week. Splitting the same weekly sets over two sessions means fresher, higher-quality sets — more practice on the pattern without more total fatigue.`,
        };
      }
      const v = variationFor(name);
      return {
        action: 'hold', toWeightKg: L, reps: String(r), sets: n, rpe, strategy: 'variation', note: `Stalled — swap in ${v} for 3–4 weeks`,
        worthy: true, priority: 50,
        title: `${name} has stalled — try a variation`,
        reasoning: `${name} has been flat for ${weeks} weeks and changing the reps and frequency hasn't moved it. A close variation (${v}) for 3–4 weeks hits the weak point from a new angle; the main lift usually jumps when you come back to it.`,
      };
    }
    case 'steady': {
      if (L == null) return repeat();
      if (rebuilding) return hold(sig, `Hold ${fmtKg(L, pref)} × ${r} — showing up is the win`, false, '', '');
      if (cutting) return hold(sig, `Holding ${fmtKg(L, pref)} × ${r} in a cut is a win`, false, '', '');
      const strong = sig.chainLength >= 3;
      if (phase === 'building_strength') {
        const to = nextLoad(L, name, pref);
        return {
          action: 'add_load', toWeightKg: to, reps: String(r), sets: n, rpe: 8,
          note: `Steady at ${fmtKg(L, pref)} × ${r} — try ${fmtKg(to, pref)}`,
          worthy: strong, priority: 20,
          title: `Room to add weight on ${name}`,
          reasoning: `You've held ${fmtKg(L, pref)} × ${r} at RPE ${rpe ?? '7–8'} for ${sig.chainLength} sessions — two or three reps in reserve. You're building strength, so the smallest load step is the next move.`,
        };
      }
      if (phase === 'building_muscle' && n < 5) {
        return {
          action: 'add_set', toWeightKg: L, reps: String(r), sets: n + 1, rpe,
          note: `Steady — add a set: ${n + 1} × ${r} at ${fmtKg(L, pref)}`,
          worthy: strong, priority: 20,
          title: `Add a set on ${name}`,
          reasoning: `You've held ${fmtKg(L, pref)} × ${r} comfortably for ${sig.chainLength} sessions. For muscle, more hard sets is the main driver (volume dose-response) — one more set a session is a clean next step.`,
        };
      }
      return {
        action: 'add_rep', toWeightKg: L, reps: String(r + 1), sets: n, rpe,
        note: `Steady at ${fmtKg(L, pref)} × ${r} — go for ${r + 1}`,
        worthy: strong && sig.rpeBased, priority: 15,
        title: `${name}: go for one more rep`,
        reasoning: `${fmtKg(L, pref)} × ${r} has held at RPE ${rpe ?? '7–8'} for ${sig.chainLength} sessions. Double progression: add a rep at the same weight; once every set reaches ${r + 2}, add load.`,
      };
    }
    case 'progressing': {
      if (L == null) return repeat();
      return {
        action: 'repeat', toWeightKg: L, reps: String(r), sets: n, rpe,
        note: `Trending up ${sig.pctPerWeek}%/wk — match or beat ${fmtKg(L, pref)} × ${r}`,
        worthy: false, title: '', reasoning: '', priority: 0,
      };
    }
    default:
      return repeat();
  }
}

function capitalize(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ─── Drafts ──────────────────────────────────────────────────────────────────

export const LOG_TREND_KINDS = ['next_session', 'deload', 'volume_balance', 'phase_confirm', 'calorie_adjust'] as const;

export function liftDedupeKey(key: string): string { return `lift:${key}`; }

function evidenceFor(sig: LiftSignal, pref: UnitPreference): EvidenceLine[] {
  const lines: EvidenceLine[] = sig.window.slice(0, 3).reverse().map(e => ({ label: e.date, value: setLine(e, pref) }));
  if (sig.kind === 'detraining' && sig.refLoadKg != null) lines.push({ label: 'Before the break', value: `${fmtKg(sig.refLoadKg, pref)} · ${sig.gapDays} days off` });
  if (sig.kind === 'plateau' || sig.kind === 'decline' || sig.kind === 'progressing') {
    lines.push({ label: 'Weekly best (e1RM)', value: sig.spark.slice(-6).map(v => fmtKg(v, pref)).join(' → ') });
  }
  if (sig.kind === 'plateau') lines.push({ label: 'Hard sets / week', value: String(sig.weeklySets) });
  if (!sig.rpeBased && sig.kind !== 'detraining') lines.push({ label: 'RPE', value: 'not logged — logging it sharpens these' });
  return lines;
}

export function nextSessionDraft(sig: LiftSignal, plan: NextPlan, pref: UnitPreference): ProposalDraft {
  if (plan.deload) {
    return {
      kind: 'deload', dedupeKey: liftDedupeKey(sig.key), title: plan.title,
      evidence: evidenceFor(sig, pref), reasoning: plan.reasoning,
      proposal: { kind: 'deload', keys: [sig.key], exercises: [sig.name], volumeCutPct: plan.deload.volumeCutPct, weeks: 1, reason: plan.deload.reason },
      confidence: sig.confidence, priority: plan.priority,
    };
  }
  const proposal: NextSessionPayload = {
    kind: 'next_session', key: sig.key, exercise: sig.name, action: plan.action,
    fromWeightKg: sig.lastLoadKg, toWeightKg: plan.toWeightKg, reps: plan.reps, sets: plan.sets, rpe: plan.rpe,
    signal: sig.kind, ...(plan.strategy ? { strategy: plan.strategy } : {}), note: plan.note,
  };
  return {
    kind: 'next_session', dedupeKey: liftDedupeKey(sig.key), title: plan.title,
    evidence: evidenceFor(sig, pref), reasoning: plan.reasoning, proposal,
    confidence: sig.confidence, priority: plan.priority,
  };
}

export function systemicDeloadDraft(f: SystemicFatigue, alsoKeys: Array<{ key: string; name: string }>, pref: UnitPreference): ProposalDraft {
  const cut = f.wellnessFlags.length ? 50 : 40;
  const keys = new Map<string, string>();
  for (const l of f.lifts) keys.set(l.key, l.name);
  for (const k of alsoKeys) if (!keys.has(k.key)) keys.set(k.key, k.name);
  const evidence: EvidenceLine[] = f.lifts.map(l => ({
    label: l.name,
    value: l.kind === 'decline'
      ? `best set down ${Math.round((l.dropPct ?? 0) * 100)}%`
      : l.rpeBased ? `RPE up ${l.rpeDelta} at ${fmtKg(l.lastLoadKg, pref)}` : 'reps falling off across sets',
  }));
  for (const w of f.wellnessFlags) evidence.push({ label: 'Recovery', value: w });
  return {
    kind: 'deload', dedupeKey: 'deload:systemic',
    title: 'Several lifts are dipping at once — take a lighter week',
    evidence,
    reasoning: `${f.lifts.length} lifts are sliding or feeling heavier at the same time${f.wellnessFlags.length ? `, and ${f.wellnessFlags.join(' and ')}` : ''}. When everything dips together the cause is recovery, not any one lift. A deload — keep the weights, cut the sets by about ${cut}% for one week — clears the fatigue while holding on to strength. Expect to feel noticeably better the week after.`,
    proposal: { kind: 'deload', keys: [...keys.keys()], exercises: [...keys.values()], volumeCutPct: cut, weeks: 1, reason: 'systemic_fatigue' },
    confidence: f.confidence,
    priority: 90,
  };
}

export function volumeDraft(v: VolumeFinding): ProposalDraft {
  const muscle = v.muscle;
  const title = v.direction === 'add' ? `More ${muscle} work would pay off`
    : v.direction === 'reduce' ? `${capitalize(muscle)} volume is past the useful range`
    : `Balance pushing and pulling`;
  const reasoning = v.direction === 'add'
    ? `${v.note} Volume dose-response: growth tracks weekly hard sets up to a point, and ~10 is where most people see steady progress. Add a couple of sets for ${muscle} across the week.`
    : v.direction === 'reduce'
    ? `${v.note} Trimming back to ~${v.suggestedSets} usually keeps the gains and frees up recovery for everything else.`
    : `${v.note} Bring ${muscle} up to about ${v.suggestedSets} hard sets a week — the goal is roughly even push and pull.`;
  return {
    kind: 'volume_balance', dedupeKey: `volume:${muscle}:${v.direction}`, title,
    evidence: [
      { label: `${capitalize(muscle)} sets / week`, value: String(v.currentSets) },
      { label: 'Suggested', value: String(v.suggestedSets) },
    ],
    reasoning,
    proposal: { kind: 'volume_balance', muscle, currentSets: v.currentSets, suggestedSets: v.suggestedSets, direction: v.direction, note: v.note },
    confidence: 0.6,
    priority: 30,
  };
}

// ─── Orchestration (pure) ────────────────────────────────────────────────────

export interface LogTrendInput {
  exposuresByKey: Map<string, Exposure[]>;
  unitPref: UnitPreference;
  now: Date;
  phase: TrainingPhase;
  wellness: WellnessPoint[];
  /** Per-lift rules only for these keys (post-workout). Omit = every lift active in 21 days. */
  keys?: Set<string>;
  /** Keys already covered by another rule this run (e.g. doubleProgression). */
  skipKeys?: Set<string>;
  /** Plateau ladder step per key. */
  plateauSteps?: Map<string, number>;
  /** Which per-lift signals may become cards. Omit = all. */
  liftKinds?: Set<string>;
  systemic?: boolean;
  volume?: boolean;
}

export function signalsFor(exposuresByKey: Map<string, Exposure[]>, now: Date, activeDays = 21): LiftSignal[] {
  const today = dateStr(now);
  const out: LiftSignal[] = [];
  for (const list of exposuresByKey.values()) {
    if (!list.length || daysBetween(today, list[0].date) > activeDays) continue;
    out.push(detectLiftSignal(list, now));
  }
  return out;
}

/** Every log-trend draft for one run, highest priority first. */
export function buildLogTrendDrafts(input: LogTrendInput): ProposalDraft[] {
  const pref = input.unitPref;
  const signals = signalsFor(input.exposuresByKey, input.now);
  const drafts: ProposalDraft[] = [];
  const covered = new Set<string>(input.skipKeys ?? []);

  if (input.systemic !== false) {
    const sys = detectSystemicFatigue(signals, input.wellness, input.now);
    const touches = !input.keys || sys?.lifts.some(l => input.keys!.has(l.key));
    if (sys && touches && input.phase !== 'rebuilding_consistency') {
      const today = dateStr(input.now);
      const also = signals.filter(s => s.lastDate && daysBetween(today, s.lastDate) <= 10).map(s => ({ key: s.key, name: s.name }));
      const d = systemicDeloadDraft(sys, also, pref);
      drafts.push(d);
      for (const k of (d.proposal as any).keys as string[]) covered.add(k);
    }
  }

  for (const sig of signals) {
    if (input.keys && !input.keys.has(sig.key)) continue;
    if (covered.has(sig.key)) continue;
    if (input.liftKinds && !input.liftKinds.has(sig.kind)) continue;
    const plan = planForSignal(sig, pref, { phase: input.phase, plateauStep: input.plateauSteps?.get(sig.key) ?? 0 });
    if (!plan.worthy) continue;
    drafts.push(nextSessionDraft(sig, plan, pref));
  }

  if (input.volume) {
    const findings = detectVolumeBalance(weeklySetsByMuscle(input.exposuresByKey, input.now));
    // One volume card at a time — the most out-of-band muscle.
    if (findings[0]) drafts.push(volumeDraft(findings[0]));
  }
  return drafts.sort((a, b) => b.priority - a.priority);
}

