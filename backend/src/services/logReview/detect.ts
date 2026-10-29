// Log review — the detection rules (design "Log review 1a", Oct 2026).
//
// Pure: given a user's recent logs and their history, return the entries that
// look wrong and the fix to propose for each. Nothing here writes; the caller
// stores flags and the user approves every fix on the digest card.
//
// Why: corrections were logged as new workouts (one climb saved four times,
// which tripled a calorie target), a machine lateral raise at 130 lb fed the
// free-weight strength model, and assumed reps produced false PRs. Each rule
// states its reason in one sentence, the way the card shows it.
//
// Thresholds are the spec's starting values — tune against real logs.

import { workingSets, type RawLoggedExercise } from '../../adaptation/history.js';
import { e1rmWithRpe } from '../../engine/e1rm.js';
import { SEED } from '../exerciseCanonical.js';
import { resolveProfile } from '../swap/match.js';

export type FlagType = 'duplicate' | 'fuzzy_duplicate' | 'outlier' | 'conflict' | 'missing' | 'equipment';
export type Confidence = 'high' | 'medium' | 'low';

export interface ReviewLog {
  id: string;
  date: string;                // YYYY-MM-DD
  createdAt: Date;
  title: string | null;
  duration: number | null;
  notes: string | null;
  exercises: (RawLoggedExercise & { equipment?: string | null; estimated?: boolean | null })[];
}

export interface Suggestion {
  op: 'delete' | 'merge' | 'update' | 'fill';
  /** delete: logId · merge: logId + exercise index to drop, keep index · update/fill: logId + index + patch */
  payload: Record<string, unknown>;
}

export interface Finding {
  type: FlagType;
  ruleKey: string;
  entryIds: string[];
  confidence: Confidence;
  title: string;
  fix: string;
  reason: string;
  impact?: string;
  before: string;
  after: string;
  doneLabel: string;
  entryDate: string;
  suggestion: Suggestion;
}

export interface DetectInput {
  /** Logs to check (the detection window). */
  recent: ReviewLog[];
  /** Earlier logs: the baseline for e1RM, medians and name aliases. Must not include `recent`. */
  history: ReviewLog[];
  /** Canonical lift key ("bench press" for "Barbell Bench Press"). */
  key: (name: string) => string;
  unit: 'imperial' | 'metric';
  bodyweightKg: number | null;
  /** ruleKeys the user kept as is: never raised again. */
  suppressed: Set<string>;
}

export const DUPLICATE_WINDOW_MS = 5 * 60_000;
/** A second log of the same session within this window is an edit, not a new session. */
export const EDIT_WINDOW_MS = 30 * 60_000;
const KG_PER_LB = 0.45359237;

// ── helpers ──────────────────────────────────────────────────────────────────

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const showW = (kg: number, unit: DetectInput['unit']) => unit === 'metric' ? `${Math.round(kg * 10) / 10} kg` : `${Math.round(kg / KG_PER_LB)} lb`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Normalized edit distance (a swapped letter pair counts as one edit, so
 * "Trciep" is one typo from "Tricep"): 0 = identical, 1 = nothing in common.
 */
export function editRatio(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x.length && !y.length) return 0;
  const m = x.length, n = y.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n] / Math.max(m, n);
}

const VOCAB = new Set(Object.keys(SEED).flatMap((k) => norm(k).split(' ')).concat(['machine', 'cable', 'dumbbell', 'barbell', 'single', 'arm', 'underarm', 'push', 'down', 'pushdown', 'seated', 'standing', 'incline', 'decline']));
/** Words in a name that aren't exercise vocabulary: likely typos. */
const unknownWords = (name: string) => norm(name).split(' ').filter((w) => w && !VOCAB.has(w) && !/^\d+$/.test(w)).length;
/** Edit ratio with spaces removed ("push down" = "pushdown"). */
const squashRatio = (a: string, b: string) => editRatio(norm(a).replace(/ /g, ''), norm(b).replace(/ /g, ''));

/** One line for an exercise: "185 lb × 5 × 3", or "3 × 10" for bodyweight. */
export function exLine(e: ReviewLog['exercises'][number], unit: DetectInput['unit']): string {
  const sets = workingSets(e);
  const w = sets.find((s) => s.weightKg)?.weightKg ?? (e.weightKg && !e.bodyweight ? e.weightKg : null);
  const reps = sets.length ? sets.map((s) => s.reps) : [];
  const allSame = reps.every((r) => r === reps[0]);
  const repTxt = reps.length ? (allSame ? `${reps[0]} × ${reps.length}` : reps.join(', ')) : `${e.reps ?? '?'} × ${e.sets ?? '?'}`;
  return w ? `${showW(w, unit)} × ${repTxt}` : repTxt;
}

/** Same work: same canonical lift, same load, reps and set count. */
function sameWork(a: ReviewLog['exercises'][number], b: ReviewLog['exercises'][number]): boolean {
  const sa = workingSets(a), sb = workingSets(b);
  if (sa.length !== sb.length || !sa.length) return sa.length === sb.length && String(a.reps) === String(b.reps) && a.sets === b.sets && (a.weightKg ?? null) === (b.weightKg ?? null);
  return sa.every((s, i) => s.reps === sb[i].reps && Math.abs((s.weightKg ?? 0) - (sb[i].weightKg ?? 0)) < 0.01);
}

function sameExercises(a: ReviewLog, b: ReviewLog, key: DetectInput['key']): boolean {
  if (a.exercises.length !== b.exercises.length) return false;
  return a.exercises.every((e, i) => key(e.name) === key(b.exercises[i].name) && sameWork(e, b.exercises[i]));
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const topLoadKg = (e: ReviewLog['exercises'][number]) => Math.max(0, ...workingSets(e).map((s) => s.weightKg ?? 0));

/** Best e1RM (kg) per lift key across logs, skipping estimated or equipment-tagged-different entries. */
function e1rmByLift(logs: ReviewLog[], key: DetectInput['key']): Map<string, { e1rm: number; loads: number[]; bests: number[]; reps: number[] }> {
  const out = new Map<string, { e1rm: number; loads: number[]; bests: number[]; reps: number[] }>();
  const byDate = [...logs].sort((a, b) => b.date.localeCompare(a.date));
  for (const log of byDate) {
    for (const e of log.exercises) {
      if (e.estimated) continue;
      const k = key(e.name);
      const sets = workingSets(e).filter((s) => s.weightKg);
      if (!sets.length) continue;
      const cur = out.get(k) ?? { e1rm: 0, loads: [], bests: [] as number[], reps: [] as number[] };
      if (cur.bests.length < 3) cur.bests.push(Math.max(...sets.map((s) => e1rmWithRpe(s.weightKg!, s.reps, s.rpe))));
      if (cur.loads.length < 9) cur.loads.push(Math.max(...sets.map((s) => s.weightKg!)));
      if (cur.reps.length < 9) cur.reps.push(sets[0].reps);
      // "Current" e1RM: the median of the last three sessions, so one bad old log can't skew it.
      cur.e1rm = median(cur.bests);
      out.set(k, cur);
    }
  }
  return out;
}


// Free-weight isolation lifts and the most a dumbbell version plausibly reaches
// (per hand, kg). Above it, the number is a machine or cable stack.
// Only lifts that are normally dumbbell work: a leg curl, a pushdown, a face
// pull or a pec deck is a machine or cable by nature, so a heavy one is not
// "a machine logged as free weight" (Tarek's seated leg curl, Oct 29 2026).
const DUMBBELL_CEILING_KG: [RegExp, number][] = [
  [/lateral raise|side raise|lat raise/, 25],
  [/rear delt (fly|raise)|reverse fly/, 25],
  [/\bfly|flye/, 35],
  [/front raise/, 25],
  [/(bicep|hammer|preacher|concentration|spider|incline|dumbbell|db) curl|^(curls?|bicep curls?)$/, 45],
  [/skull ?crusher|kickback|overhead (tricep|triceps )?extension/, 40],
  [/shrug/, 70],
];
const FREE_WEIGHT_EQ = new Set(['dumbbell', 'barbell', 'ez_bar', 'kettlebell', 'bodyweight']);
/** Free weight, per the swap catalog; a name the catalog doesn't know counts as free weight (the word lists decide). */
export function isFreeWeight(name: string): boolean {
  const p = resolveProfile(name);
  return !p || FREE_WEIGHT_EQ.has(p.eq);
}
/** Machine or cable by nature: never an equipment flag, whatever the load. */
const MACHINE_BY_NATURE = /\b(leg (curl|extension|press)|hamstring curl|pushdown|push down|pressdown|face pull|pec deck|pulldown|lat pull|cable|machine|hack squat|smith)\b/i;
const EQUIPMENT_WORD = /\b(machine|cable|smith|stack|plate[- ]loaded|hammer strength|selectorized|pec deck|barbell|bb|ez[- ]?bar|trap bar)\b/i;

// ── rules ────────────────────────────────────────────────────────────────────

export function detect(input: DetectInput): Finding[] {
  const { recent, history, key, unit, suppressed } = input;
  const out: Finding[] = [];
  const add = (f: Finding) => { if (!suppressed.has(f.ruleKey) && !out.some((x) => x.ruleKey === f.ruleKey)) out.push(f); };
  const all = [...recent, ...history];
  const flaggedLogs = new Set<string>();

  // duplicate / conflict at the log level: the same session saved more than
  // once, or corrections saved as new logs (Rashad's climb, Oct 2026: four
  // logs in three minutes). One flag per session, however many copies.
  const sorted = [...recent].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sameSession = (a: ReviewLog, b: ReviewLog) => {
    if (a.date !== b.date || Math.abs(b.createdAt.getTime() - a.createdAt.getTime()) > EDIT_WINDOW_MS) return false;
    const t = (l: ReviewLog) => (l.title ?? '').replace(/·.*$/, '');
    const sameTitle = !!a.title && !!b.title && (norm(t(a)) === norm(t(b)) || editRatio(t(a), t(b)) <= 0.2);
    const sameLifts = a.exercises.length === b.exercises.length && a.exercises.every((e, x) => key(e.name) === key(b.exercises[x].name));
    return sameTitle || sameLifts;
  };
  const used = new Set<string>();
  for (const first of sorted) {
    if (used.has(first.id)) continue;
    const group = [first];
    for (const l of sorted) if (!used.has(l.id) && l !== first && sameSession(group[group.length - 1], l)) group.push(l);
    if (group.length < 2) continue;
    group.forEach((l) => { used.add(l.id); flaggedLogs.add(l.id); });
    const latest = group[group.length - 1];
    const extras = group.slice(0, -1);
    const label = (latest.title || first.title || 'Workout').replace(/\s*·.*$/, '');
    const span = latest.createdAt.getTime() - first.createdAt.getTime();
    const allSame = group.every((l) => sameExercises(l, first, key) && (l.duration ?? 0) === (first.duration ?? 0));
    const desc = (l: ReviewLog) => [l.duration ? `${l.duration} min` : null, l.exercises.map((e) => exLine(e, unit)).join(', ')].filter(Boolean).join(' · ').slice(0, 60);
    const n = group.length;
    if (allSame) {
      // Identical copies are duplicates; the spec's 5-minute window decides how sure we are.
      add({
        type: 'duplicate', ruleKey: `duplicate:${group.map((l) => l.id).join('|')}`, entryIds: group.map((l) => l.id), confidence: span <= DUPLICATE_WINDOW_MS * (n - 1) ? 'high' : 'medium',
        title: `${label} logged ${n === 2 ? 'twice' : `${n} times`}`, fix: n === 2 ? 'Remove the second copy' : `Remove ${n - 1} copies`,
        reason: `Same session, same numbers, saved ${span < 90_000 ? `${Math.max(1, Math.round(span / 1000))} seconds` : `${Math.round(span / 60_000)} min`} apart.`,
        impact: `Counts the session ${n === 2 ? 'twice' : `${n} times`} in volume, calories and streaks.`,
        before: `${n} entries`, after: '1 entry', doneLabel: n === 2 ? 'Removed duplicate' : 'Removed duplicates', entryDate: latest.date,
        suggestion: { op: 'delete', payload: { logIds: group.slice(1).map((l) => l.id) } },
      });
    } else {
      add({
        type: 'conflict', ruleKey: `conflict:${group.map((l) => l.id).join('|')}`, entryIds: group.map((l) => l.id), confidence: 'medium',
        title: `${label}: ${n} versions`, fix: 'Keep the latest version',
        reason: `Logged ${n} times in ${Math.max(1, Math.round(span / 60_000))} min with different numbers — the latest looks like your correction.`,
        impact: `All ${n} count right now, so the day is ${n === 2 ? 'double' : `${n}×`}-counted.`,
        before: extras.map(desc).join(' | '), after: desc(latest), doneLabel: 'Kept the latest version', entryDate: latest.date,
        suggestion: { op: 'delete', payload: { logIds: extras.map((l) => l.id) } },
      });
    }
  }

  // Per-exercise rules.
  const baseline = e1rmByLift(history.length ? history : all, key);
  const nameCounts = new Map<string, Map<string, number>>();
  for (const log of all) for (const e of log.exercises) {
    const k = key(e.name);
    const m = nameCounts.get(k) ?? new Map<string, number>();
    m.set(e.name.trim(), (m.get(e.name.trim()) ?? 0) + 1);
    nameCounts.set(k, m);
  }
  const knownNames = [...new Set(all.flatMap((l) => l.exercises.map((e) => e.name.trim())))];
  const bwKg = input.bodyweightKg;

  for (const log of recent) {
    if (flaggedLogs.has(log.id)) continue;
    log.exercises.forEach((e, i) => {
      const id = `${log.id}#${i}`;
      const k = key(e.name);

      // fuzzy_duplicate (same day): a near-spelling of another entry with identical sets.
      for (const other of recent.filter((l) => l.date === log.date)) {
        other.exercises.forEach((o, j) => {
          if (`${other.id}#${j}` <= id) return; // each pair once
          if (o.name.trim() === e.name.trim()) return;
          const close = key(o.name) === k || editRatio(o.name, e.name) <= 0.2;
          if (!close || !sameWork(o, e)) return;
          add({
            type: 'fuzzy_duplicate', ruleKey: `fuzzy:${[norm(o.name), norm(e.name)].sort().join('|')}:${other.id}#${j}|${id}`,
            entryIds: [`${other.id}#${j}`, id], confidence: 'medium',
            title: `“${e.name}” matches ${o.name}`, fix: `Merge into ${o.name}`,
            reason: 'Same day, same sets and weight — one lift under two names.',
            impact: 'Counts the lift twice in volume.',
            before: `2 entries · ${exLine(e, unit)}`, after: `1 entry · ${o.name}`, doneLabel: 'Merged', entryDate: log.date,
            suggestion: { op: 'merge', payload: { logId: log.id, index: i, keep: { logId: other.id, index: j } } },
          });
        });
      }

      // fuzzy name across history: a typo of a lift they log under another spelling ("Trciep").
      if (!nameCounts.get(k) || (nameCounts.get(k)!.get(e.name.trim()) ?? 0) <= 1) {
        // A typo, not a different lift: spaces aside the spellings are near-identical,
        // and the suggestion moves toward real exercise words ("Trciep" → "Tricep", never back).
        const mine = unknownWords(e.name);
        const better = knownNames
          .filter((n) => n !== e.name.trim() && norm(n) !== norm(e.name) && squashRatio(n, e.name) <= 0.12)
          .map((n) => ({ n, c: nameCounts.get(key(n))?.get(n) ?? 0, u: unknownWords(n) }))
          .filter((x) => x.c >= 1 && (x.u < mine || (x.u === mine && x.c >= 2)))
          .sort((a, b) => a.u - b.u || b.c - a.c)[0];
        if (better) {
          add({
            type: 'fuzzy_duplicate', ruleKey: `alias:${[norm(better.n), norm(e.name)].sort().join('|')}`,
            entryIds: [id], confidence: 'medium',
            title: `“${e.name}” looks like ${better.n}`, fix: `Rename to ${better.n}`,
            reason: `You've logged ${better.n} ${better.c} times; this spelling splits its history in two.`,
            before: e.name, after: better.n, doneLabel: 'Renamed', entryDate: log.date,
            suggestion: { op: 'update', payload: { logId: log.id, index: i, patch: { name: better.n } } },
          });
        }
      }

      const sets = workingSets(e);
      const top = topLoadKg(e);

      // missing: a loaded lift saved with no weight (or no reps), fillable from history.
      const hist = baseline.get(k);
      // Reps unreadable ("varies") on a set with a weight: fill the reps, not the weight.
      if (!sets.length && (e.weightKg ?? 0) > 0) {
        if (hist && hist.reps.length) {
          const reps = Math.round(median(hist.reps.slice(0, 3)));
          add({
            type: 'missing', ruleKey: `missing:reps:${id}`, entryIds: [id], confidence: 'low',
            title: `${e.name} has no reps`, fix: `Fill ${reps} reps from your last sessions`,
            reason: `Saved with reps “${e.reps}”; your last sessions were about ${reps} reps.`,
            impact: 'Without reps this session doesn’t count toward your strength.',
            before: `${showW(e.weightKg!, unit)} × ${e.reps} × ${e.sets}`, after: `${showW(e.weightKg!, unit)} × ${reps} × ${e.sets}`, doneLabel: 'Filled in', entryDate: log.date,
            suggestion: { op: 'fill', payload: { logId: log.id, index: i, patch: { reps } } },
          });
        }
        return;
      }
      const weightless = !e.bodyweight && !top && hist && hist.loads.length >= 1;
      if (weightless) {
        if (hist && hist.loads.length) {
          const fill = median(hist.loads.slice(0, 3));
          add({
            type: 'missing', ruleKey: `missing:${id}`, entryIds: [id], confidence: 'low',
            title: `${e.name} has no weight`, fix: `Fill ${showW(fill, unit)} from your last sessions`,
            reason: `Saved without a weight; your last ${Math.min(3, hist.loads.length)} sessions were around ${showW(fill, unit)}.`,
            impact: 'Without it this session doesn’t count toward your strength.',
            before: exLine(e, unit), after: `${showW(fill, unit)} × ${sets.map((s) => s.reps)[0] ?? e.reps}`, doneLabel: 'Filled in', entryDate: log.date,
            suggestion: { op: 'fill', payload: { logId: log.id, index: i, patch: { weightKg: fill } } },
          });
        }
        return;
      }

      // equipment: a free-weight-named isolation lift above what dumbbells reach.
      // Only for a lift that is free weight: the exercise catalog decides when it
      // knows the name (a leg curl, a pushdown, a pec deck are machine/cable by
      // nature — Tarek's seated leg curl, Oct 29 2026); the word lists catch the rest.
      if (top && !EQUIPMENT_WORD.test(e.name) && !MACHINE_BY_NATURE.test(e.name) && !e.equipment && isFreeWeight(e.name)) {
        const ceiling = DUMBBELL_CEILING_KG.find(([re]) => re.test(norm(e.name)))?.[1];
        const tooHeavy = ceiling != null && (top > ceiling * 1.4 || (bwKg ? top > bwKg * 0.6 && top > ceiling : false));
        if (tooHeavy) {
          add({
            type: 'equipment', ruleKey: `equipment:${norm(e.name)}`, entryIds: [id], confidence: 'medium',
            title: `${e.name} at ${showW(top, unit)}`, fix: `Label it Machine ${e.name}`,
            reason: `${showW(top, unit)} is more than dumbbells usually go for this lift — a machine or cable stack fits.`,
            impact: 'Machine numbers aren’t comparable with free weights, so it’s kept as its own lift.',
            before: `${e.name} · ${exLine(e, unit)}`, after: `Machine ${e.name} · ${exLine(e, unit)}`, doneLabel: 'Labelled machine', entryDate: log.date,
            suggestion: { op: 'update', payload: { logId: log.id, index: i, patch: { name: `Machine ${e.name}`, equipment: 'machine' } } },
          });
          return;
        }
      }

      // outlier: load far off the lift's e1RM, or reps past 50; test typo hypotheses.
      const repsMax = Math.max(0, ...sets.map((s) => s.reps));
      if (repsMax > 50 && !e.bodyweight) {
        const guess = Math.round(repsMax / 10);
        add({
          type: 'outlier', ruleKey: `outlier:reps:${id}`, entryIds: [id], confidence: guess >= 1 ? 'low' : 'low',
          title: `${e.name} at ${repsMax} reps`, fix: guess >= 1 ? `Change to ${guess} reps` : 'Check the reps',
          reason: `${repsMax} reps is far outside a loaded set; a typo is likely.`,
          before: exLine(e, unit), after: guess >= 1 ? exLine({ ...e, reps: String(guess), setEntries: e.setEntries?.map((s) => ({ ...s, reps: s.reps > 50 ? guess : s.reps })) }, unit) : exLine(e, unit), doneLabel: 'Corrected', entryDate: log.date,
          suggestion: { op: 'update', payload: { logId: log.id, index: i, patch: { repsFrom: repsMax, repsTo: guess } } },
        });
        return;
      }
      if (top && hist && hist.e1rm > 0 && (top > 2 * hist.e1rm || top < 0.3 * hist.e1rm)) {
        const recentMed = median(hist.loads.slice(0, 3));
        const hyps: [string, number][] = [['÷10', top / 10], ['×10', top * 10], ['lb→kg', top * KG_PER_LB], ['kg→lb', top / KG_PER_LB]];
        const best = hyps.map(([h, v]) => ({ h, v, err: Math.abs(v - recentMed) / (recentMed || 1) })).sort((a, b) => a.err - b.err)[0];
        const confident = best.err <= 0.1;
        const fixed = Math.round(best.v * 10) / 10;
        add({
          type: 'outlier', ruleKey: `outlier:load:${id}`, entryIds: [id], confidence: confident ? 'high' : 'low',
          title: `${e.name} at ${showW(top, unit)}`, fix: confident ? `Change to ${showW(fixed, unit)}` : 'Check the weight',
          reason: confident
            ? `${showW(top, unit)} is ${top > hist.e1rm ? 'over twice' : 'under a third of'} your estimated max; ${best.h === 'lb→kg' || best.h === 'kg→lb' ? 'it reads like the other unit' : 'it reads like a typo'} — your recent sets were ${showW(recentMed, unit)}.`
            : `${showW(top, unit)} is ${top > hist.e1rm ? 'over twice' : 'under a third of'} your estimated max of ${showW(hist.e1rm, unit)}.`,
          impact: top > hist.e1rm ? `Would set your ${e.name} max to about ${showW(e1rmWithRpe(top, sets[0]?.reps ?? 1), unit)}.` : undefined,
          before: exLine(e, unit), after: confident ? exLine({ ...e, weightKg: fixed, setEntries: e.setEntries?.map((s) => ({ ...s, weightKg: s.weightKg ? fixed : s.weightKg })) }, unit) : exLine(e, unit),
          doneLabel: 'Corrected', entryDate: log.date,
          suggestion: { op: 'update', payload: { logId: log.id, index: i, patch: confident ? { weightKg: fixed } : {} } },
        });
      }
    });
  }

  // Ordered high → low confidence, then newest entry first (card order).
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.entryDate.localeCompare(a.entryDate));
}

export { dayLabel };
