// Graded output for the conversational lift diagnostic (handoff §7, §10).
//
// The engine produces confidence, candidate ranks and the tagged evidence
// list; clients render them and never invent reasons. Everything here except
// generateVerdict() is pure so the grading rules are unit-testable.

import { kgToLb } from '../weightUnits.js';
import { parseSessionFlags } from '../sessionFlags.js';
import type { WorkoutPlan } from '../llmService.js';
import {
  LADDERS,
  PHASE_WORDS,
  QUESTION_TOPICS,
  VOLUME_CANDIDATE,
  computeConfidence,
  exerciseName,
  flagsForPhase,
  gradeFor,
  liftFamily,
  liftShort,
  type ConversationLift,
} from './policy.js';

// ─── Wire types (mirror packages/diagnostic-core/src/types.ts) ──────────────

export interface VideoResult {
  stickingPhase: string | null;
  stickingPointSec: number | null;
  elbowFlareDeg: number | null;
  barDriftCm: number | null;
  frameUrl: string | null;
}

export type EvidenceTag = 'RATIO' | 'VIDEO' | 'YOU' | 'GAP';
export interface EvidenceRow { tag: EvidenceTag; text: string }
export type CandidateRank = 'primary' | 'secondary' | 'ruled_out' | 'leading' | 'open';
export interface Candidate { key: string; label: string; score: number | null; rank: CandidateRank }

/** The protocol. Free, like the diagnosis — this analysis is never paywalled. */
export interface Fix {
  primary: { name: string; sets: number; reps: string; intensity: string; restMinutes: number };
  accessories: { exerciseId: string; name: string; sets: number; reps: string; why: string }[];
  progression: string[];
}

export interface Verdict {
  sessionId: string;
  lift: ConversationLift;
  grade: 0 | 1 | 2;
  confidence: number;
  ratiosLogged: number;
  hasVideo: boolean;
  answersGiven: number;
  limiter: { phase: string; hypothesisKey: string | null; hypothesisLabel: string | null };
  evidence: EvidenceRow[];
  candidates: Candidate[];
  charts: { indices: Record<string, number>; efficiency: number } | null;
  video: VideoResult | null;
  validationTest: { description: string; howToRun: string } | null;
  fix: Fix | null;
  trackNextTime: string[];
  missingLifts: string[];
  createdAt: string;
}

export interface SetPayload { weight: number; sets: number; reps: number; unit: 'lb' | 'kg' }

export interface TurnRow {
  type: string;
  payload: any;
  result: any;
}

// ─── Inputs from the transcript ─────────────────────────────────────────────

export interface DiagnosisInputs {
  sessionId: string;
  lift: ConversationLift;
  main: SetPayload | null;
  accessories: Map<string, { status: 'logged' | 'untrained' | 'skipped'; set?: SetPayload }>;
  answers: { question: 'q0' | 'q1' | 'q2'; text: string; optionId?: string; flags: string[] }[];
  video: VideoResult | null;
}

export function toLbs(set: SetPayload): number {
  return set.unit === 'kg' ? Math.round(kgToLb(set.weight) * 10) / 10 : set.weight;
}

/** Epley, reps clamped to 10 — the engine's own e1RM. */
export function e1rm(weightLbs: number, reps: number): number {
  return weightLbs * (1 + Math.min(reps, 10) / 30);
}

/** Fold the ordered turn log into what the scorer needs. Later turns win. */
export function gatherInputs(sessionId: string, lift: ConversationLift, turns: TurnRow[]): DiagnosisInputs {
  const inputs: DiagnosisInputs = { sessionId, lift, main: null, accessories: new Map(), answers: [], video: null };
  for (const t of turns) {
    const p = t.payload ?? {};
    switch (t.type) {
      case 'main':
        inputs.main = p.set;
        break;
      case 'accessory':
        inputs.accessories.set(p.exerciseId, { status: 'logged', set: p.set });
        break;
      case 'untrained':
        inputs.accessories.set(p.exerciseId, { status: 'untrained' });
        break;
      case 'skip':
        if (inputs.accessories.get(p.exerciseId)?.status !== 'logged') {
          inputs.accessories.set(p.exerciseId, { status: 'skipped' });
        }
        break;
      case 'answer':
        inputs.answers = inputs.answers.filter((a) => a.question !== p.question);
        inputs.answers.push({ question: p.question, text: p.text, optionId: p.optionId, flags: p.flags ?? [] });
        break;
      case 'video':
        if (t.result?.video?.status === 'complete' && t.result.video.result) inputs.video = t.result.video.result;
        break;
    }
  }
  return inputs;
}

/** Engine flags from answers (chips carry flags; typed answers are parsed) plus the video's phase. */
export function flagsFrom(inputs: DiagnosisInputs): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const a of inputs.answers) {
    for (const f of a.flags) flags[f] = true;
    if (!a.optionId) Object.assign(flags, parseSessionFlags(a.text));
  }
  for (const f of flagsForPhase(inputs.lift, inputs.video?.stickingPhase ?? null)) flags[f] = true;
  return flags;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface SignalsSubset {
  indices: Record<string, { value: number } | undefined>;
  primary_phase: string;
  hypothesis_scores: { key: string; label: string; score: number }[];
  efficiency_score: { score: number };
  validation_test: { description: string; how_to_run: string };
}

interface RatioRead {
  exerciseId: string;
  pct: number;
  low: number;
  high: number;
  region: string;
  plural: boolean;
  position: 'below' | 'inside' | 'above';
}

export function ratioReads(inputs: DiagnosisInputs): RatioRead[] {
  if (!inputs.main) return [];
  const mainE1rm = e1rm(toLbs(inputs.main), inputs.main.reps);
  if (mainE1rm <= 0) return [];
  const reads: RatioRead[] = [];
  for (const { id, norm } of LADDERS[inputs.lift]) {
    const rec = inputs.accessories.get(id);
    if (rec?.status !== 'logged' || !rec.set) continue;
    const ratio = e1rm(toLbs(rec.set), rec.set.reps) / mainE1rm;
    reads.push({
      exerciseId: id,
      pct: Math.round(ratio * 100),
      low: Math.round(norm.low * 100),
      high: Math.round(norm.high * 100),
      region: norm.region,
      plural: norm.plural,
      position: ratio < norm.low ? 'below' : ratio > norm.high ? 'above' : 'inside',
    });
  }
  return reads;
}

function ratioText(r: RatioRead, lift: ConversationLift): string {
  const head = `${exerciseName(r.exerciseId)} is ${r.pct}% of your ${liftShort(lift)}`;
  const norm = `the ${r.low}–${r.high}% norm`;
  if (r.position === 'below') return `${head} — below ${norm}, so ${r.region} ${r.plural ? 'lag' : 'lags'}.`;
  if (r.position === 'above') return `${head} — above ${norm}; ${r.region} ${r.plural ? 'are' : 'is'} a strength.`;
  return `${head} — inside ${norm}, so ${r.region} ${r.plural ? 'are' : 'is'} not the limiter.`;
}

export function buildEvidence(inputs: DiagnosisInputs): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  const reads = ratioReads(inputs);
  for (const r of reads) rows.push({ tag: 'RATIO', text: ratioText(r, inputs.lift) });

  const v = inputs.video;
  if (v) {
    const where = v.stickingPhase ? ` ${PHASE_WORDS[v.stickingPhase] ?? ''}`.trimEnd() : '';
    if (v.stickingPointSec != null) rows.push({ tag: 'VIDEO', text: `The bar stalls for ${round1(v.stickingPointSec)}s${where}.` });
    if (v.elbowFlareDeg != null) rows.push({ tag: 'VIDEO', text: `Elbows flare ${Math.round(v.elbowFlareDeg)}° as the bar slows.` });
    if (v.barDriftCm != null) rows.push({ tag: 'VIDEO', text: `Bar drifts ${Math.round(v.barDriftCm)}cm off its line.` });
  }

  const topics = QUESTION_TOPICS[liftFamily(inputs.lift)];
  for (const a of [...inputs.answers].sort((x, y) => x.question.localeCompare(y.question))) {
    const text = a.text.length > 90 ? `${a.text.slice(0, 87)}…` : a.text;
    rows.push({ tag: 'YOU', text: `On ${topics[a.question]}: “${text}”` });
  }

  // GAP — signal, not absence (§5), then regions nothing logged speaks for.
  const volume = VOLUME_CANDIDATE[liftFamily(inputs.lift)];
  for (const { id } of LADDERS[inputs.lift]) {
    if (inputs.accessories.get(id)?.status === 'untrained') {
      rows.push({ tag: 'GAP', text: `You don't train ${exerciseName(id)} — a gap in your ${volume.noun}, not a blank.` });
    }
  }
  const covered = new Set(reads.map((r) => r.region));
  const gapRegions = new Set<string>();
  for (const { id, norm } of LADDERS[inputs.lift]) {
    const status = inputs.accessories.get(id)?.status;
    if (status === 'logged' || status === 'untrained' || covered.has(norm.region) || gapRegions.has(norm.region)) continue;
    // Only regions the user was actually asked about — never a row for a lift
    // that was never on the table.
    if (status !== 'skipped' && !reads.length) continue;
    gapRegions.add(norm.region);
    if (gapRegions.size > 2) break;
    rows.push({ tag: 'GAP', text: `No ${norm.adj} ratio logged, so ${norm.region} can't be ruled out yet.` });
  }
  return rows;
}

export function buildCandidates(inputs: DiagnosisInputs, signals: SignalsSubset, grade: 0 | 1 | 2): Candidate[] {
  const hyps = signals.hypothesis_scores.filter((h) => h.score > 0);
  const volume = VOLUME_CANDIDATE[liftFamily(inputs.lift)];
  const hasUntrained = [...inputs.accessories.values()].some((a) => a.status === 'untrained');
  const out: Candidate[] = [];

  if (grade === 2) {
    hyps.forEach((h, i) => {
      if (i === 0) out.push({ key: h.key, label: h.label, score: h.score, rank: 'primary' });
      else if (i === 1 && h.score >= 25) out.push({ key: h.key, label: h.label, score: h.score, rank: 'secondary' });
    });
    if (hasUntrained) out.push({ key: volume.key, label: volume.label, score: null, rank: 'secondary' });
    const ruled = new Set<string>();
    for (const r of ratioReads(inputs)) {
      if (r.position === 'below' || ruled.has(r.region)) continue;
      ruled.add(r.region);
      out.push({ key: `region:${r.region}`, label: capitalize(r.region), score: null, rank: 'ruled_out' });
    }
    return out;
  }

  hyps.forEach((h, i) =>
    out.push({ key: h.key, label: h.label, score: h.score, rank: grade === 1 && i === 0 ? 'leading' : 'open' }),
  );
  if (hasUntrained) out.push({ key: volume.key, label: volume.label, score: null, rank: 'open' });
  return out;
}

export function buildVerdict(
  inputs: DiagnosisInputs,
  signals: SignalsSubset,
  plan: Pick<WorkoutPlan, 'bench_day_plan' | 'progression_rules' | 'track_next_time'> | null,
  createdAt: Date = new Date(),
): Verdict {
  const ratiosLogged = ratioReads(inputs).length;
  const grade = gradeFor(ratiosLogged);
  const hasVideo = !!inputs.video;
  const answersGiven = inputs.answers.length;
  const top = signals.hypothesis_scores.find((h) => h.score > 0) ?? null;
  const phase =
    signals.primary_phase && signals.primary_phase !== 'unknown'
      ? signals.primary_phase
      : inputs.video?.stickingPhase ?? 'unknown';

  const indices: Record<string, number> = {};
  for (const [k, v] of Object.entries(signals.indices)) if (v) indices[k] = v.value;

  const bench = plan?.bench_day_plan;
  const fix: Fix | null = bench
    ? {
        primary: {
          name: bench.primary_lift.exercise_name,
          sets: bench.primary_lift.sets,
          reps: String(bench.primary_lift.reps),
          intensity: bench.primary_lift.intensity,
          restMinutes: bench.primary_lift.rest_minutes,
        },
        accessories: (bench.accessories ?? []).map((a) => ({
          exerciseId: a.exercise_id,
          name: a.exercise_name,
          sets: a.sets,
          reps: String(a.reps),
          why: a.why,
        })),
        progression: plan?.progression_rules ?? [],
      }
    : null;

  return {
    sessionId: inputs.sessionId,
    lift: inputs.lift,
    grade,
    confidence: computeConfidence(ratiosLogged, hasVideo, answersGiven),
    ratiosLogged,
    hasVideo,
    answersGiven,
    limiter: { phase, hypothesisKey: top?.key ?? null, hypothesisLabel: top?.label ?? null },
    evidence: buildEvidence(inputs),
    candidates: buildCandidates(inputs, signals, grade),
    charts: grade === 2 ? { indices, efficiency: signals.efficiency_score.score } : null,
    video: inputs.video,
    validationTest:
      grade < 2 ? { description: signals.validation_test.description, howToRun: signals.validation_test.how_to_run } : null,
    fix,
    trackNextTime: plan?.track_next_time ?? [],
    missingLifts: LADDERS[inputs.lift]
      .map((l) => l.id)
      .filter((id) => {
        const s = inputs.accessories.get(id)?.status;
        return s !== 'logged' && s !== 'untrained';
      }),
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Audience rules for a stored verdict. There is no tier gate — the diagnosis
 * and the fix are both free (product decision 2026-09-13) — but a still of the
 * lifter's body never rides along on a public link.
 */
export function presentVerdict(v: Verdict, opts: { publicView?: boolean } = {}): Verdict {
  if (opts.publicView && v.video?.frameUrl) return { ...v, video: { ...v.video, frameUrl: null } };
  return v;
}

/** Plain-language conversation for the plan writer, rebuilt from the transcript. */
export function conversationFor(inputs: DiagnosisInputs): { role: 'user' | 'assistant'; message: string }[] {
  const topics = QUESTION_TOPICS[liftFamily(inputs.lift)];
  const msgs: { role: 'user' | 'assistant'; message: string }[] = [];
  for (const [id, rec] of inputs.accessories) {
    if (rec.status === 'untrained') msgs.push({ role: 'user', message: `I don't train ${exerciseName(id)}.` });
  }
  if (inputs.video) {
    const v = inputs.video;
    msgs.push({
      role: 'assistant',
      message: `Video measurements: sticking phase ${v.stickingPhase ?? 'unclear'}, stall ${v.stickingPointSec ?? '?'}s, elbow flare ${v.elbowFlareDeg ?? '?'}°, bar drift ${v.barDriftCm ?? '?'}cm.`,
    });
  }
  for (const a of inputs.answers) {
    msgs.push({ role: 'assistant', message: `Question about ${topics[a.question]}?` });
    msgs.push({ role: 'user', message: a.text });
  }
  return msgs;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
