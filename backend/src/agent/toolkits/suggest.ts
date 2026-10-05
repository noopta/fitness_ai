// "What should I do today?" without a program (WRK-10). Builds a one-off
// session from the user's own history: which regions are rested and due
// (push / pull / legs recency + the muscle ledger's neglected muscles), which
// of their usual lifts are due, and per-lift numbers from the adaptation
// engine's next-session suggestion (contract 1) — falling back to what they
// did last time. Equipment and injuries (coachProfile AND constraintsText —
// injury text lives in both) filter the picks. Deterministic; the model only
// words the plan. Read-only.

import { registerToolkit } from '../registry.js';
import { tool, schema, str, numOr, prisma } from './kit.js';
import { weight, dayLabel } from '../cards/format.js';
import { SEED } from '../../services/exerciseCanonical.js';
import { buildMuscleLedger, type MuscleLedger } from '../../services/muscleLedgerService.js';
import { muscleWeightsFor, type MuscleGroup } from '../../data/muscleAttribution.js';
import { toLedgerExercises } from '../../services/liftCanonical.js';
import { loadTrainingHistory, type TrainingHistory } from '../../services/trainingSummary.js';
import { daysFrom } from '../../adaptation/detectors.js';
import { freestyleAvailableFor, logAdaptationAvailableFor } from '../../services/featureFlags.js';
import { readProfile } from '../profile/coachProfile.js';
import type { Exposure } from '../../adaptation/types.js';
import type { Suggestion } from '../../adaptation/suggestion.js';

export type Region = 'push' | 'pull' | 'legs';
export type Theme = 'push' | 'pull' | 'legs' | 'upper' | 'full_body';
const THEME_REGIONS: Record<Theme, Region[]> = { push: ['push'], pull: ['pull'], legs: ['legs'], upper: ['push', 'pull'], full_body: ['push', 'pull', 'legs'] };
const THEME_LABEL: Record<Theme, string> = { push: 'Push · chest, shoulders, triceps', pull: 'Pull · back, biceps', legs: 'Legs', upper: 'Upper body', full_body: 'Full body' };
const REGION_WORD: Record<Region, string> = { push: 'Push', pull: 'Pull', legs: 'Legs' };

function regionOf(category: string | null | undefined): Region | null {
  if (category === 'push' || category === 'pull') return category;
  if (category === 'legs' || category === 'hinge') return 'legs';
  return null;
}

const MUSCLE_REGION: Partial<Record<MuscleGroup, Region>> = {
  Chest: 'push', 'Front Delt': 'push', 'Lateral Delt': 'push', Triceps: 'push',
  Lats: 'pull', 'Mid-back': 'pull', 'Rear Delt': 'pull', Biceps: 'pull',
  Quads: 'legs', Glutes: 'legs', Hamstrings: 'legs', Adductors: 'legs', Calves: 'legs',
};

// ── Constraints ──────────────────────────────────────────────────────────────
const BARBELL = /\b(barbell|bb|ez[- ]?bar|trap bar|smith)\b|^(bench press|incline bench press|decline bench press|close[- ]grip bench press|squat|back squat|front squat|deadlift|sumo deadlift|romanian deadlift|overhead press|seated overhead press|barbell row|bent[- ]over row|pendlay row|good morning|hip thrust|power clean|clean|snatch)$/i;
const MACHINE = /\b(machine|cable|pulldown|pull[- ]down|leg press|hack squat|pec deck|leg extension|leg curl|smith|lat pull|seated row)\b/i;

/** Equipment the user has → a reason the exercise is out, or null. */
export function equipmentConflict(name: string, equipment: string | null | undefined): string | null {
  const e = String(equipment ?? '').toLowerCase();
  if (!e || e === 'commercial' || /full|commercial|gym/.test(e) && !/home|limited|dumbbell/.test(e)) return null;
  if (e === 'limited' || /limited|dumbbell|band/.test(e)) {
    if (BARBELL.test(name) || MACHINE.test(name)) return 'needs equipment you don’t have';
    return null;
  }
  if (e === 'home' || /home/.test(e)) return MACHINE.test(name) ? 'needs a machine or cable' : null;
  return null;
}

const INJURY_AREAS: Array<{ area: string; match: RegExp; loads: RegExp }> = [
  { area: 'knee', match: /knee|acl|mcl|menisc|patell/i, loads: /squat|lunge|leg extension|leg press|step[- ]?up|jump/i },
  { area: 'shoulder', match: /shoulder|rotator|labrum|ac joint/i, loads: /overhead|military|shoulder press|arnold|dip|upright row|bench press|incline|lateral raise|front raise|snatch|jerk|push[- ]?up/i },
  { area: 'lower back', match: /\bback\b|spine|disc|lumbar|sciatic/i, loads: /deadlift|good morning|bent[- ]over row|barbell row|pendlay|^squat$|back squat|clean|snatch|hyperextension/i },
  { area: 'elbow', match: /elbow|tendinit|epicondyl/i, loads: /skull|triceps extension|overhead extension|close[- ]grip|dip|curl/i },
  { area: 'wrist', match: /wrist/i, loads: /front squat|clean|push[- ]?up|curl/i },
  { area: 'hip', match: /\bhip\b|groin|adductor/i, loads: /squat|deadlift|lunge|hip thrust|split/i },
  { area: 'neck', match: /neck|cervical/i, loads: /shrug|upright row|overhead|military/i },
];

/** Injury text → areas, and a matcher that says which area an exercise loads. */
export function injuryAreas(text: string): string[] {
  return INJURY_AREAS.filter((a) => a.match.test(text)).map((a) => a.area);
}
export function injuryConflict(name: string, areas: string[]): string | null {
  for (const a of INJURY_AREAS) if (areas.includes(a.area) && a.loads.test(name)) return `loads your ${a.area}`;
  return null;
}

// ── Planning (pure) ──────────────────────────────────────────────────────────
export interface RegionStatus { region: Region; lastDate: string | null; daysSince: number | null; sets14: number }
export interface SessionPick { key: string; name: string; region: Region; isCompound: boolean; lastDate: string | null; daysSince: number | null; last: Exposure | null; fromLibrary: boolean }
export interface SessionPlan {
  theme: Theme;
  label: string;
  why: string[];
  regions: RegionStatus[];
  picks: SessionPick[];
  neglected: string[];
  excluded: Array<{ name: string; reason: string }>;
  light: boolean;
  insufficientHistory: boolean;
}

export interface PlanInput {
  history: TrainingHistory;
  today: string;
  focus?: string | null;
  maxExercises?: number;
  equipment?: string | null;
  injuryText?: string;
  ledger?: MuscleLedger | null;
}

function themeFromFocus(focus: string): Theme | null {
  const f = focus.toLowerCase();
  if (/full|whole|total/.test(f)) return 'full_body';
  if (/upper|arm/.test(f)) return 'upper';
  if (/lower|leg|glute|quad|hamstring/.test(f)) return 'legs';
  if (/push|chest|shoulder|tricep/.test(f)) return 'push';
  if (/pull|back|bicep|lat/.test(f)) return 'pull';
  return null;
}

export function planSession(input: PlanInput): SessionPlan {
  const { history: h, today } = input;
  const max = Math.max(3, Math.min(8, Math.round(input.maxExercises ?? 5)));
  const areas = injuryAreas(input.injuryText ?? '');
  const excluded: Array<{ name: string; reason: string }> = [];
  const conflict = (name: string) => equipmentConflict(name, input.equipment) ?? injuryConflict(name, areas);
  const from14 = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 13); return d.toISOString().slice(0, 10); })();
  const from56 = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 56); return d.toISOString().slice(0, 10); })();

  // Region recency + recent volume.
  const status = new Map<Region, RegionStatus>((['push', 'pull', 'legs'] as Region[]).map((r) => [r, { region: r, lastDate: null, daysSince: null, sets14: 0 }]));
  const candidates: Array<SessionPick & { freq8: number }> = [];
  for (const [key, list] of h.exposures) {
    const region = regionOf(h.meta(key)?.category);
    if (!region) continue;
    const past = list.filter((e) => e.date <= today);
    if (!past.length) continue;
    const st = status.get(region)!;
    if (!st.lastDate || past[0].date > st.lastDate) st.lastDate = past[0].date;
    st.sets14 += past.filter((e) => e.date >= from14).reduce((n, e) => n + e.sets.length, 0);
    const name = h.displayName(key);
    candidates.push({
      key, name, region, isCompound: !!h.meta(key)?.isCompound, lastDate: past[0].date,
      daysSince: daysFrom(past[0].date, today), last: past[0], fromLibrary: false,
      freq8: past.filter((e) => e.date >= from56).length,
    });
  }
  for (const st of status.values()) st.daysSince = st.lastDate ? daysFrom(st.lastDate, today) : null;
  const regions = [...status.values()];
  const insufficientHistory = h.workouts.filter((w) => w.date <= today).length < 2 || candidates.length === 0;

  // Theme: the user's focus, else what's rested and due.
  const rest = (s: RegionStatus) => (s.daysSince == null ? 1e6 : s.daysSince);
  const sorted = [...regions].sort((a, b) => rest(b) - rest(a) || a.sets14 - b.sets14);
  const rested = sorted.filter((s) => s.daysSince == null || s.daysSince >= 2);
  const why: string[] = [];
  let theme: Theme;
  let light = false;
  const focusTheme = str(input.focus) ? themeFromFocus(str(input.focus)) : null;
  if (focusTheme) {
    theme = focusTheme;
    why.push(`You asked for ${THEME_LABEL[theme].split(' · ')[0].toLowerCase()}.`);
  } else if (insufficientHistory) {
    theme = 'full_body';
    why.push('Not enough logged sessions to read a pattern yet, so a full-body session covers everything.');
  } else if (rested.length === 0) {
    theme = sorted[0].region;
    light = true;
    why.push('Everything was trained in the last 48 hours — keep today light.');
  } else if (rested.length === 3 && rested.every((s) => s.daysSince == null || s.daysSince >= 3)) {
    theme = 'full_body';
  } else {
    const primary = rested[0].region;
    const pair: Region | null = primary === 'push' ? 'pull' : primary === 'pull' ? 'push' : null;
    theme = pair && rested.some((s) => s.region === pair) ? 'upper' : primary;
  }
  for (const s of sorted) {
    const word = REGION_WORD[s.region];
    why.push(s.daysSince == null ? `${word}: not logged yet.` : s.daysSince <= 1 ? `${word}: trained ${s.daysSince === 0 ? 'today' : 'yesterday'} — resting it.` : `${word}: last trained ${s.daysSince} days ago (${s.sets14} sets in 14 days).`);
  }
  const want = new Set(THEME_REGIONS[theme]);

  // Neglected muscles (ledger) in today's regions first.
  const neglectedMuscles: MuscleGroup[] = [];
  for (const e of Object.values(input.ledger?.entries ?? {})) {
    if (!e || e.confidence < 0.3) continue;
    const r = MUSCLE_REGION[e.muscle];
    if (!r || !want.has(r)) continue;
    if ((e.lastTrainedDaysAgo ?? 99) > 10 || e.weeklyHardSets < 2) neglectedMuscles.push(e.muscle);
  }
  const hitsNeglected = (name: string) => Object.keys(muscleWeightsFor(name)).some((m) => neglectedMuscles.includes(m as MuscleGroup));

  // Candidate order: their staples first (most sessions in 8 weeks), and among
  // equals the one that's most overdue. Compounds lead in the selection below.
  const pool = candidates.filter((c) => want.has(c.region)).filter((c) => {
    const reason = conflict(c.name);
    if (reason) excluded.push({ name: c.name, reason });
    return !reason;
  }).sort((a, b) => b.freq8 - a.freq8 || (b.daysSince ?? 0) - (a.daysSince ?? 0));

  const picks: SessionPick[] = [];
  const take = (c: SessionPick | undefined) => { if (c && picks.length < max && !picks.some((p) => p.key === c.key)) picks.push(c); };
  const compoundCap = Math.ceil(max / 2);
  for (const r of THEME_REGIONS[theme]) take(pool.find((c) => c.region === r && c.isCompound));
  for (const c of pool.filter((x) => x.isCompound)) if (picks.filter((p) => p.isCompound).length < compoundCap) take(c);
  for (const c of pool.filter((x) => !x.isCompound && hitsNeglected(x.name))) take(c);
  for (const r of THEME_REGIONS[theme]) take(pool.find((c) => c.region === r && !c.isCompound && !picks.some((p) => p.key === c.key)));
  for (const c of pool) take(c);

  // Thin history: fill from the library (no numbers — calibrate).
  const minPicks = Math.min(max, theme === 'full_body' ? 4 : 3);
  if (picks.length < minPicks) {
    const seen = new Set(picks.map((p) => p.name.toLowerCase()));
    const lib = [...new Map(Object.values(SEED).map((v) => [v.canonicalName, v])).values()]
      .filter((v) => { const r = regionOf(v.category); return r && want.has(r); })
      .sort((a, b) => Number(b.isCompound) - Number(a.isCompound));
    for (const r of THEME_REGIONS[theme]) {
      for (const v of lib) {
        if (picks.length >= minPicks) break;
        if (regionOf(v.category) !== r || seen.has(v.canonicalName.toLowerCase()) || conflict(v.canonicalName)) continue;
        picks.push({ key: v.canonicalName.toLowerCase(), name: v.canonicalName, region: r, isCompound: v.isCompound, lastDate: null, daysSince: null, last: null, fromLibrary: true });
        seen.add(v.canonicalName.toLowerCase());
        break;
      }
    }
    for (const v of lib) {
      if (picks.length >= minPicks) break;
      if (seen.has(v.canonicalName.toLowerCase()) || conflict(v.canonicalName)) continue;
      picks.push({ key: v.canonicalName.toLowerCase(), name: v.canonicalName, region: regionOf(v.category)!, isCompound: v.isCompound, lastDate: null, daysSince: null, last: null, fromLibrary: true });
      seen.add(v.canonicalName.toLowerCase());
    }
  }
  // Compounds first in the session order.
  picks.sort((a, b) => Number(b.isCompound) - Number(a.isCompound));

  return { theme, label: THEME_LABEL[theme], why, regions, picks, neglected: neglectedMuscles.slice(0, 3), excluded: excluded.slice(0, 6), light, insufficientHistory };
}

// ── Numbers ──────────────────────────────────────────────────────────────────
export interface SuggestedExercise {
  name: string;
  sets: number;
  reps: string;
  weightKg: number | null;
  rpe: number | null;
  basis: 'suggestion' | 'last_session' | 'new';
  note: string | null;
  lastDate: string | null;
}

/** Contract-1 suggestion when present, else last session's top set and set count. Pure. */
export function numbersFor(p: SessionPick, suggestion: Partial<Suggestion> | null, light: boolean): SuggestedExercise {
  if (suggestion && (suggestion.reps != null || suggestion.weightKg != null)) {
    const sets = Math.max(1, Math.round(Number(suggestion.sets) || 3) - (light ? 1 : 0));
    return { name: p.name, sets, reps: String(suggestion.reps ?? '8'), weightKg: suggestion.weightKg ?? null, rpe: suggestion.rpe ?? null, basis: 'suggestion', note: typeof suggestion.note === 'string' && suggestion.note ? suggestion.note : null, lastDate: p.lastDate };
  }
  if (p.last) {
    const top = p.last.top ?? p.last.sets[0] ?? null;
    const sets = Math.max(1, Math.min(6, p.last.sets.length) - (light ? 1 : 0));
    return { name: p.name, sets, reps: String(top?.reps ?? 8), weightKg: top?.weightKg ?? null, rpe: light ? 6 : top?.rpe ?? null, basis: 'last_session', note: light ? 'Same load as last time, stop well short of failure.' : null, lastDate: p.lastDate };
  }
  return { name: p.name, sets: light ? 2 : 3, reps: p.isCompound ? '6-8' : '10-12', weightKg: null, rpe: 7, basis: 'new', note: 'New to your log — pick a load you could lift for 2–3 more reps.', lastDate: null };
}

export function sessionEnabledFor(userId: string, email?: string | null): boolean {
  return freestyleAvailableFor(userId, email) || logAdaptationAvailableFor(userId, email);
}

export const SUGGEST_TOOLS = [
  tool({
    name: 'suggest_session', kind: 'read', fn: 'WRK-10',
    description: 'Build a one-off session for today from the user’s own history — for "what should I train today", "I don’t follow a program", "give me a workout". Picks rested, due regions (push, pull, legs), their usual lifts that are overdue, and numbers from their next-session suggestions or last session; respects equipment and injuries. focus optional ("upper", "legs", "push", "full body"); minutes optional. Word the plan from the result; don’t invent loads.',
    input_schema: schema({ focus: { type: 'string' }, minutes: { type: 'number' } }),
    receipt: (i) => ({ verb: 'Computed', text: str(i.focus) ? `Session · ${str(i.focus)}` : 'Today’s session' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, unitPreference: true, constraintsText: true } });
      if (!u) throw new Error('User not found');
      if (!sessionEnabledFor(userId, u.email)) {
        return { unavailable: true, message: 'Session suggestions aren’t switched on for this account yet. Suggest a session from read_recent_workouts and read_strength_profile instead.' };
      }
      const unit = u.unitPreference === 'metric' ? 'metric' : 'imperial';
      const [{ todayIn }, { userTz }] = await Promise.all([import('../cards/format.js'), import('../cards/store.js')]);
      const today = todayIn(await userTz(userId));
      const [history, profile] = await Promise.all([loadTrainingHistory(userId), readProfile(userId).catch(() => null)]);
      // Injuries: the structured list AND the raw constraints text (both are written in places).
      const injuries = (profile?.injuries ?? []).filter((i) => !i.resolvedAt).map((i) => [i.area, i.note].filter(Boolean).join(' — '));
      const injuryText = [...injuries, u.constraintsText ?? ''].join('; ');
      const equipment = (profile?.values?.equipment as string | undefined) ?? null;
      let ledger: MuscleLedger | null = null;
      try {
        ledger = buildMuscleLedger(history.workouts.filter((w) => w.date <= today).map((w) => ({
          date: w.date,
          exercises: w.exercises.flatMap((ex) => toLedgerExercises(ex, history.names.of(ex.name).canonical)),
        })));
      } catch { ledger = null; }
      const minutes = numOr(input.minutes);
      const plan = planSession({ history, today, focus: str(input.focus) || null, maxExercises: minutes ? Math.round(minutes / 9) : 5, equipment, injuryText, ledger });

      // Contract 1: per-exercise next-session suggestion; absent → last exposure.
      const suggestions = new Map<string, Suggestion>();
      const known = plan.picks.filter((p) => !p.fromLibrary).map((p) => p.name);
      if (known.length) {
        try {
          const { lastForExercises } = await import('../../adaptation/proposalService.js');
          for (const l of await lastForExercises(userId, known, 1)) if (l.suggestion) suggestions.set(l.name, l.suggestion);
        } catch { /* numbers fall back to the last session */ }
      }
      const exercises = plan.picks.map((p) => numbersFor(p, suggestions.get(p.name) ?? null, plan.light));
      return {
        theme: plan.theme,
        label: plan.label,
        why: plan.why,
        light: plan.light,
        insufficientHistory: plan.insufficientHistory,
        neglected: plan.neglected,
        excluded: plan.excluded,
        constraints: { equipment, injuries },
        exercises: exercises.map((e) => ({
          name: e.name, scheme: `${e.sets} × ${e.reps}`, load: e.weightKg != null ? weight(unit, e.weightKg) : e.basis === 'new' ? 'pick a load' : 'bodyweight',
          rpe: e.rpe, basis: e.basis, note: e.note, lastDone: e.lastDate,
        })),
        _exercises: exercises,
        _unit: unit,
      };
    },
    card: (_i, r) => {
      if (r.unavailable) return null;
      return {
        fn: 'WRK-10', pattern: 'glance', rule: 'show', meta: { label: `Today · ${r.label}` },
        rows: r._exercises.map((e: SuggestedExercise) => ({
          key: e.name,
          value: `${e.sets} × ${e.reps}${e.weightKg != null ? ` · ${weight(r._unit, e.weightKg)}` : ''}${e.rpe ? ` · RPE ${e.rpe}` : ''}`,
          sub: e.basis === 'suggestion' ? (e.note ?? 'Next step from your log') : e.basis === 'last_session' ? `Same as ${e.lastDate ? dayLabel(e.lastDate) : 'last time'}` : 'New — calibrate',
        })),
        ...(r.why?.[0] ? { why: r.why[0] } : {}),
        actions: [{ id: 'log', label: 'Log it as I go', kind: 'primary', client: { action: 'send_message', args: { text: 'I’m starting this session — log my sets as I tell you.' } } }],
      };
    },
  }),
];

registerToolkit(SUGGEST_TOOLS);
