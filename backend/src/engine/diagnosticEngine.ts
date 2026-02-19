/**
 * diagnosticEngine.ts — pure deterministic diagnostic engine.
 * No LLM calls. No side effects. Fully unit-testable.
 *
 * Takes raw snapshot data + session flags and returns a DiagnosticSignals
 * object that is injected verbatim into LLM prompts.
 */

import {
  getLiftConfig,
  LIFT_CONFIG_VERSION,
  type PhaseCondition,
  type IndexMapping,
  type LiftConfig,
  type ValidationTestEntry,
  type TrainingAge,
  type Equipment
} from './liftConfigs.js';

export const SIGNALS_VERSION = '1.0';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface SnapshotInput {
  exerciseId: string;
  weight: number;   // lbs
  reps: number;
  sets: number;
  rpe?: number;     // optional, not used in MVP e1RM but stored
}

export interface SessionFlags {
  // Shared flags across lifts
  hard_off_chest?: boolean;
  hard_off_floor?: boolean;
  hard_mid_range?: boolean;
  hard_at_lockout?: boolean;
  bar_drifts?: boolean;
  bar_drifts_forward?: boolean;
  hips_shoot_up?: boolean;
  chest_drops?: boolean;
  back_rounds?: boolean;
  feel_lower_back?: boolean;
  elbows_flare_early?: boolean;
  elbows_drop?: boolean;
  touch_point_inconsistent?: boolean;
  shoulder_discomfort?: boolean;
  mobility_restriction?: boolean;
  grip_limiting?: boolean;
  pause_much_harder?: boolean;
  [key: string]: boolean | undefined;  // allow arbitrary flags from interview
}

export interface DiagnosticEngineInput {
  liftId: string;
  primaryExerciseId: string;    // e.g. "flat_bench_press"
  snapshots: SnapshotInput[];
  flags: SessionFlags;
  bodyweightLbs: number;
  trainingAge: TrainingAge;
  equipment: Equipment;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface IndexScore {
  value: number;           // 0–100: how strong proxy is vs expected ratio
  confidence: number;      // 0–1: 1 src=0.35, 2=0.65, 3+=0.90
  sources: string[];       // exercise IDs that contributed
}

export interface EvidenceFact {
  type: 'ratio' | 'flag' | 'index' | 'e1rm';
  key: string;
  value: number | boolean | string;
  detail?: Record<string, unknown>;
}

export interface HypothesisSignal {
  key: string;
  label: string;
  score: number;           // 0–100, raw points capped at 100
  category: 'muscle' | 'mechanical' | 'stability' | 'mobility' | 'technique' | 'programming';
  evidence: string[];      // human-readable strings
  evidence_facts: EvidenceFact[];
}

export interface PhaseScore {
  phase_id: string;
  points: number;
}

export interface Deduction {
  key: string;
  points: number;
  reason: string;
}

export interface DataGap {
  key: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ValidationTest {
  description: string;
  how_to_run: string;
  hypothesis_tested: string;
  equipment_required: string[];
  training_age_minimum: TrainingAge;
  fallback_used: boolean;
  fallback_reason?: string;
}

export interface DiagnosticSignals {
  signals_version: string;
  lift_config_version: string;

  e1rms: Record<string, {
    value: number;
    reps_used: number;
    reps_clamped: boolean;
    confidence: 'high' | 'medium' | 'low';
  }>;

  indices: {
    quad_index?: IndexScore;
    posterior_index?: IndexScore;
    back_tension_index?: IndexScore;
    triceps_index?: IndexScore;
    shoulder_index?: IndexScore;
  };

  phase_scores: PhaseScore[];
  primary_phase: string;           // phase_id or "unknown"
  primary_phase_confidence: number;
  phase_tie: boolean;
  secondary_phase: string | null;

  hypothesis_scores: HypothesisSignal[];  // top 3–5, score >= 25 (always at least 3)

  dominance_archetype: {
    label: string;
    rationale: string;
    delta_key: string;             // e.g. "posterior_minus_quad"
    delta_value: number;
    delta_units: 'index_points';
    confidence: number;
  };

  efficiency_score: {
    score: number;                 // 40–95
    explanation: string;
    deductions: Deduction[];
  };

  validation_test: ValidationTest;

  data_gaps: DataGap[];
}

// ─── e1RM computation ─────────────────────────────────────────────────────────

/**
 * Epley formula, clamped to max 10 reps for reliability.
 * reps > 10 get confidence: 'low', between 5-10 'medium', <= 4 'high'.
 */
function computeE1RM(weight: number, reps: number): {
  value: number;
  reps_used: number;
  reps_clamped: boolean;
  confidence: 'high' | 'medium' | 'low';
} {
  const reps_clamped = reps > 10;
  const reps_used = reps_clamped ? 10 : reps;
  const value = Math.round(weight * (1 + reps_used / 30));

  let confidence: 'high' | 'medium' | 'low';
  if (reps_clamped) {
    confidence = 'low';
  } else if (reps <= 4) {
    confidence = 'high';
  } else {
    confidence = 'medium';
  }

  return { value, reps_used, reps_clamped, confidence };
}

function computeAllE1RMs(
  snapshots: SnapshotInput[]
): Record<string, { value: number; reps_used: number; reps_clamped: boolean; confidence: 'high' | 'medium' | 'low' }> {
  const result: Record<string, { value: number; reps_used: number; reps_clamped: boolean; confidence: 'high' | 'medium' | 'low' }> = {};
  for (const s of snapshots) {
    // Use best e1RM if same exercise appears multiple times
    const computed = computeE1RM(s.weight, s.reps);
    if (!result[s.exerciseId] || computed.value > result[s.exerciseId].value) {
      result[s.exerciseId] = computed;
    }
  }
  return result;
}

// ─── Condition evaluation ─────────────────────────────────────────────────────

interface ConditionResult {
  fired: boolean;
  actualValue?: number;     // ratio or index value, for evidence generation
  expectedLow?: number;
  expectedHigh?: number;
}

function evaluateCondition(
  condition: PhaseCondition,
  e1rms: Record<string, { value: number }>,
  flags: SessionFlags,
  primaryE1RM: number
): ConditionResult {
  switch (condition.type) {
    case 'flag': {
      const flagValue = condition.flag ? flags[condition.flag] : false;
      return { fired: !!flagValue };
    }

    case 'ratio_below': {
      const numId = condition.numerator_exercise!;
      const denId = condition.denominator_exercise!;
      const num = e1rms[numId];
      const den = e1rms[denId];
      if (!num || !den || den.value === 0) return { fired: false };
      const ratio = num.value / den.value;
      return {
        fired: ratio < condition.threshold!,
        actualValue: Math.round(ratio * 100),
        expectedLow: condition.threshold! * 100,
        expectedHigh: 100
      };
    }

    case 'ratio_above': {
      const numId = condition.numerator_exercise!;
      const denId = condition.denominator_exercise!;
      const num = e1rms[numId];
      const den = e1rms[denId];
      if (!num || !den || den.value === 0) return { fired: false };
      const ratio = num.value / den.value;
      return {
        fired: ratio > condition.threshold!,
        actualValue: Math.round(ratio * 100),
        expectedLow: condition.threshold! * 100,
        expectedHigh: 150
      };
    }

    case 'index_below': {
      // Not used in MVP rules but here for completeness
      return { fired: false };
    }

    case 'e1rm_gap': {
      // Not used in MVP rules
      return { fired: false };
    }

    default:
      return { fired: false };
  }
}

// ─── Phase scoring ────────────────────────────────────────────────────────────

function scorePhases(
  config: LiftConfig,
  e1rms: Record<string, { value: number }>,
  flags: SessionFlags,
  primaryE1RM: number
): PhaseScore[] {
  const scoreMap: Record<string, number> = {};

  for (const rule of config.phaseRules) {
    const result = evaluateCondition(rule.condition, e1rms, flags, primaryE1RM);
    if (result.fired) {
      scoreMap[rule.phase_id] = (scoreMap[rule.phase_id] ?? 0) + rule.points;
    }
  }

  return Object.entries(scoreMap).map(([phase_id, points]) => ({ phase_id, points }));
}

function computePhaseConfidence(scores: PhaseScore[]): {
  primary_phase: string;
  primary_phase_confidence: number;
  phase_tie: boolean;
  secondary_phase: string | null;
} {
  if (scores.length === 0 || scores.every(s => s.points === 0)) {
    return {
      primary_phase: 'unknown',
      primary_phase_confidence: 0,
      phase_tie: false,
      secondary_phase: null
    };
  }

  const sorted = [...scores].sort((a, b) => b.points - a.points);
  const top = sorted[0];
  const runnerUp = sorted[1] ?? null;

  const tie = runnerUp !== null && top.points === runnerUp.points;

  let confidence: number;
  if (tie || top.points === 0) {
    confidence = 0;
  } else {
    const raw = 1 - (runnerUp ? runnerUp.points / top.points : 0);
    confidence = Math.min(1, Math.max(0, raw));
  }

  return {
    primary_phase: top.phase_id,
    primary_phase_confidence: confidence,
    phase_tie: tie,
    secondary_phase: runnerUp && !tie ? runnerUp.phase_id : null
  };
}

// ─── Hypothesis scoring ───────────────────────────────────────────────────────

function renderEvidenceTemplate(
  template: string,
  result: ConditionResult
): string {
  return template
    .replace('{value}', result.actualValue !== undefined ? String(result.actualValue) : '?')
    .replace('{expected}', result.expectedLow !== undefined ? String(result.expectedLow) : '?');
}

function scoreHypotheses(
  config: LiftConfig,
  e1rms: Record<string, { value: number }>,
  flags: SessionFlags,
  primaryE1RM: number
): HypothesisSignal[] {
  // Accumulate raw points per hypothesis key
  const hypothesisMap: Record<string, {
    key: string;
    label: string;
    category: HypothesisSignal['category'];
    rawPoints: number;
    evidence: string[];
    evidence_facts: EvidenceFact[];
  }> = {};

  for (const rule of config.hypothesisRules) {
    const result = evaluateCondition(rule.condition, e1rms, flags, primaryE1RM);
    if (!result.fired) continue;

    if (!hypothesisMap[rule.hypothesis_key]) {
      hypothesisMap[rule.hypothesis_key] = {
        key: rule.hypothesis_key,
        label: rule.hypothesis_label,
        category: rule.category,
        rawPoints: 0,
        evidence: [],
        evidence_facts: []
      };
    }

    const entry = hypothesisMap[rule.hypothesis_key];
    entry.rawPoints += rule.points;

    // Build human-readable evidence string
    const evidenceStr = renderEvidenceTemplate(rule.evidence_template, result);
    entry.evidence.push(evidenceStr);

    // Build structured evidence fact
    const fact: EvidenceFact = {
      type: rule.condition.type === 'flag' ? 'flag' : 'ratio',
      key: rule.condition.flag ??
        `${rule.condition.numerator_exercise}_to_${rule.condition.denominator_exercise}`,
      value: result.actualValue ?? (result.fired ? true : false),
      detail: result.actualValue !== undefined
        ? {
            actual_pct: result.actualValue,
            threshold_pct: rule.condition.threshold ? Math.round(rule.condition.threshold * 100) : undefined
          }
        : undefined
    };
    entry.evidence_facts.push(fact);
  }

  // Cap raw points at 100, filter >= 25, sort descending
  const all: HypothesisSignal[] = Object.values(hypothesisMap).map(h => ({
    key: h.key,
    label: h.label,
    score: Math.min(100, h.rawPoints),
    category: h.category,
    evidence: h.evidence,
    evidence_facts: h.evidence_facts
  }));

  all.sort((a, b) => b.score - a.score);

  // Always return at least 3, even if below threshold
  const above25 = all.filter(h => h.score >= 25);
  const below25 = all.filter(h => h.score < 25);

  if (above25.length >= 3) {
    return above25.slice(0, 5);
  }

  return [...above25, ...below25].slice(0, Math.max(3, above25.length));
}

// ─── Index computation ────────────────────────────────────────────────────────

function computeIndexScore(
  mappings: IndexMapping[],
  e1rms: Record<string, { value: number }>,
  primaryE1RM: number
): IndexScore | undefined {
  const subscores: { value: number; weight: number; source: string }[] = [];

  for (const mapping of mappings) {
    const proxy = e1rms[mapping.proxy_exercise_id];
    if (!proxy || primaryE1RM === 0) continue;

    const ratio = proxy.value / primaryE1RM;
    const expectedMidpoint = (mapping.expected_ratio_low + mapping.expected_ratio_high) / 2;
    const subscore = Math.min(100, Math.max(0, Math.round((ratio / expectedMidpoint) * 100)));

    subscores.push({ value: subscore, weight: mapping.weight, source: mapping.proxy_exercise_id });
  }

  if (subscores.length === 0) return undefined;

  // Weighted average
  const totalWeight = subscores.reduce((s, x) => s + x.weight, 0);
  const weightedSum = subscores.reduce((s, x) => s + x.value * x.weight, 0);
  const value = Math.round(weightedSum / totalWeight);

  // Confidence tiers
  let confidence: number;
  if (subscores.length === 1) confidence = 0.35;
  else if (subscores.length === 2) confidence = 0.65;
  else confidence = 0.90;

  return {
    value,
    confidence,
    sources: subscores.map(s => s.source)
  };
}

function computeAllIndices(
  config: LiftConfig,
  e1rms: Record<string, { value: number }>,
  primaryE1RM: number
): DiagnosticSignals['indices'] {
  // Group mappings by index
  const byIndex: Record<string, IndexMapping[]> = {};
  for (const mapping of config.indexMappings) {
    if (!byIndex[mapping.index]) byIndex[mapping.index] = [];
    byIndex[mapping.index].push(mapping);
  }

  const indices: DiagnosticSignals['indices'] = {};

  for (const [indexKey, mappings] of Object.entries(byIndex)) {
    const score = computeIndexScore(mappings, e1rms, primaryE1RM);
    if (score !== undefined) {
      (indices as Record<string, IndexScore>)[indexKey] = score;
    }
  }

  return indices;
}

// ─── Dominance archetype ──────────────────────────────────────────────────────

function computeDominanceArchetype(
  liftId: string,
  indices: DiagnosticSignals['indices'],
  primaryPhase: string
): DiagnosticSignals['dominance_archetype'] {
  const INSUFFICIENT = {
    label: 'Insufficient data for archetype',
    rationale: 'Not enough proxy lift data to determine a dominance profile. Add more accessory lift data for a full archetype.',
    delta_key: 'unknown',
    delta_value: 0,
    delta_units: 'index_points' as const,
    confidence: 0
  };

  // Determine which pair of indices to use for this lift
  type IndexKey = keyof DiagnosticSignals['indices'];
  let primary_key: IndexKey | null = null;
  let secondary_key: IndexKey | null = null;
  let delta_key = '';

  if (liftId === 'deadlift' || liftId === 'barbell_back_squat' || liftId === 'barbell_front_squat') {
    primary_key = 'posterior_index';
    secondary_key = 'quad_index';
    delta_key = 'posterior_minus_quad';
  } else if (liftId === 'flat_bench_press' || liftId === 'incline_bench_press') {
    primary_key = 'back_tension_index';
    secondary_key = 'triceps_index';
    delta_key = 'back_tension_minus_triceps';
  }

  if (!primary_key || !secondary_key) return INSUFFICIENT;

  const a = indices[primary_key];
  const b = indices[secondary_key];

  // Need at least one index with minimum single-source confidence (0.35)
  if (!a && !b) return INSUFFICIENT;
  if (a && a.confidence < 0.3) return INSUFFICIENT;
  if (b && b.confidence < 0.3) return INSUFFICIENT;

  // If only one side is present, use a neutral baseline of 50 for the missing side
  // so we can still characterise relative strength (with lower confidence)
  const aVal = a ? a.value : 50;
  const bVal = b ? b.value : 50;
  const delta_value = aVal - bVal;
  const confidence = a && b ? Math.min(a.confidence, b.confidence) : 0.3;

  // Threshold of ±15 index points = dominant
  let label: string;
  let rationale: string;

  const missingNote = (!a || !b) ? ' (one index estimated from baseline — add more proxy lifts to confirm)' : '';

  if (delta_value >= 15) {
    if (liftId === 'deadlift') {
      label = `Posterior-chain dominant${primaryPhase === 'initial_pull' ? ', floor-limited' : primaryPhase === 'lockout' ? ', lockout-limited' : ''}`;
      rationale = `Posterior index (${aVal}) exceeds quad index (${bVal}) by ${delta_value} points. Your hip hinge pattern is strong relative to your quad contribution.${missingNote}`;
    } else if (liftId === 'barbell_back_squat' || liftId === 'barbell_front_squat') {
      label = `Posterior-chain dominant${primaryPhase === 'bottom' ? ', bottom-limited' : ', ascent-limited'}`;
      rationale = `Posterior index (${aVal}) exceeds quad index (${bVal}) by ${delta_value} points. Hip extension is relatively strong; quad drive is the specific weakness.${missingNote}`;
    } else {
      label = 'Back-tension dominant presser';
      rationale = `Back tension index (${aVal}) exceeds triceps index (${bVal}) by ${delta_value} points. Upper back is well-developed relative to triceps pressing power.${missingNote}`;
    }
  } else if (delta_value <= -15) {
    if (liftId === 'deadlift') {
      label = `Quad-dominant${primaryPhase === 'lockout' ? ', lockout-limited' : ', floor-strong'}`;
      rationale = `Quad index (${bVal}) exceeds posterior index (${aVal}) by ${Math.abs(delta_value)} points. Strong quad contribution; posterior chain is the relative weakness.${missingNote}`;
    } else if (liftId === 'barbell_back_squat' || liftId === 'barbell_front_squat') {
      label = `Quad-dominant squatter${primaryPhase === 'ascent' ? ', mid-ascent limited' : ''}`;
      rationale = `Quad index (${bVal}) exceeds posterior index (${aVal}) by ${Math.abs(delta_value)} points. Strong quad drive; glute/hip extension is the relative weakness.${missingNote}`;
    } else {
      label = 'Triceps-dominant presser';
      rationale = `Triceps index (${bVal}) exceeds back tension index (${aVal}) by ${Math.abs(delta_value)} points. Strong lockout; upper back stability may be the limiting factor.${missingNote}`;
    }
  } else {
    label = 'Balanced profile';
    rationale = `Posterior index (${aVal}) and quad/triceps index (${bVal}) are within 15 points of each other — no clear dominance imbalance detected.${missingNote}`;
  }

  return { label, rationale, delta_key, delta_value, delta_units: 'index_points', confidence };
}

// ─── Efficiency score ─────────────────────────────────────────────────────────

function computeEfficiencyScore(
  primaryPhaseConfidence: number,
  archetype: DiagnosticSignals['dominance_archetype'],
  indices: DiagnosticSignals['indices'],
  flags: SessionFlags,
  dataGaps: DataGap[]
): DiagnosticSignals['efficiency_score'] {
  let score = 100;
  const deductions: Deduction[] = [];

  // Clear bottleneck (high phase confidence)
  if (primaryPhaseConfidence > 0.6) {
    deductions.push({
      key: 'clear_bottleneck',
      points: 15,
      reason: 'Strong phase bottleneck identified — targeted work needed.'
    });
    score -= 15;
  } else if (primaryPhaseConfidence > 0.3) {
    deductions.push({
      key: 'moderate_bottleneck',
      points: 8,
      reason: 'Moderate phase bottleneck detected.'
    });
    score -= 8;
  }

  // Dominance imbalance
  if (Math.abs(archetype.delta_value) >= 20 && archetype.confidence >= 0.5) {
    deductions.push({
      key: 'dominance_imbalance',
      points: 10,
      reason: `Significant imbalance detected (${archetype.delta_key.replace('_', ' → ')}, delta: ${archetype.delta_value} points).`
    });
    score -= 10;
  }

  // Stability index low
  const stabilityIndex = indices.back_tension_index;
  if (stabilityIndex && stabilityIndex.value < 70) {
    deductions.push({
      key: 'stability_deficit',
      points: 10,
      reason: `Back tension / stability index low (${stabilityIndex.value}/100).`
    });
    score -= 10;
  }

  // Hard limiter flags
  if (flags.grip_limiting) {
    deductions.push({ key: 'grip_limiter', points: 10, reason: 'Grip is actively limiting performance.' });
    score -= 10;
  }
  if (flags.mobility_restriction) {
    deductions.push({ key: 'mobility_limiter', points: 10, reason: 'Mobility restriction limits position and depth.' });
    score -= 10;
  }
  if (flags.shoulder_discomfort) {
    deductions.push({ key: 'shoulder_health', points: 10, reason: 'Shoulder discomfort may limit load and longevity.' });
    score -= 10;
  }

  // Data gaps (high severity gaps reduce score slightly — unknown ≠ good)
  const highSeverityGaps = dataGaps.filter(g => g.severity === 'high').length;
  if (highSeverityGaps > 0) {
    deductions.push({
      key: 'data_gaps',
      points: 5,
      reason: `${highSeverityGaps} key proxy lift(s) missing — diagnosis confidence is reduced.`
    });
    score -= 5;
  }

  // Clamp to 40–95
  score = Math.min(95, Math.max(40, score));

  const explanation = deductions.length === 0
    ? 'No significant limiters or imbalances detected with current data.'
    : `Score reduced due to: ${deductions.map(d => d.reason).join(' | ')}`;

  return { score, explanation, deductions };
}

// ─── Data gaps ────────────────────────────────────────────────────────────────

function computeDataGaps(
  config: LiftConfig,
  e1rms: Record<string, { value: number }>,
  indices: DiagnosticSignals['indices']
): DataGap[] {
  const gaps: DataGap[] = [];

  // Check which indices have no data
  const allIndexKeys: Array<keyof DiagnosticSignals['indices']> = [
    'quad_index', 'posterior_index', 'back_tension_index', 'triceps_index', 'shoulder_index'
  ];

  // Find which indices this lift config expects
  const expectedIndices = new Set(config.indexMappings.map(m => m.index));

  for (const key of allIndexKeys) {
    if (!expectedIndices.has(key)) continue;
    if (!indices[key]) {
      // Determine which proxies are needed
      const needed = config.indexMappings
        .filter(m => m.index === key)
        .map(m => m.proxy_exercise_id)
        .join(', ');

      const isPrimary = key === 'quad_index' || key === 'posterior_index';
      gaps.push({
        key,
        reason: `No proxy lifts provided for ${key.replace('_', ' ')}. Needed: ${needed}`,
        severity: isPrimary ? 'high' : 'medium'
      });
    }
  }

  // Check for exercises used in hypothesis rules but not provided
  const referencedExercises = new Set<string>();
  for (const rule of [...config.phaseRules, ...config.hypothesisRules]) {
    if (rule.condition.numerator_exercise) referencedExercises.add(rule.condition.numerator_exercise);
    if (rule.condition.denominator_exercise) referencedExercises.add(rule.condition.denominator_exercise);
  }

  for (const exId of referencedExercises) {
    if (!e1rms[exId]) {
      // Only add if not already covered by index gap
      const alreadyCovered = gaps.some(g => g.reason.includes(exId));
      if (!alreadyCovered) {
        gaps.push({
          key: `exercise:${exId}`,
          reason: `No data for ${exId} — some hypothesis rules could not be evaluated`,
          severity: 'low'
        });
      }
    }
  }

  return gaps;
}

// ─── Validation test selection ────────────────────────────────────────────────

function selectValidationTest(
  config: LiftConfig,
  primaryPhase: string,
  topHypothesis: HypothesisSignal | undefined,
  trainingAge: TrainingAge,
  equipment: Equipment
): ValidationTest {
  const DEFAULT: ValidationTest = {
    description: 'Top-set RPE tracking',
    how_to_run: 'Perform your primary lift at your working weight for 3×3. Track RPE and note exactly where bar slows each set. Use this as your phase/hypothesis baseline.',
    hypothesis_tested: 'General phase identification',
    equipment_required: ['barbell'],
    training_age_minimum: 'beginner',
    fallback_used: false
  };

  if (!topHypothesis) return DEFAULT;

  // Find the best matching test entry
  const candidates = config.validationTests.filter(
    t => t.phase_id === primaryPhase && t.hypothesis_key === topHypothesis.key
  );

  if (candidates.length === 0) {
    // Try phase-only match
    const phaseCandidates = config.validationTests.filter(t => t.phase_id === primaryPhase);
    if (phaseCandidates.length === 0) return DEFAULT;
    candidates.push(...phaseCandidates);
  }

  // Training age check helper
  const ageRank: Record<TrainingAge, number> = { beginner: 0, intermediate: 1, advanced: 2 };
  const userRank = ageRank[trainingAge];

  for (const candidate of candidates) {
    const minRank = ageRank[candidate.training_age_minimum];
    if (userRank >= minRank) {
      // Check equipment — if equipment is 'limited' or 'home', prefer simpler tests
      if (equipment !== 'commercial' && candidate.fallback) {
        const fb = candidate.fallback;
        return {
          description: fb.description,
          how_to_run: fb.how_to_run,
          hypothesis_tested: fb.hypothesis_tested,
          equipment_required: fb.equipment_required,
          training_age_minimum: fb.training_age_minimum,
          fallback_used: true,
          fallback_reason: `Equipment type '${equipment}' — using simpler fallback test.`
        };
      }
      return {
        description: candidate.description,
        how_to_run: candidate.how_to_run,
        hypothesis_tested: candidate.hypothesis_tested,
        equipment_required: candidate.equipment_required,
        training_age_minimum: candidate.training_age_minimum,
        fallback_used: false
      };
    }

    // Training age too low — use fallback if available
    if (candidate.fallback) {
      const fb = candidate.fallback;
      const fbMinRank = ageRank[fb.training_age_minimum];
      if (userRank >= fbMinRank) {
        return {
          description: fb.description,
          how_to_run: fb.how_to_run,
          hypothesis_tested: fb.hypothesis_tested,
          equipment_required: fb.equipment_required,
          training_age_minimum: fb.training_age_minimum,
          fallback_used: true,
          fallback_reason: `Training age '${trainingAge}' below minimum for primary test — using beginner-safe fallback.`
        };
      }
    }
  }

  return DEFAULT;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function runDiagnosticEngine(input: DiagnosticEngineInput): DiagnosticSignals {
  const config = getLiftConfig(input.liftId);
  if (!config) {
    throw new Error(`No lift config found for liftId: ${input.liftId}`);
  }

  // 1. Compute e1RMs for all provided snapshots
  const e1rms = computeAllE1RMs(input.snapshots);

  // 2. Get primary lift e1RM
  const primaryLiftData = e1rms[input.primaryExerciseId];
  const primaryE1RM = primaryLiftData?.value ?? 0;

  // 3. Compute indices (only where proxy data exists)
  const indices = computeAllIndices(config, e1rms, primaryE1RM);

  // 4. Score phases
  const phase_scores = scorePhases(config, e1rms, input.flags, primaryE1RM);
  const { primary_phase, primary_phase_confidence, phase_tie, secondary_phase } =
    computePhaseConfidence(phase_scores);

  // 5. Score hypotheses
  const hypothesis_scores = scoreHypotheses(config, e1rms, input.flags, primaryE1RM);

  // 6. Compute dominance archetype
  const dominance_archetype = computeDominanceArchetype(input.liftId, indices, primary_phase);

  // 7. Compute data gaps
  const data_gaps = computeDataGaps(config, e1rms, indices);

  // 8. Compute efficiency score
  const efficiency_score = computeEfficiencyScore(
    primary_phase_confidence,
    dominance_archetype,
    indices,
    input.flags,
    data_gaps
  );

  // 9. Select validation test
  const topHypothesis = hypothesis_scores[0];
  const validation_test = selectValidationTest(
    config,
    primary_phase,
    topHypothesis,
    input.trainingAge,
    input.equipment
  );

  return {
    signals_version: SIGNALS_VERSION,
    lift_config_version: LIFT_CONFIG_VERSION,
    e1rms,
    indices,
    phase_scores,
    primary_phase,
    primary_phase_confidence,
    phase_tie,
    secondary_phase,
    hypothesis_scores,
    dominance_archetype,
    efficiency_score,
    validation_test,
    data_gaps
  };
}
