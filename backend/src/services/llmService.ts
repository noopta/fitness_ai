import OpenAI from 'openai';
import { getLiftById } from '../data/lifts.js';
import { getBiomechanicsForLift } from '../data/biomechanics.js';
import { getApprovedAccessories, getStabilityExercises, generateIntensityRecommendation } from '../engine/rulesEngine.js';
import { runDiagnosticEngine, type DiagnosticSignals, type SnapshotInput, type SessionFlags } from '../engine/diagnosticEngine.js';
import type { TrainingAge, Equipment } from '../engine/liftConfigs.js';
import { buildRAGContext } from './ragService.js';

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

  if (!lift) {
    throw new Error('Invalid lift selected');
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
${biomechanics ? biomechanics.movementPhases.map(phase => `
Phase: ${phase.phaseName}
- Primary: ${phase.primaryMuscles.map(m => m.muscle).join(', ')}
- Common failure: ${phase.commonFailurePoint}
`).join('\n') : lift.phases.map(p => `Phase: ${p.name}\n- Common issues: ${p.commonIssues.join(', ')}`).join('\n')}

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

  const ragQuery = `${lift.name} training techniques, common weaknesses, strength assessment, ${signals.hypothesis_scores[0]?.label ?? ''}`;
  const ragContext = await buildRAGContext(ragQuery, 4);
  const finalSystemPrompt = ragContext
    ? `${systemPrompt}\n\n${ragContext}`
    : systemPrompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: 'Analyze the snapshot data and generate 3 tailored diagnostic questions.' }
    ],
    max_completion_tokens: 2000,
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

  const ragQuery = `${lift.name} ${signals.hypothesis_scores[0]?.label ?? ''} diagnostic assessment strength training`;
  const ragContext = await buildRAGContext(ragQuery, 3);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: ragContext ? `${systemPrompt}\n\n${ragContext}` : systemPrompt }
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
    model: 'gpt-4.1',
    messages,
    max_completion_tokens: 1000
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
      priority: 1 | 2 | 3;
      impact: 'high' | 'medium' | 'low';
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

  if (!lift) {
    throw new Error('Invalid lift selected');
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
7. For each accessory, assign:
   - priority: 1 (most critical — directly targets the primary limiter), 2 (important secondary work), or 3 (supportive/general)
   - impact: "high" (directly addresses the identified weakness), "medium" (supports it indirectly), or "low" (general maintenance)
   - Order accessories in the array by priority ascending (1 first)

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
      "category": "targeted|stability|hypertrophy",
      "priority": 1,
      "impact": "high"
    }
  ],
  "progression_rules": ["..."],
  "track_next_time": ["..."]
}`;

  const ragQuery = `${lift.name} accessories exercises ${signals.hypothesis_scores[0]?.label ?? ''} ${signals.primary_phase} weakness correction`;
  const ragContext = await buildRAGContext(ragQuery, 4);
  const finalSystemPrompt = ragContext
    ? `${systemPrompt}\n\n${ragContext}`
    : systemPrompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: 'Generate the workout plan now.' }
    ],
    max_completion_tokens: 3000,
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

// ─── Stage 4: Chat Thread ──────────────────────────────────────────────────────

export interface ChatSessionContext {
  selectedLift: string;
  profile?: {
    trainingAge?: string;
    goal?: string;
    equipment?: string;
    constraintsText?: string;
    weightKg?: number;
    heightCm?: number;
  };
  snapshots: Array<{
    exerciseId: string;
    weight: number;
    sets: number;
    repsSchema: string;
    rpeOrRir?: string;
  }>;
  diagnosticMessages: Array<{ role: string; message: string }>;
  plan: WorkoutPlan | null;
}

/**
 * Creates an OpenAI Thread for a session and injects the full session context
 * as the first message. Returns the thread ID to be stored on the session.
 */
export async function createChatThread(ctx: ChatSessionContext): Promise<string> {
  const thread = await openai.beta.threads.create();

  // Build the context block injected once — never re-sent on subsequent messages
  const lines: string[] = [];

  lines.push('=== SESSION CONTEXT ===');
  lines.push(`Primary lift: ${ctx.selectedLift}`);

  if (ctx.profile) {
    const p = ctx.profile;
    lines.push('\n--- Athlete Profile ---');
    if (p.trainingAge) lines.push(`  Training age: ${p.trainingAge}`);
    if (p.goal)        lines.push(`  Goal: ${p.goal}`);
    if (p.equipment)   lines.push(`  Equipment: ${p.equipment}`);
    if (p.weightKg)    lines.push(`  Bodyweight: ${p.weightKg} kg`);
    if (p.constraintsText) lines.push(`  Constraints/injuries: ${p.constraintsText}`);
  }

  if (ctx.snapshots.length > 0) {
    lines.push('\n--- Working Weights Logged ---');
    for (const s of ctx.snapshots) {
      lines.push(`  ${s.exerciseId}: ${s.weight} lbs × ${s.sets} sets × ${s.repsSchema} reps${s.rpeOrRir ? ` @ RPE ${s.rpeOrRir}` : ''}`);
    }
  }

  if (ctx.diagnosticMessages.length > 0) {
    lines.push('\n--- Diagnostic Q&A ---');
    for (const m of ctx.diagnosticMessages) {
      lines.push(`  ${m.role === 'user' ? 'Athlete' : 'Coach'}: ${m.message}`);
    }
  }

  if (ctx.plan) {
    const plan = ctx.plan;
    lines.push('\n--- AI Diagnosis ---');
    for (const d of plan.diagnosis) {
      lines.push(`  ${d.limiterName} (${Math.round(d.confidence * 100)}% confidence)`);
      for (const ev of d.evidence) lines.push(`    • ${ev}`);
    }

    lines.push('\n--- Prescribed Plan ---');
    const pl = plan.bench_day_plan.primary_lift;
    lines.push(`  Primary: ${pl.exercise_name} — ${pl.sets}×${pl.reps} @ ${pl.intensity}, rest ${pl.rest_minutes} min`);
    lines.push('  Accessories (ranked by priority):');
    for (const a of plan.bench_day_plan.accessories) {
      lines.push(`    ${a.priority ? `[P${a.priority}]` : ''} ${a.exercise_name}: ${a.sets}×${a.reps} — ${a.why}`);
    }

    lines.push('\n--- Progression Rules ---');
    for (const r of plan.progression_rules) lines.push(`  • ${r}`);

    lines.push('\n--- Track Next Time ---');
    for (const t of plan.track_next_time) lines.push(`  • ${t}`);

    if (plan.diagnostic_signals) {
      const ds = plan.diagnostic_signals;
      lines.push('\n--- Strength Indices ---');
      for (const [key, val] of Object.entries(ds.indices)) {
        if (val) lines.push(`  ${key}: ${val.value}/100 (confidence: ${val.confidence.toFixed(2)})`);
      }
      lines.push(`\n--- Lift Phase Breakdown ---`);
      lines.push(`  Primary weak phase: ${ds.primary_phase} (${Math.round(ds.primary_phase_confidence * 100)}% confidence)`);
      for (const ps of ds.phase_scores) lines.push(`  ${ps.phase_id}: ${ps.points} pts`);
      lines.push(`\n--- Weakness Hypotheses ---`);
      for (const h of ds.hypothesis_scores) {
        lines.push(`  [${h.score}/100] ${h.label} (${h.category})`);
      }
      lines.push(`\n--- Balance Score ---`);
      lines.push(`  ${ds.efficiency_score.score}/100 — ${ds.efficiency_score.explanation}`);
    }

    if (plan.dominance_archetype) {
      lines.push(`\n--- Strength Archetype ---`);
      lines.push(`  ${plan.dominance_archetype.label}: ${plan.dominance_archetype.rationale}`);
    }

    if (plan.validation_test) {
      lines.push(`\n--- Validation Test ---`);
      lines.push(`  ${plan.validation_test.description}`);
      lines.push(`  How: ${plan.validation_test.how_to_run}`);
    }
  }

  lines.push('\n=== END SESSION CONTEXT ===');
  lines.push('\nThe athlete is now asking follow-up questions. Answer based on the above data.');

  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: lines.join('\n'),
  });

  // Prime the assistant so it acknowledges the context
  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    additional_instructions: 'Acknowledge you have their session data and are ready for questions. Keep it brief (1-2 sentences).',
  });

  if (run.status !== 'completed') {
    throw new Error(`Thread priming failed: ${run.status}`);
  }

  return thread.id;
}

// ─── AI Coach ─────────────────────────────────────────────────────────────────

export interface CoachSession {
  id: string;
  selectedLift: string;
  createdAt: Date;
  primaryLimiter: string | null;
  confidence: number | null;
  archetype: string | null;
  efficiencyScore: number | null;
  accessories: string[];
  plan: any;
}

/**
 * Creates a persistent AI Coach thread scoped to the user.
 * Injects the user's full analysis history as context.
 */
export async function createCoachThread(params: {
  userName: string | null;
  trainingAge: string | null;
  equipment: string | null;
  constraintsText: string | null;
  heightCm: number | null;
  weightKg: number | null;
  sessions: CoachSession[];
}): Promise<string> {
  const thread = await openai.beta.threads.create();

  const lines: string[] = [];
  lines.push('=== AI COACH CONTEXT ===');
  lines.push(`\nAthlete: ${params.userName || 'Unknown'}`);
  if (params.trainingAge) lines.push(`Training Age: ${params.trainingAge}`);
  if (params.equipment) lines.push(`Equipment: ${params.equipment}`);
  if (params.heightCm) lines.push(`Height: ${params.heightCm} cm`);
  if (params.weightKg) lines.push(`Weight: ${params.weightKg} kg`);
  if (params.constraintsText) lines.push(`Constraints/Injuries: ${params.constraintsText}`);

  lines.push(`\nTotal analyses completed: ${params.sessions.length}`);

  if (params.sessions.length > 0) {
    lines.push('\n=== FULL ANALYSIS HISTORY ===');
    for (const s of params.sessions) {
      lines.push(`\n--- Analysis: ${s.selectedLift.replace(/_/g, ' ').toUpperCase()} (${new Date(s.createdAt).toLocaleDateString()}) ---`);
      if (s.primaryLimiter) lines.push(`  Primary Limiter: ${s.primaryLimiter} (${s.confidence ? Math.round(s.confidence * 100) : '?'}% confidence)`);
      if (s.archetype) lines.push(`  Strength Archetype: ${s.archetype}`);
      if (s.efficiencyScore !== null) lines.push(`  Muscle Balance Score: ${s.efficiencyScore}/100`);
      if (s.accessories.length > 0) lines.push(`  Prescribed Accessories: ${s.accessories.join(', ')}`);
      if (s.plan?.diagnosis) {
        lines.push('  All Limiters Identified:');
        for (const d of s.plan.diagnosis) {
          lines.push(`    - ${d.limiterName} (${Math.round((d.confidence || 0) * 100)}%): ${(d.evidence || []).join('; ')}`);
        }
      }
      if (s.plan?.bench_day_plan?.accessories) {
        const accs = s.plan.bench_day_plan.accessories;
        if (accs.length > 0) {
          lines.push('  Accessory Prescriptions:');
          for (const a of accs) {
            lines.push(`    - ${a.exercise_name}: ${a.sets}x${a.reps} — ${a.why}`);
          }
        }
      }
      if (s.plan?.progression_rules) {
        lines.push(`  Progression Notes: ${s.plan.progression_rules.join('; ')}`);
      }
    }
  }

  lines.push('\n=== COACH INSTRUCTIONS ===');
  lines.push(`You are an elite AI strength coach with deep expertise equivalent to NSCA-CSCS, ACE, and ISSN certifications.`);
  lines.push(`You have full access to this athlete's diagnostic history above. Reference it specifically in your responses.`);
  lines.push(`You cover ALL coaching domains: program design, nutrition, recovery, wellness, injury prevention, education, and accountability.`);
  lines.push(`Be direct, evidence-based, and specific. Always tie advice back to the athlete's actual data when relevant.`);
  lines.push(`Use markdown formatting for structured responses (headers, bullet points, bold key points).`);
  lines.push('=== END CONTEXT ===');

  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: lines.join('\n'),
  });

  const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    additional_instructions: 'You now have this athlete\'s full profile and history. Introduce yourself briefly as their AI coach and mention one specific insight from their data. Keep it to 2-3 sentences.',
  });

  if (run.status !== 'completed') {
    throw new Error(`Coach thread priming failed: ${run.status}`);
  }

  return thread.id;
}

/**
 * Sends a message to an existing coach thread and returns the reply.
 */
export async function sendCoachMessage(threadId: string, userMessage: string): Promise<string> {
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: userMessage,
  });

  const ragContext = await buildRAGContext(userMessage, 4);

  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    additional_instructions: ragContext || undefined,
  });

  if (run.status !== 'completed') {
    throw new Error(`Coach run failed: ${run.status}`);
  }

  const messages = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
  const latest = messages.data[0];
  if (!latest || latest.role !== 'assistant') throw new Error('No coach reply found');

  const content = latest.content[0];
  if (content.type !== 'text') throw new Error('Unexpected content type');

  return content.text.value;
}

/**
 * Fetches the full message history from a coach thread.
 */
export async function getCoachMessages(threadId: string): Promise<Array<{ role: string; content: string }>> {
  const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc', limit: 100 });
  // Skip the first message (context injection) — it's internal
  const filtered = messages.data.slice(1);
  return filtered.map(m => ({
    role: m.role,
    content: m.content[0]?.type === 'text' ? m.content[0].text.value : '',
  }));
}

// ─── Coach Extras: Nutrition Plan ─────────────────────────────────────────────

export interface NutritionPlanResult {
  macros: { proteinG: number; carbsG: number; fatG: number; calories: number };
  foods: Array<{ name: string; reason: string }>;
  rationale: string;
  impact?: {
    bodyComposition: string; // e.g. "Lean muscle gain at ~0.5 lb/week"
    energy: string;          // e.g. "High — carbs fuel 4× training sessions"
    mood: string;            // e.g. "Stable — adequate calories prevent dips"
    recovery: string;        // e.g. "Optimized — protein supports MPS"
  };
  expectedOutcomes?: {
    tdee: number;            // Estimated total daily energy expenditure (kcal)
    surplusOrDeficit: number; // positive = surplus, negative = deficit
    weeklyWeightChangeLb: number;  // e.g. +0.5 or -1.0
    monthlyWeightChangeLb: number; // weeklyWeightChangeLb * 4.33
    strengthGainNote: string; // e.g. "At a 250 kcal surplus, expect +2–3% strength gain over 8 weeks"
  };
}

export interface MealSuggestion {
  name: string;
  description: string;
  mealType: string; // "breakfast" | "lunch" | "dinner" | "snack"
  macros: { proteinG: number; carbsG: number; fatG: number; calories: number };
  estimatedCostUSD: number;
  prepMinutes: number;
  keyIngredients: string[];
}

/**
 * Converts a dietary restriction value (from coachProfile) into a human-readable
 * instruction block for LLM prompts.
 */
function buildDietaryNote(dietaryRestrictions: string | null | undefined): string {
  if (!dietaryRestrictions || dietaryRestrictions === 'none') return '';
  const map: Record<string, string> = {
    vegetarian:   'DIETARY RESTRICTION: Vegetarian — no meat or fish. Use eggs, dairy, legumes, tofu, tempeh as protein sources.',
    vegan:        'DIETARY RESTRICTION: Vegan — no animal products whatsoever (no meat, fish, eggs, dairy, honey). Use legumes, tofu, tempeh, edamame, seitan, nutritional yeast, plant-based protein.',
    gluten_free:  'DIETARY RESTRICTION: Gluten-free — no wheat, barley, rye, or regular oats. Use rice, quinoa, certified GF oats, potatoes, corn.',
    dairy_free:   'DIETARY RESTRICTION: Dairy-free — no milk, cheese, yogurt, whey, or butter. Use plant milks, dairy-free yogurt, plant-based protein powders (pea, rice, hemp).',
    halal_kosher: 'DIETARY RESTRICTION: Halal/Kosher — no pork or pork derivatives; halal/kosher meat sourcing required. Avoid shellfish for kosher.',
    allergies:    'DIETARY RESTRICTION: Food allergies reported — avoid common allergens (nuts, shellfish, etc.). Do not suggest nut-based foods, shellfish, or any high-allergen foods.',
  };
  return map[dietaryRestrictions] || `DIETARY RESTRICTION: ${dietaryRestrictions} — respect this restriction in all food suggestions.`;
}

// Mifflin-St Jeor BMR → TDEE estimate
function estimateTDEE(params: { weightKg: number | null; heightCm: number | null; gender: string | null }): number | null {
  if (!params.weightKg) return null;
  const w = params.weightKg;
  const h = params.heightCm || 170; // default 170cm if unknown
  const age = 30; // default age if not collected
  const isMale = params.gender === 'male' || !params.gender || params.gender === 'prefer_not_to_say';
  // Mifflin-St Jeor
  const bmr = isMale
    ? 10 * w + 6.25 * h - 5 * age + 5
    : 10 * w + 6.25 * h - 5 * age - 161;
  // Activity multiplier: moderate (strength training 3-5x/week)
  return Math.round(bmr * 1.55);
}

export async function generateNutritionPlan(params: {
  goal: string;
  weightKg: number | null;
  heightCm?: number | null;
  trainingAge: string | null;
  primaryLimiter: string | null;
  selectedLift: string | null;
  budget?: string | null;
  gender?: string | null;
  dietaryRestrictions?: string | null;
  nutritionQuality?: string | null;
  currentProteinIntake?: string | null;
}): Promise<NutritionPlanResult> {
  const genderNote = params.gender && params.gender !== 'prefer_not_to_say'
    ? `- Biological sex: ${params.gender} — adjust caloric targets accordingly (females typically need 200–400 fewer kcal/day than males of similar weight; females may also benefit from higher iron, calcium, and folate; males may benefit from zinc and vitamin D for testosterone support)`
    : '';

  const tdee = estimateTDEE({ weightKg: params.weightKg, heightCm: params.heightCm || null, gender: params.gender || null });
  const tdeeNote = tdee
    ? `- Estimated TDEE (Mifflin-St Jeor × 1.55 activity): ${tdee} kcal/day — use this as your maintenance baseline when setting caloric targets`
    : '';

  // Build dietary restrictions note
  const dietaryNote = buildDietaryNote(params.dietaryRestrictions);

  const nutritionBaselineNote = [
    params.nutritionQuality ? `- Current nutrition quality self-assessment: ${params.nutritionQuality}` : '',
    params.currentProteinIntake ? `- Current estimated protein intake: ${params.currentProteinIntake}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `You are a certified sports nutritionist. Based on the athlete profile below, generate a macro plan and food recommendations using evidence-based formulas (Mifflin-St Jeor for TDEE, 0.7–1g/lb protein for strength athletes).

ATHLETE PROFILE:
- Goal: ${params.goal || 'general strength'}
- Body weight: ${params.weightKg ? params.weightKg + ' kg (' + Math.round(params.weightKg * 2.205) + ' lb)' : 'unknown'}
${params.heightCm ? `- Height: ${params.heightCm} cm` : ''}
- Training age: ${params.trainingAge || 'intermediate'}
- Primary lift: ${params.selectedLift || 'unknown'}
- Primary weakness identified: ${params.primaryLimiter || 'none identified'}
${tdeeNote}
${genderNote}
${nutritionBaselineNote}
${dietaryNote ? dietaryNote : ''}
${params.budget ? `- Weekly food budget: ${params.budget} — suggest affordable, practical foods within this budget` : ''}

INSTRUCTIONS:
- Calculate daily macros (protein, carbs, fat in grams) appropriate for the goal, anchored to the TDEE if provided
- For fat loss: 300–500 kcal deficit. For muscle gain: 200–350 kcal surplus. For recomp/maintenance: at TDEE.
- Suggest 5–7 specific whole foods that support the training goal and weakness${dietaryNote ? '\n- ALL food suggestions MUST comply with the dietary restrictions above — do not suggest any excluded foods' : ''}
- Provide a brief rationale (2–3 sentences) explaining the macro split
- Describe the expected impact across 4 dimensions (1 sentence each, specific and practical)
- Calculate expected outcomes: weekly weight change in lb (3500 kcal = 1 lb), monthly, and a strength note

OUTPUT FORMAT (JSON only):
{
  "macros": { "proteinG": 180, "carbsG": 250, "fatG": 70, "calories": 2350 },
  "foods": [
    { "name": "Chicken breast", "reason": "High protein for muscle repair" }
  ],
  "rationale": "...",
  "impact": {
    "bodyComposition": "Slight caloric surplus supports lean muscle gain at ~0.5 lb/week",
    "energy": "High — sufficient carbohydrates fuel 4× weekly training sessions",
    "mood": "Stable — adequate calorie intake prevents cortisol spikes and mood dips",
    "recovery": "Optimized — 1.8g/kg protein maximizes muscle protein synthesis between sessions"
  },
  "expectedOutcomes": {
    "tdee": 2600,
    "surplusOrDeficit": -250,
    "weeklyWeightChangeLb": -0.5,
    "monthlyWeightChangeLb": -2.2,
    "strengthGainNote": "At a 250 kcal deficit with adequate protein, expect strength maintenance or slight gain over 8 weeks"
  }
}`;

  const ragQuery = `nutrition plan macros protein carbs fat ${params.goal || 'strength'} strength training athlete`;
  const ragContext = await buildRAGContext(ragQuery, 3);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content || '{}';
  return JSON.parse(content) as NutritionPlanResult;
}

export async function generateMealSuggestions(params: {
  macros: { proteinG: number; carbsG: number; fatG: number; calories: number };
  budget?: string | null;
  goal?: string | null;
  numberOfMeals?: number;
  dietaryRestrictions?: string | null;
}): Promise<MealSuggestion[]> {
  const n = params.numberOfMeals || 5;
  const dailyCalories = params.macros.calories;
  const dietaryNote = buildDietaryNote(params.dietaryRestrictions);

  const prompt = `You are a sports nutritionist and meal planning expert. Suggest ${n} practical meals that fit the macro targets below.

DAILY TARGETS:
- Calories: ${dailyCalories} kcal
- Protein: ${params.macros.proteinG}g
- Carbs: ${params.macros.carbsG}g
- Fat: ${params.macros.fatG}g
- Training goal: ${params.goal || 'strength'}
${params.budget ? `- Weekly food budget: ${params.budget} — prioritize affordable, budget-friendly options` : ''}
${dietaryNote ? `\n${dietaryNote}` : ''}

REQUIREMENTS:
- Mix meal types: breakfast, lunch, dinner, snack
- Each meal should fit naturally within the daily macro budget (don't exceed totals)
- Use whole foods, minimal processing
- Keep ingredients simple and widely available
- Cost estimates in USD per serving
- Prep time under 35 minutes for most meals
${dietaryNote ? '- ALL meals MUST strictly comply with the dietary restriction above — no exceptions' : ''}
${params.budget ? '- Prioritize cheap proteins (eggs, canned fish, chicken thighs, legumes)' : ''}

OUTPUT FORMAT (JSON only — array, no wrapper):
[
  {
    "name": "Chicken Rice Bowl",
    "description": "Lean protein with complex carbs for sustained training energy",
    "mealType": "lunch",
    "macros": { "proteinG": 42, "carbsG": 55, "fatG": 8, "calories": 456 },
    "estimatedCostUSD": 4,
    "prepMinutes": 20,
    "keyIngredients": ["180g chicken breast", "1 cup jasmine rice", "broccoli", "soy sauce"]
  }
]`;

  const ragQuery = `meal planning sports nutrition practical recipes ${params.goal || 'strength'} athlete`;
  const ragContext = await buildRAGContext(ragQuery, 2);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content || '{}';
  // LLM may return { meals: [...] } or just the array wrapped in any key
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return parsed as MealSuggestion[];
  // Try common wrapper keys
  const arr = parsed.meals || parsed.suggestions || parsed.data || Object.values(parsed)[0];
  return Array.isArray(arr) ? arr as MealSuggestion[] : [];
}

// ─── Coach Extras: Training Program ───────────────────────────────────────────

export interface ProgramExercise {
  exercise: string;
  sets: number;
  reps: string;
  intensity: string;
  notes?: string;
}

export interface ProgramDay {
  day: string;
  focus: string;
  warmup: string[];       // e.g. ["3 min rowing", "Hip 90/90 x 5/side", "Band pull-aparts 2x15"]
  exercises: ProgramExercise[];
  cooldown: string[];     // e.g. ["Doorway pec stretch 2x30s", "T-spine rotation 2x10"]
}

export interface ProgramPhase {
  phaseNumber: number;
  phaseName: string;      // e.g. "Foundation", "Build", "Peak"
  rationale: string;      // Why this phase exists for this athlete
  durationWeeks: number;
  weeksLabel: string;     // e.g. "Weeks 1-4"
  trainingDays: ProgramDay[];  // Template week for this phase (repeated durationWeeks times)
  progressionNotes: string[]; // How to progress during this phase
  deloadProtocol: string;     // When/how to deload within this phase
}

export interface TrainingProgram {
  goal: string;
  daysPerWeek: number;
  durationWeeks: number;
  phases: ProgramPhase[];
  autoregulationRules: string[];  // RPE/RIR auto-regulation guidance
  trackingMetrics: string[];      // What to track each session
  // Legacy fields kept for backwards compatibility
  weeks?: Array<{
    weekNumber: number;
    days: Array<{
      day: string;
      focus: string;
      sessions: ProgramExercise[];
    }>;
  }>;
  progressionNotes?: string[];
}

export async function generateTrainingProgram(params: {
  goal: string;
  daysPerWeek: number;
  durationWeeks: number;
  trainingAge: string | null;
  equipment: string | null;
  primaryLimiter: string | null;
  selectedLift: string | null;
  accessories: string[];
  coachProfile?: string | null;   // Full JSON blob of onboarding interview answers
  diagnosticSignals?: {           // From latest analysis
    primaryPhase?: string;
    hypothesisScores?: Array<{ label: string; score: number; category: string }>;
    efficiencyScore?: number;
    indices?: Record<string, { value: number; confidence: number } | null>;
  } | null;
  gender?: string | null;
}): Promise<TrainingProgram> {
  // Parse coachProfile for richer context
  let profileContext = '';
  if (params.coachProfile) {
    try {
      const profile = JSON.parse(params.coachProfile);
      const lines: string[] = [];
      if (profile.primaryGoal) lines.push(`- Primary goal: ${profile.primaryGoal}`);
      if (profile.goalWhy) lines.push(`- Goal motivation: ${profile.goalWhy}`);
      if (profile.medicalConditions) lines.push(`- Medical conditions: ${profile.medicalConditions}`);
      if (profile.medications) lines.push(`- Medications: ${profile.medications}`);
      if (profile.injuries) lines.push(`- Injuries/constraints: ${profile.injuries}`);
      if (profile.hormonal) lines.push(`- Hormonal notes: ${profile.hormonal}`);
      if (profile.currentRoutine) lines.push(`- Current routine: ${profile.currentRoutine}`);
      if (profile.strengthLevel) lines.push(`- Strength level self-assessment: ${profile.strengthLevel}`);
      if (profile.trainingPreference) lines.push(`- Training style preference: ${profile.trainingPreference}`);
      if (profile.sleep) lines.push(`- Sleep quality: ${profile.sleep}`);
      if (profile.stressEnergy) lines.push(`- Stress/energy levels: ${profile.stressEnergy}`);
      if (profile.lifestyle) lines.push(`- Lifestyle: ${profile.lifestyle}`);
      if (profile.recoveryPractices) lines.push(`- Recovery practices: ${profile.recoveryPractices}`);
      if (profile.daysPerWeek) lines.push(`- Preferred days/week: ${profile.daysPerWeek}`);
      if (profile.accountability) lines.push(`- Accountability style: ${profile.accountability}`);
      if (profile.bodyStats) lines.push(`- Body stats: ${profile.bodyStats}`);
      if (profile.aestheticGoals) lines.push(`- Aesthetic goals: ${profile.aestheticGoals}`);
      if (profile.pastAttempts) lines.push(`- Past attempts/struggles: ${profile.pastAttempts}`);
      if (profile.commitment) lines.push(`- Commitment level: ${profile.commitment}`);
      // Gender from profile or explicit param
      const genderVal = params.gender || profile.gender;
      if (genderVal && genderVal !== 'prefer_not_to_say') lines.push(`- Biological sex: ${genderVal} — factor into volume tolerance, hormonal recovery, and caloric needs`);
      profileContext = lines.length > 0 ? `\nFULL CONSULTATION PROFILE:\n${lines.join('\n')}` : '';
    } catch { /* ignore parse errors */ }
  }

  // Summarize diagnostic signals
  let signalsContext = '';
  if (params.diagnosticSignals) {
    const ds = params.diagnosticSignals;
    const lines: string[] = [];
    if (ds.primaryPhase) lines.push(`- Identified weak phase: ${ds.primaryPhase}`);
    if (ds.hypothesisScores && ds.hypothesisScores.length > 0) {
      const top3 = ds.hypothesisScores.slice(0, 3);
      lines.push(`- Top weakness hypotheses: ${top3.map(h => `${h.label} (${h.score}/100)`).join(', ')}`);
    }
    if (ds.efficiencyScore !== undefined) lines.push(`- Muscle balance score: ${ds.efficiencyScore}/100`);
    if (ds.indices) {
      const lowIndices = Object.entries(ds.indices)
        .filter(([, v]) => v && v.value < 60)
        .map(([k, v]) => `${k.replace('_index', '')} (${v!.value}/100)`);
      if (lowIndices.length > 0) lines.push(`- Low strength indices: ${lowIndices.join(', ')}`);
    }
    signalsContext = lines.length > 0 ? `\nBIOMECHANICS & DIAGNOSTIC DATA:\n${lines.join('\n')}` : '';
  }

  // Determine how many phases based on duration
  let phaseStructure: string;
  if (params.durationWeeks <= 4) {
    phaseStructure = '1 phase (Foundation only)';
  } else if (params.durationWeeks <= 8) {
    phaseStructure = '2 phases: Phase 1 Foundation (first half), Phase 2 Build (second half)';
  } else {
    phaseStructure = '3 phases: Phase 1 Foundation (~1/3), Phase 2 Build (~1/3), Phase 3 Peak (~1/3)';
  }

  const prompt = `You are an elite strength & conditioning coach (NSCA-CSCS, with 15+ years experience designing individualized programs for elite athletes and serious recreational lifters). Generate a comprehensive, phased training program.

ATHLETE PROFILE:
- Training goal: ${params.goal}
- Days per week: ${params.daysPerWeek}
- Total duration: ${params.durationWeeks} weeks
- Training age: ${params.trainingAge || 'intermediate'}
- Equipment available: ${params.equipment || 'commercial gym'}
- Primary lift focus: ${params.selectedLift || 'general strength'}
- Primary mechanical weakness identified: ${params.primaryLimiter || 'none identified'}
- Prescribed accessories from diagnostic analysis: ${params.accessories.length > 0 ? params.accessories.join(', ') : 'none'}${profileContext}${signalsContext}

PROGRAM ARCHITECTURE:
Use ${phaseStructure}.

REQUIREMENTS (be concise — brevity is critical for all text fields):
1. Phase names: Foundation/Correction, Build/Hypertrophy, or Peak/Strength.
2. rationale: 2 sentences max, specific to this athlete's profile/diagnostic data.
3. Exercise selection must address the identified weak phase/limiter. notes: ≤8 words.
4. warmup: exactly 3 items (short phrases). cooldown: exactly 2 items (short phrases).
5. deloadProtocol: 1 sentence. progressionNotes: 2 items max, concise.
6. All intensity uses RPE. autoregulationRules: 2 items. trackingMetrics: 2 items.

OUTPUT FORMAT — Return valid JSON only:
{
  "goal": "...",
  "daysPerWeek": ${params.daysPerWeek},
  "durationWeeks": ${params.durationWeeks},
  "phases": [
    {
      "phaseNumber": 1,
      "phaseName": "Foundation",
      "rationale": "2 sentences why this phase suits this specific athlete.",
      "durationWeeks": 4,
      "weeksLabel": "Weeks 1–4",
      "trainingDays": [
        {
          "day": "Upper — Horizontal Push/Pull",
          "focus": "Corrective strength",
          "warmup": ["Band pull-aparts 2x20", "Wall slides 2x10", "Shoulder CARs 1x5/side"],
          "exercises": [
            {"exercise": "Bench Press", "sets": 4, "reps": "6", "intensity": "RPE 7", "notes": "Scapular retraction throughout"}
          ],
          "cooldown": ["Doorway pec stretch 2x30s", "Child's pose 60s"]
        }
      ],
      "progressionNotes": ["Add 2.5 lbs when RPE ≤7", "Move to Phase 2 after 2 clean sessions"],
      "deloadProtocol": "After week 4: cut volume 40%, keep intensity 1 week."
    }
  ],
  "autoregulationRules": ["Energy <5/10: drop 1 set per exercise", "Unexpected RPE 9+: reduce load 5%"],
  "trackingMetrics": ["Log weight, sets, reps, RPE per set", "Note sticking point on primary lift"]
}`;

  const ragQuery = `periodization training program ${params.goal || 'strength'} phases ${params.primaryLimiter || ''} ${params.selectedLift || ''} RPE progression`;
  const ragContext = await buildRAGContext(ragQuery, 4);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 8000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content || '{}';
  const parsed = JSON.parse(content) as TrainingProgram;

  // Backwards-compatibility: if old UI still reads .weeks, synthesize it
  if (!parsed.weeks && parsed.phases && parsed.phases.length > 0) {
    let weekNum = 0;
    parsed.weeks = [];
    for (const phase of parsed.phases) {
      for (let w = 0; w < phase.durationWeeks; w++) {
        weekNum++;
        parsed.weeks.push({
          weekNumber: weekNum,
          days: phase.trainingDays.map(d => ({
            day: d.day,
            focus: d.focus,
            sessions: d.exercises,
          })),
        });
      }
    }
    parsed.progressionNotes = parsed.phases.flatMap(p => p.progressionNotes);
  }

  return parsed;
}

// ─── Coach Insights ────────────────────────────────────────────────────────────

export async function generateCoachInsight(params: {
  primaryLimiter: string | null;
  archetype: string | null;
  efficiencyScore: number | null;
  selectedLift: string | null;
}): Promise<string> {
  const prompt = `You are an elite AI strength coach. Generate ONE concise, specific coaching insight (1–2 sentences max) for this athlete.

ATHLETE DATA:
- Primary lift: ${params.selectedLift || 'unknown'}
- Primary weakness: ${params.primaryLimiter || 'none identified'}
- Strength archetype: ${params.archetype || 'unknown'}
- Muscle balance score: ${params.efficiencyScore !== null ? params.efficiencyScore + '/100' : 'unknown'}

Be specific and actionable. Reference their data. Do not use generic phrases like "keep up the good work."
Output only the insight text, no JSON, no labels.`;

  const ragQuery = `${params.selectedLift || 'strength training'} ${params.primaryLimiter || ''} coaching insight weakness correction`;
  const ragContext = await buildRAGContext(ragQuery, 3);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 700,
  });

  return response.choices[0].message.content?.trim() || 'Keep training consistently and track your progress.';
}

// ─── Wellness Insight ──────────────────────────────────────────────────────────

export async function generateWellnessInsight(params: {
  recentCheckins: Array<{ mood: number; energy: number; sleepHours: number; stress: number; date: string }>;
}): Promise<string> {
  const summary = params.recentCheckins.slice(0, 7).map(c =>
    `${c.date}: mood=${c.mood}/5, energy=${c.energy}/5, sleep=${c.sleepHours}h, stress=${c.stress}/5`
  ).join('\n');

  const prompt = `You are a sports recovery specialist. Analyze this athlete's recent wellness check-ins and provide ONE specific recovery recommendation (2–3 sentences).

RECENT CHECKINS (last 7 days):
${summary}

Be specific. If energy is low, say why and what to do. If stress is high, recommend a concrete intervention.
Output only the recommendation text, no JSON, no labels.`;

  const ragContext = await buildRAGContext('athlete recovery sleep stress energy wellness fatigue management', 3);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 700,
  });

  return response.choices[0].message.content?.trim() || 'Prioritize 7-9 hours of sleep and manage stress to optimize recovery.';
}

// ─── Today's Coaching Tips ────────────────────────────────────────────────────

export interface TodayCoachingTipsParams {
  dayName: string;
  dayFocus: string;
  exercises: ProgramExercise[];
  phaseName: string;
  weekNumber: number;
  // Wellness signals from latest checkin
  sleepHours?: number | null;
  stressLevel?: number | null;  // 1–5
  energyLevel?: number | null;  // 1–5
  // Athlete profile
  trainingAge?: string | null;
  primaryLimiter?: string | null;
}

/**
 * Generates 2–3 specific coaching tips for today's session.
 * Lightweight GPT-4o call (max_completion_tokens: 300).
 */
export async function generateTodayCoachingTips(params: TodayCoachingTipsParams): Promise<string> {
  const exerciseList = params.exercises
    .map(e => `- ${e.exercise}: ${e.sets}×${e.reps} @ ${e.intensity}`)
    .join('\n');

  const wellnessContext = [
    params.sleepHours != null ? `Sleep last night: ${params.sleepHours}h` : null,
    params.energyLevel != null ? `Energy: ${params.energyLevel}/5` : null,
    params.stressLevel != null ? `Stress: ${params.stressLevel}/5` : null,
  ].filter(Boolean).join(', ') || 'No wellness data';

  const prompt = `You are an elite strength coach. Generate 2–3 specific, actionable coaching tips for today's training session. Be concise and direct.

TODAY'S SESSION:
- Day: ${params.dayName}
- Focus: ${params.dayFocus}
- Phase: ${params.phaseName} (Week ${params.weekNumber})
- Exercises:
${exerciseList}

ATHLETE STATUS TODAY:
- ${wellnessContext}
- Training age: ${params.trainingAge || 'intermediate'}
- Primary weakness: ${params.primaryLimiter || 'none identified'}

INSTRUCTIONS:
- Give 2–3 tips ONLY. Each tip must be specific to TODAY's session (not generic advice).
- If energy/sleep is low, address that directly (modify intensity guidance).
- Cover: nutrition timing, CNS load management, or recovery focus as relevant to the session.
- Format as plain text with bullet points (•). No headers, no JSON, just the tips.`;

  const ragQuery = `${params.exercises.slice(0, 3).map(e => e.exercise).join(' ')} ${params.primaryLimiter || ''} coaching cues technique`;
  const ragContext = await buildRAGContext(ragQuery, 3);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 1000,
  });

  return response.choices[0].message.content?.trim() || '• Focus on quality over quantity today.\n• Stay hydrated and maintain consistent rest periods.';
}

// ─── Life Happened — Program Adjustment ───────────────────────────────────────

export interface ProgramAdjustmentResult {
  disruptionType: 'social_event' | 'illness' | 'travel' | 'injury' | 'work_stress' | 'missed_session' | 'other';
  disruptionLabel: string;
  severity: 'mild' | 'moderate' | 'significant';
  physiologicalImpacts: string[];
  trainingImpact: {
    missedSessions: number;
    intensityNote: string;
    summary: string;
  };
  nutritionalAdvice: {
    immediate: string[];
    today: string[];
    supplements: string[];
  } | null;
  suggestedShiftDays: number;   // days to add to programStartDate (positive = delay program)
  adjustmentRationale: string;
  coachNote: string;
  recoveryTimeline: string;
}

export async function generateProgramAdjustment(params: {
  userInput: string;
  goal: string | null;
  trainingAge: string | null;
  primaryLimiter: string | null;
  phaseName: string | null;
  weekNumber: number | null;
  todaySession: { day: string; focus: string } | null;
  isRestDay: boolean;
  weekSchedule: Array<{ dayLabel: string; isTrainingDay: boolean; sessionName?: string }>;
}): Promise<ProgramAdjustmentResult> {
  const scheduleText = params.weekSchedule
    .map(d => `${d.dayLabel}: ${d.isTrainingDay ? `Lift — ${d.sessionName || 'Training'}` : 'Rest'}`)
    .join('\n');

  const todayContext = params.isRestDay
    ? 'Today is a scheduled rest day.'
    : params.todaySession
      ? `Today's scheduled session: ${params.todaySession.day} (${params.todaySession.focus})`
      : 'No session scheduled today.';

  const prompt = `You are an elite strength coach and sports physiologist. An athlete has reported a disruption to their training. Analyze the situation and provide a specific, science-based recovery plan.

ATHLETE CONTEXT:
- Training goal: ${params.goal || 'general strength'}
- Training age: ${params.trainingAge || 'intermediate'}
- Current program phase: ${params.phaseName || 'active'}, Week ${params.weekNumber || '?'}
- Primary weakness: ${params.primaryLimiter || 'none identified'}
- ${todayContext}

THIS WEEK'S SCHEDULE:
${scheduleText}

WHAT THE ATHLETE REPORTED:
"${params.userInput}"

YOUR TASK — provide a structured, specific analysis:

1. DISRUPTION CLASSIFICATION: Identify what happened (social_event, illness, travel, injury, work_stress, missed_session, other)
2. PHYSIOLOGICAL IMPACT: List the specific physiological effects (e.g. alcohol reduces MPS 37%, dehydration, cortisol spike from illness, sleep debt, etc.) — be precise with mechanisms, not generic
3. TRAINING IMPACT: How many sessions affected, what intensity adjustment is needed today/tomorrow, severity
4. NUTRITIONAL TRIAGE: Only if physiologically relevant (e.g. alcohol, illness, high stress) — give specific immediate actions, today's eating guidance, and any key supplements. If a simple schedule shift (travel, work meeting), set nutritionalAdvice to null.
5. SCHEDULE ADJUSTMENT: Recommend how many days to delay the program (suggestedShiftDays: 0 if no change needed, 1 if missed 1 training day, etc.). This shifts all future training days forward by that many days.
6. COACH NOTE: 2-3 sentences — acknowledge what happened, put it in context of their goal, and motivate them with a specific recovery action

PHYSIOLOGICAL KNOWLEDGE TO APPLY:
- Alcohol: reduces MPS ~37% for 24-48h, diuretic effect (1.5x fluid loss), disrupts REM sleep, depletes B vitamins and zinc, elevates cortisol
- Illness: inflammatory state, protein catabolism, reduced glycogen, immune system prioritization over muscle repair
- Poor sleep (<6h): ~20% reduction in strength, elevated cortisol, reduced GH release, increased RPE
- Travel: circadian disruption, dehydration from flying, altered eating schedule
- High stress: cortisol elevation impairs recovery, reduces testosterone:cortisol ratio
- Alcohol + training: if same day, reduce volume 30-40%, focus technique over load; if day after, reduce intensity 20%

OUTPUT — valid JSON only:
{
  "disruptionType": "social_event",
  "disruptionLabel": "Night Out / Alcohol",
  "severity": "moderate",
  "physiologicalImpacts": [
    "Alcohol reduces muscle protein synthesis by ~37% for 24-48 hours — limit of gains today",
    "Diuretic effect: likely 500ml-1L of fluid deficit from last night",
    "REM sleep disrupted: strength output today will be 15-20% below baseline"
  ],
  "trainingImpact": {
    "missedSessions": 0,
    "intensityNote": "Reduce working weight 15-20% today, keep RPE at 6-7 max — this is a technique day, not a PR day",
    "summary": "..."
  },
  "nutritionalAdvice": {
    "immediate": ["Drink 500ml water + electrolytes (sodium/potassium) right now", "Take 300mg magnesium glycinate"],
    "today": ["40g protein within 2 hours of waking", "200-250g carbs today — replenish liver glycogen", "Avoid heavy saturated fats until evening — they slow gastric emptying"],
    "supplements": ["Electrolytes", "B-complex vitamin (alcohol depletes B1, B6, B12)", "Zinc 25mg (zinc excreted in urine with alcohol metabolism)"]
  },
  "suggestedShiftDays": 0,
  "adjustmentRationale": "No need to shift the schedule — you can still train today at reduced intensity. The physiology will catch up in 24-36 hours.",
  "coachNote": "...",
  "recoveryTimeline": "Full training capacity returns in 36-48 hours with proper hydration and nutrition"
}`;

  const ragQuery = `training disruption recovery ${params.userInput.slice(0, 80)}`;
  const ragContext = await buildRAGContext(ragQuery, 3);
  const finalPrompt = ragContext ? `${prompt}\n\n${ragContext}` : prompt;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: finalPrompt }],
    max_completion_tokens: 2500,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content || '{}';
  const result = JSON.parse(content) as ProgramAdjustmentResult;

  // Normalize severity to accepted values so frontend SEVERITY_CONFIG never gets undefined
  const validSeverities = ['mild', 'moderate', 'significant'] as const;
  if (!validSeverities.includes(result.severity as typeof validSeverities[number])) {
    result.severity = 'moderate';
  }

  return result;
}

/**
 * Sends a user message to an existing thread and returns the assistant reply.
 */
export async function sendChatMessage(threadId: string, userMessage: string): Promise<string> {
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: userMessage,
  });

  const ragContext = await buildRAGContext(userMessage, 4);

  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    additional_instructions: ragContext || undefined,
  });

  if (run.status !== 'completed') {
    throw new Error(`Run failed with status: ${run.status}`);
  }

  const messages = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
  const latest = messages.data[0];
  if (!latest || latest.role !== 'assistant') throw new Error('No assistant reply found');

  const content = latest.content[0];
  if (content.type !== 'text') throw new Error('Unexpected content type');

  return content.text.value;
}
