import OpenAI from 'openai';
import { getLiftById } from '../data/lifts.js';
import { getBiomechanicsForLift } from '../data/biomechanics.js';
import { getApprovedAccessories, getStabilityExercises, generateIntensityRecommendation } from '../engine/rulesEngine.js';
import { runDiagnosticEngine, type DiagnosticSignals, type SnapshotInput, type SessionFlags } from '../engine/diagnosticEngine.js';
import type { TrainingAge, Equipment } from '../engine/liftConfigs.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface DiagnosticContext {
  selectedLift: string;
  trainingAge?: string;
  goal?: string;
  equipment?: string;
  constraints?: string;
  bodyweightLbs?: number;
  sessionFlags?: SessionFlags;
  snapshots?: Array<{
    exerciseId: string;
    exerciseName: string;
    weight: number;
    sets: number;
    repsSchema: string;
    rpeOrRir?: string;
  }>;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    message: string;
  }>;
}

export interface DiagnosticResponse {
  question?: string;
  complete: boolean;
  needsMoreInfo: boolean;
}

export interface InitialAnalysisResult {
  analysis: string;
  tailoredQuestions: string[];
  identifiedWeaknesses: string[];
  signals?: DiagnosticSignals;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTrainingAge(raw?: string): TrainingAge {
  if (raw === 'beginner' || raw === 'intermediate' || raw === 'advanced') return raw;
  return 'intermediate';
}

function normalizeEquipment(raw?: string): Equipment {
  if (raw === 'commercial' || raw === 'limited' || raw === 'home') return raw;
  return 'commercial';
}

/**
 * Convert DiagnosticContext snapshots to the SnapshotInput shape expected by the engine.
 * repsSchema is stored as a string like "5" or "5-8" — we take the first number.
 */
function toSnapshotInputs(
  snapshots: DiagnosticContext['snapshots']
): SnapshotInput[] {
  if (!snapshots) return [];
  return snapshots.map(s => {
    const reps = parseInt(s.repsSchema.toString().split('-')[0], 10) || 1;
    return {
      exerciseId: s.exerciseId,
      weight: s.weight,
      reps,
      sets: s.sets
    };
  });
}

/**
 * Serialize DiagnosticSignals into a compact, human-readable block
 * that we inject verbatim into LLM prompts.
 */
function formatSignalsForPrompt(signals: DiagnosticSignals): string {
  const lines: string[] = [];

  lines.push('=== PRE-COMPUTED DIAGNOSTIC SIGNALS (do not recompute — use these directly) ===');
  lines.push(`Signals version: ${signals.signals_version} | Config version: ${signals.lift_config_version}`);

  // e1RMs
  lines.push('\n--- e1RM Estimates ---');
  for (const [ex, data] of Object.entries(signals.e1rms)) {
    const clampNote = data.reps_clamped ? ` [reps clamped from actual to 10 for formula reliability]` : '';
    lines.push(`  ${ex}: ${data.value} lbs (${data.reps_used} rep set, confidence: ${data.confidence}${clampNote})`);
  }

  // Indices
  lines.push('\n--- Strength Indices (0–100, relative to primary lift) ---');
  const indexKeys = ['quad_index', 'posterior_index', 'back_tension_index', 'triceps_index', 'shoulder_index'] as const;
  let anyIndex = false;
  for (const key of indexKeys) {
    const idx = signals.indices[key];
    if (idx) {
      anyIndex = true;
      lines.push(`  ${key}: ${idx.value}/100 (confidence: ${idx.confidence.toFixed(2)}, sources: ${idx.sources.join(', ')})`);
    }
  }
  if (!anyIndex) lines.push('  No indices computed — insufficient proxy lift data.');

  // Phase scores
  lines.push('\n--- Phase Scores ---');
  if (signals.phase_scores.length === 0) {
    lines.push('  No phase rules fired — ask the lifter where they fail.');
  } else {
    for (const ps of signals.phase_scores) {
      lines.push(`  ${ps.phase_id}: ${ps.points} pts`);
    }
  }
  lines.push(`  PRIMARY PHASE: ${signals.primary_phase} (confidence: ${signals.primary_phase_confidence.toFixed(2)}${signals.phase_tie ? ', TIE — ask confirmatory question' : ''})`);
  if (signals.secondary_phase) lines.push(`  Secondary phase: ${signals.secondary_phase}`);

  // Hypotheses
  lines.push('\n--- Hypothesis Scores (top ranked) ---');
  for (const h of signals.hypothesis_scores) {
    lines.push(`  [${h.score}/100] ${h.label} (${h.category})`);
    for (const ev of h.evidence) {
      lines.push(`    • ${ev}`);
    }
  }

  // Archetype
  lines.push('\n--- Dominance Archetype ---');
  lines.push(`  ${signals.dominance_archetype.label}`);
  lines.push(`  ${signals.dominance_archetype.rationale}`);
  lines.push(`  Delta: ${signals.dominance_archetype.delta_key} = ${signals.dominance_archetype.delta_value} index points (confidence: ${signals.dominance_archetype.confidence.toFixed(2)})`);

  // Efficiency score
  lines.push('\n--- Efficiency Score ---');
  lines.push(`  Score: ${signals.efficiency_score.score}/100`);
  lines.push(`  ${signals.efficiency_score.explanation}`);
  if (signals.efficiency_score.deductions.length > 0) {
    for (const d of signals.efficiency_score.deductions) {
      lines.push(`    −${d.points}: ${d.reason}`);
    }
  }

  // Validation test
  lines.push('\n--- Validation Test ---');
  lines.push(`  "${signals.validation_test.description}"`);
  lines.push(`  How to run: ${signals.validation_test.how_to_run}`);
  lines.push(`  Tests: ${signals.validation_test.hypothesis_tested}`);
  if (signals.validation_test.fallback_used) {
    lines.push(`  [Fallback test used: ${signals.validation_test.fallback_reason}]`);
  }

  // Data gaps
  if (signals.data_gaps.length > 0) {
    lines.push('\n--- Data Gaps (PRIORITIZE resolving these in interview) ---');
    for (const gap of signals.data_gaps) {
      lines.push(`  [${gap.severity.toUpperCase()}] ${gap.key}: ${gap.reason}`);
    }
  }

  lines.push('\n=== END DIAGNOSTIC SIGNALS ===');
  return lines.join('\n');
}

// ─── Stage 1: Initial Analysis ────────────────────────────────────────────────

/**
 * Analyzes user's snapshot data and generates 3 tailored diagnostic questions.
 * Runs the deterministic diagnostic engine first, then uses the LLM to explain
 * and generate targeted questions.
 */
export async function generateInitialAnalysis(
  context: DiagnosticContext
): Promise<InitialAnalysisResult> {
  const lift = getLiftById(context.selectedLift);
  const biomechanics = getBiomechanicsForLift(context.selectedLift);

  if (!lift || !biomechanics) {
    throw new Error('Invalid lift selected or biomechanics data not found');
  }

  if (!context.snapshots || context.snapshots.length === 0) {
    throw new Error('No snapshot data provided for analysis');
  }

  // Run the deterministic engine first
  const engineInput = {
    liftId: context.selectedLift,
    primaryExerciseId: context.selectedLift,
    snapshots: toSnapshotInputs(context.snapshots),
    flags: context.sessionFlags ?? {},
    bodyweightLbs: context.bodyweightLbs ?? 185,
    trainingAge: normalizeTrainingAge(context.trainingAge),
    equipment: normalizeEquipment(context.equipment)
  };

  const signals = runDiagnosticEngine(engineInput);
  const signalsBlock = formatSignalsForPrompt(signals);

  const systemPrompt = `You are an expert strength coach analyzing a lifter's strength profile for ${lift.name}.

${signalsBlock}

IMPORTANT INSTRUCTIONS:
- Do NOT recompute ratios or e1RMs. Use the pre-computed signals above verbatim.
- Reference actual numbers from the signals in your analysis and questions.
- If primary_phase_confidence is below 0.4 or phase_tie is true, your questions MUST include a direct phase-confirmation question.
- Use data_gaps to identify what proxy lift information is missing. Ask interview questions that fill the highest-severity gaps.
- The dominance archetype and efficiency score should inform your narrative but not be stated numerically to the user — translate them into coaching language.

BIOMECHANICS CONTEXT — ${lift.name}:
${biomechanics.movementPhases.map(phase => `
Phase: ${phase.phaseName}
- Primary: ${phase.primaryMuscles.map(m => m.muscle).join(', ')}
- Common failure: ${phase.commonFailurePoint}
`).join('\n')}

USER SNAPSHOT:
${context.snapshots.map(s => `- ${s.exerciseName}: ${s.weight} lbs × ${s.sets}×${s.repsSchema}${s.rpeOrRir ? ` @ ${s.rpeOrRir}` : ''}`).join('\n')}

TRAINING CONTEXT:
- Training age: ${context.trainingAge || 'unknown'}
- Goal: ${context.goal || 'strength'}
- Equipment: ${context.equipment || 'commercial'}

YOUR TASK:
1. Write a 2–3 paragraph analysis that:
   a) States key ratios and what they reveal (use signal numbers, not your own math)
   b) Interprets the top hypothesis and archetype in coaching language
   c) Notes any uncertainty (low confidence phase, data gaps)
2. Generate EXACTLY 3 targeted diagnostic questions that:
   - Question 1: Confirms or challenges the PRIMARY PHASE (must reference the specific phase from signals)
   - Question 2: Probes the TOP HYPOTHESIS (muscle/mechanical/stability) with specifics from their numbers
   - Question 3: Either resolves a HIGH-severity data gap OR asks about subjective experience to confirm/refute the hypothesis
3. List 1–3 identified weaknesses with ratio evidence from the signals.

OUTPUT FORMAT (JSON):
{
  "analysis": "...",
  "tailoredQuestions": ["question1", "question2", "question3"],
  "identifiedWeaknesses": ["weakness with ratio evidence", ...]
}

TONE: Specific, data-driven, coach-like. Reference actual numbers from the signals.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Analyze the snapshot data and generate 3 tailored diagnostic questions.' }
    ],
    temperature: 0.6,
    max_tokens: 900,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content || '{}';
  const result = JSON.parse(content);

  return {
    analysis: result.analysis || 'Analysis not available',
    tailoredQuestions: result.tailoredQuestions || [],
    identifiedWeaknesses: result.identifiedWeaknesses || [],
    signals
  };
}

// ─── Stage 2: Diagnostic Interview ───────────────────────────────────────────

export async function generateDiagnosticQuestion(
  context: DiagnosticContext
): Promise<DiagnosticResponse> {
  const lift = getLiftById(context.selectedLift);
  if (!lift) {
    throw new Error('Invalid lift selected');
  }

  const questionCount = context.conversationHistory.filter(m => m.role === 'assistant').length;

  if (questionCount >= 8) {
    return { complete: true, needsMoreInfo: false };
  }

  // Run engine with current flags to get live signals for the interview
  const signals = runDiagnosticEngine({
    liftId: context.selectedLift,
    primaryExerciseId: context.selectedLift,
    snapshots: toSnapshotInputs(context.snapshots),
    flags: context.sessionFlags ?? {},
    bodyweightLbs: context.bodyweightLbs ?? 185,
    trainingAge: normalizeTrainingAge(context.trainingAge),
    equipment: normalizeEquipment(context.equipment)
  });

  // Compact signals summary for interview (just the most action-relevant parts)
  const interviewSignalsSummary = [
    `Primary phase: ${signals.primary_phase} (confidence: ${signals.primary_phase_confidence.toFixed(2)}${signals.phase_tie ? ', TIE' : ''})`,
    `Top hypothesis: ${signals.hypothesis_scores[0]?.label ?? 'none'} (${signals.hypothesis_scores[0]?.score ?? 0}/100)`,
    signals.data_gaps.length > 0
      ? `High-priority data gaps: ${signals.data_gaps.filter(g => g.severity === 'high').map(g => g.key).join(', ') || 'none'}`
      : 'No high-severity data gaps.'
  ].join('\n');

  const systemPrompt = `You are an expert strength coach conducting a diagnostic interview for ${lift.name}.

CURRENT ENGINE SIGNALS:
${interviewSignalsSummary}

IMPORTANT: Do NOT recompute ratios. Your job in the interview is to:
1. Ask questions that CONFIRM or REFUTE the top hypothesis via subjective experience
2. Resolve any high-priority data gaps (ask the lifter if they do those exercises)
3. Confirm the primary phase if confidence is low or there is a tie

LIFT PHASES:
${lift.phases.map(p => `- ${p.name}: ${p.description}\n  Issues: ${p.commonIssues.join(', ')}`).join('\n')}

POSSIBLE LIMITERS:
${lift.commonLimiters.map(l => `- ${l.name}: ${l.description}`).join('\n')}

CONTEXT:
- Training Age: ${context.trainingAge || 'unknown'}
- Goal: ${context.goal || 'general strength'}
- Equipment: ${context.equipment || 'commercial'}

RULES:
1. Ask ONE specific, clear question per turn
2. Build on previous answers — do not repeat themes
3. After 4–6 questions with clear answers, you should have enough to finalize diagnosis
4. If you have sufficient confirmation of phase + top hypothesis, respond with DIAGNOSIS_READY

Current question count: ${questionCount}/8`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt }
  ];

  context.conversationHistory.forEach(msg => {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.message
    });
  });

  messages.push({
    role: 'user',
    content: questionCount === 0
      ? 'Begin the diagnostic interview with the most important question to identify the limiting factor.'
      : "Based on the user's response, ask your next diagnostic question or indicate DIAGNOSIS_READY if you have sufficient information."
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.7,
    max_tokens: 200
  });

  const assistantMessage = response.choices[0].message.content || '';

  if (assistantMessage.includes('DIAGNOSIS_READY') || questionCount >= 6) {
    return { complete: true, needsMoreInfo: false };
  }

  return { question: assistantMessage, complete: false, needsMoreInfo: true };
}

// ─── Stage 3: Workout Plan ────────────────────────────────────────────────────

export interface WorkoutPlan {
  selected_lift: string;
  diagnosis: Array<{
    limiter: string;
    limiterName: string;
    confidence: number;
    evidence: string[];
  }>;
  bench_day_plan: {
    primary_lift: {
      exercise_id: string;
      exercise_name: string;
      sets: number;
      reps: string;
      intensity: string;
      rest_minutes: number;
    };
    accessories: Array<{
      exercise_id: string;
      exercise_name: string;
      sets: number;
      reps: string;
      why: string;
      category: string;
    }>;
  };
  progression_rules: string[];
  track_next_time: string[];
  // Fields from diagnostic engine
  dominance_archetype: {
    label: string;
    rationale: string;
    delta_value?: number;
  };
  efficiency_score: {
    score: number;
    explanation: string;
  };
  validation_test: {
    description: string;
    how_to_run: string;
    hypothesis_tested: string;
  };
  // Visualization data from diagnostic engine
  diagnostic_signals: {
    indices: DiagnosticSignals['indices'];
    phase_scores: DiagnosticSignals['phase_scores'];
    primary_phase: string;
    primary_phase_confidence: number;
    hypothesis_scores: DiagnosticSignals['hypothesis_scores'];
    efficiency_score: DiagnosticSignals['efficiency_score'];
  };
}

export async function generateWorkoutPlan(
  context: DiagnosticContext
): Promise<WorkoutPlan> {
  const lift = getLiftById(context.selectedLift);
  const biomechanics = getBiomechanicsForLift(context.selectedLift);

  if (!lift || !biomechanics) {
    throw new Error('Invalid lift selected or biomechanics data not found');
  }

  // Run engine with all accumulated flags from interview
  const signals = runDiagnosticEngine({
    liftId: context.selectedLift,
    primaryExerciseId: context.selectedLift,
    snapshots: toSnapshotInputs(context.snapshots),
    flags: context.sessionFlags ?? {},
    bodyweightLbs: context.bodyweightLbs ?? 185,
    trainingAge: normalizeTrainingAge(context.trainingAge),
    equipment: normalizeEquipment(context.equipment)
  });

  const signalsBlock = formatSignalsForPrompt(signals);

  const snapshotSummary = context.snapshots && context.snapshots.length > 0
    ? context.snapshots.map(s =>
        `- ${s.exerciseName}: ${s.weight} lbs × ${s.sets}×${s.repsSchema}${s.rpeOrRir ? ` @ ${s.rpeOrRir}` : ''}`
      ).join('\n')
    : 'No snapshot data available';

  const systemPrompt = `You are an expert strength coach creating a personalized training plan for ${lift.name}.

${signalsBlock}

CRITICAL INSTRUCTIONS:
- Do NOT recompute ratios or e1RMs. The signals above are the ground truth.
- Your job is to: (1) write evidence narratives using signal data, (2) prescribe accessories targeting the top hypotheses, (3) include the validation test verbatim.
- Evidence must cite actual numbers and ratios from the signals — not generic statements.
- The validation_test in your output must match the one provided in the signals above.

LIFT: ${lift.name}
TRAINING AGE: ${context.trainingAge || 'intermediate'}
GOAL: ${context.goal || 'strength_peak'}
EQUIPMENT: ${context.equipment || 'commercial'}
${context.constraints ? `CONSTRAINTS: ${context.constraints}` : ''}

USER SNAPSHOT:
${snapshotSummary}

POSSIBLE LIMITERS:
${lift.commonLimiters.map(l => `
- ID: ${l.id}
  Name: ${l.name}
  Description: ${l.description}
  Target Muscles: ${l.targetMuscles.join(', ')}
`).join('\n')}

DIAGNOSTIC CONVERSATION:
${context.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.message}`).join('\n\n')}

YOUR TASK:
1. Map engine's top 1–2 hypotheses to the limiter IDs above (use closest match)
2. For each limiter, write 3–5 evidence points using actual weights, ratios, and user quotes from conversation
3. Select primary lift programming (sets/reps/intensity) appropriate for training age and goal
4. Choose 2–4 accessories that directly target the top hypothesis phase and muscles
5. Include the validation test from the signals (copy how_to_run verbatim)
6. Provide progression rules and tracking metrics

OUTPUT ONLY VALID JSON:
{
  "diagnosis": [
    {
      "limiter": "limiter_id_from_above",
      "limiterName": "Human readable name",
      "confidence": 0.75,
      "evidence": [
        "Specific evidence with actual weights and ratios from the signals",
        "User quote from conversation if available",
        "Biomechanical explanation of why this matters"
      ]
    }
  ],
  "primary_lift": {
    "sets": 4,
    "reps": "5",
    "intensity": "RIR 1-2",
    "rest_minutes": 3
  },
  "accessories": [
    {
      "exercise_id": "exercise_id",
      "exercise_name": "Exercise Name",
      "sets": 3,
      "reps": "8-10",
      "why": "Specific explanation of how this targets the identified phase/hypothesis",
      "category": "targeted|stability|hypertrophy"
    }
  ],
  "progression_rules": ["..."],
  "track_next_time": ["..."]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the workout plan now.' }
    ],
    temperature: 0.5,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content || '{}';
  const planData = JSON.parse(content);

  const plan: WorkoutPlan = {
    selected_lift: context.selectedLift,
    diagnosis: planData.diagnosis || [],
    bench_day_plan: {
      primary_lift: {
        exercise_id: context.selectedLift,
        exercise_name: lift.name,
        sets: planData.primary_lift?.sets || 4,
        reps: planData.primary_lift?.reps || '5',
        intensity: planData.primary_lift?.intensity || 'RIR 1-2',
        rest_minutes: planData.primary_lift?.rest_minutes || 3
      },
      accessories: planData.accessories || []
    },
    progression_rules: planData.progression_rules || ['Add weight when all sets completed at target RIR'],
    track_next_time: planData.track_next_time || ['Sticking point location', 'RPE at same load'],
    // Directly from engine — not from LLM
    dominance_archetype: {
      label: signals.dominance_archetype.label,
      rationale: signals.dominance_archetype.rationale,
      delta_value: signals.dominance_archetype.delta_value
    },
    efficiency_score: {
      score: signals.efficiency_score.score,
      explanation: signals.efficiency_score.explanation
    },
    validation_test: {
      description: signals.validation_test.description,
      how_to_run: signals.validation_test.how_to_run,
      hypothesis_tested: signals.validation_test.hypothesis_tested
    },
    diagnostic_signals: {
      indices: signals.indices,
      phase_scores: signals.phase_scores,
      primary_phase: signals.primary_phase,
      primary_phase_confidence: signals.primary_phase_confidence,
      hypothesis_scores: signals.hypothesis_scores,
      efficiency_score: signals.efficiency_score
    }
  };

  return plan;
}
