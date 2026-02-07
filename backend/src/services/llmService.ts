import OpenAI from 'openai';
import { getLiftById } from '../data/lifts.js';
import { getBiomechanicsForLift } from '../data/biomechanics.js';
import { getApprovedAccessories, getStabilityExercises, generateIntensityRecommendation } from '../engine/rulesEngine.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface DiagnosticContext {
  selectedLift: string;
  trainingAge?: string;
  goal?: string;
  equipment?: string;
  constraints?: string;
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
}

/**
 * Analyzes user's snapshot data and generates 3 tailored diagnostic questions
 * This should be called BEFORE starting the regular diagnostic interview
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

  // Build comprehensive prompt for initial analysis
  const systemPrompt = `You are an expert strength coach analyzing a lifter's strength profile for ${lift.name}.

TARGET LIFT: ${lift.name}
USER'S GOAL: Increase strength in ${lift.name}

BIOMECHANICS KNOWLEDGE - ${lift.name}:
${biomechanics.movementPhases.map(phase => `
Phase: ${phase.phaseName} (${phase.rangeOfMotion})
- Mechanical Focus: ${phase.mechanicalFocus}
- Primary Muscles: ${phase.primaryMuscles.map(m => `${m.muscle} (${m.role})`).join(', ')}
- Common Failure: ${phase.commonFailurePoint}
`).join('\n')}

EXPECTED STRENGTH RATIOS:
${biomechanics.strengthRatios.map(ratio => `
- ${ratio.comparisonExercise}: ${ratio.expectedRatio}
  Interpretation: ${ratio.interpretation}
`).join('\n')}

COMMON WEAKNESSES FOR THIS LIFT:
${biomechanics.commonWeaknesses.map((w, i) => `${i + 1}. ${w}`).join('\n')}

USER'S CURRENT STRENGTH SNAPSHOT:
${context.snapshots.map(s => `- ${s.exerciseName}: ${s.weight} lbs × ${s.sets} sets × ${s.repsSchema} reps${s.rpeOrRir ? ` @ ${s.rpeOrRir}` : ''}`).join('\n')}

YOUR TASK:
1. Analyze the user's working weights and reps for exercises related to ${lift.name}
2. Calculate strength ratios between main lift and accessories (compare actual % to expected %)
3. Identify which muscles appear stronger/weaker based on these ratios
4. Determine which phase of ${lift.name} is likely their limiting factor
5. Consider body structure implications (e.g., high hip thrust vs squat suggests posterior-chain dominance)
6. Think like an experienced coach piecing together their profile from the numbers

Based on this analysis, generate EXACTLY 3 targeted diagnostic questions that will help identify:
- Which specific phase of the lift they fail at (bottom, mid-range, lockout)
- Whether the issue is muscular weakness, technical breakdown, or both
- What their subjective experience is (where they feel weak, where bar slows, etc.)

RULES FOR QUESTIONS:
- Make them specific to the user's strength profile you just analyzed
- Reference actual numbers and ratios (e.g., "Your close-grip bench at 140 lbs is 76% of your flat bench 185 lbs, which is below the typical 85-95%. Do you find...")
- Connect the dots between multiple lifts when possible (e.g., "Given your strong overhead press but weak close-grip bench...")
- Ask about their subjective experience to confirm what the numbers suggest
- Keep questions clear, concise, and easy to answer
- Each question should target a different aspect (phase of lift, muscle group, technique)
- Make it feel like a coach who's studied their numbers is asking intelligent follow-ups

OUTPUT FORMAT (JSON):
{
  "analysis": "2-3 paragraph analysis that: 1) States the key ratios with actual numbers, 2) Interprets what these ratios mean (which muscles, which phase), 3) May infer body structure/leverages if ratios are telling (e.g., strong hip thrust vs weak squat suggests posterior-chain dominance), 4) Connects multiple lifts into a coherent story",
  "tailoredQuestions": [
    "Question 1 that references specific numbers/ratios and asks about phase or sticking point",
    "Question 2 that connects dots between lifts and asks about muscle fatigue or weakness",
    "Question 3 that asks about subjective experience to confirm what the data suggests"
  ],
  "identifiedWeaknesses": [
    "Specific weakness 1 with ratio evidence (e.g., 'Triceps lockout - close-grip bench 76% of flat bench, below expected 85-95%')",
    "Specific weakness 2 with ratio evidence"
  ]
}

TONE: Be specific, reference actual numbers, calculate ratios, and make it feel like an experienced coach analyzing their profile. Connect the dots between multiple lifts. Think like the ChatGPT deadlift analysis example - use numbers to tell a story about their structure and limiters.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Analyze the snapshot data and generate 3 tailored diagnostic questions.' }
    ],
    temperature: 0.6,
    max_tokens: 800,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content || '{}';
  const result = JSON.parse(content);

  return {
    analysis: result.analysis || 'Analysis not available',
    tailoredQuestions: result.tailoredQuestions || [],
    identifiedWeaknesses: result.identifiedWeaknesses || []
  };
}

export async function generateDiagnosticQuestion(
  context: DiagnosticContext
): Promise<DiagnosticResponse> {
  const lift = getLiftById(context.selectedLift);
  if (!lift) {
    throw new Error('Invalid lift selected');
  }

  const questionCount = context.conversationHistory.filter(m => m.role === 'assistant').length;
  
  // Max 8 questions as per spec
  if (questionCount >= 8) {
    return {
      complete: true,
      needsMoreInfo: false
    };
  }

  // Build system prompt with lift knowledge
  const systemPrompt = `You are an expert strength coach conducting a diagnostic interview for ${lift.name}.

Your goal: Identify the PRIMARY limiting factor(s) preventing this lifter from progressing.

LIFT PHASES:
${lift.phases.map(p => `- ${p.name}: ${p.description}\n  Common issues: ${p.commonIssues.join(', ')}`).join('\n')}

POSSIBLE LIMITERS:
${lift.commonLimiters.map(l => `- ${l.name}: ${l.description}\n  Key questions: ${l.diagnosticQuestions.join('; ')}`).join('\n\n')}

CONTEXT:
- Training Age: ${context.trainingAge || 'unknown'}
- Goal: ${context.goal || 'general strength'}
- Equipment: ${context.equipment || 'commercial gym'}
${context.constraints ? `- Constraints: ${context.constraints}` : ''}

${context.snapshots && context.snapshots.length > 0 ? `
STRENGTH SNAPSHOT:
${context.snapshots.map(s => `- ${s.exerciseName}: ${s.weight}kg × ${s.sets}×${s.repsSchema}${s.rpeOrRir ? ` @ ${s.rpeOrRir}` : ''}`).join('\n')}
` : ''}

RULES:
1. Ask ONE specific, clear question per turn
2. Focus on subjective experience: sticking points, fatigue patterns, bar path, form breakdown
3. Build on previous answers to narrow down the diagnosis
4. Keep questions concise and easy to answer
5. After 4-6 questions, you should have enough info to diagnose
6. If the user provides detailed information, you may conclude sooner

Current question count: ${questionCount}/8

Based on the conversation so far, determine:
- If you have enough information to make a diagnosis (respond with "DIAGNOSIS_READY")
- OR ask the next most valuable diagnostic question

Be direct and natural in your questioning style.`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt }
  ];

  // Add conversation history
  context.conversationHistory.forEach(msg => {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.message
    });
  });

  // Add instruction for next question
  messages.push({
    role: 'user',
    content: questionCount === 0 
      ? 'Begin the diagnostic interview with the most important question to identify the limiting factor.'
      : 'Based on the user\'s response, ask your next diagnostic question or indicate DIAGNOSIS_READY if you have sufficient information.'
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.7,
    max_tokens: 200
  });

  const assistantMessage = response.choices[0].message.content || '';

  if (assistantMessage.includes('DIAGNOSIS_READY') || questionCount >= 6) {
    return {
      complete: true,
      needsMoreInfo: false
    };
  }

  return {
    question: assistantMessage,
    complete: false,
    needsMoreInfo: true
  };
}

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
}

export async function generateWorkoutPlan(
  context: DiagnosticContext
): Promise<WorkoutPlan> {
  const lift = getLiftById(context.selectedLift);
  const biomechanics = getBiomechanicsForLift(context.selectedLift);
  
  if (!lift || !biomechanics) {
    throw new Error('Invalid lift selected or biomechanics data not found');
  }

  // Build comprehensive snapshot summary with ratios
  const snapshotSummary = context.snapshots && context.snapshots.length > 0
    ? context.snapshots.map(s => {
        const lbs = s.weight;
        const kg = s.weight * 0.453592; // Convert to kg for consistency
        return `- ${s.exerciseName}: ${lbs} lbs (${kg.toFixed(1)} kg) × ${s.sets} sets × ${s.repsSchema} reps${s.rpeOrRir ? ` @ ${s.rpeOrRir}` : ''}`;
      }).join('\n')
    : 'No snapshot data available';

  const systemPrompt = `You are an expert strength coach creating a personalized training plan.

You must analyze the diagnostic conversation AND the user's strength snapshot to generate a structured workout plan in JSON format.

LIFT: ${lift.name}
TRAINING AGE: ${context.trainingAge || 'intermediate'}
GOAL: ${context.goal || 'strength_peak'}
EQUIPMENT: ${context.equipment || 'commercial'}
${context.constraints ? `CONSTRAINTS: ${context.constraints}` : ''}

BIOMECHANICS KNOWLEDGE - ${lift.name}:
${biomechanics.movementPhases.map(phase => `
Phase: ${phase.phaseName}
- Primary Muscles: ${phase.primaryMuscles.map(m => m.muscle).join(', ')}
- Mechanical Focus: ${phase.mechanicalFocus}
- Common Failure: ${phase.commonFailurePoint}
`).join('\n')}

EXPECTED STRENGTH RATIOS:
${biomechanics.strengthRatios.map(ratio => `
- ${ratio.comparisonExercise}: ${ratio.expectedRatio}
  ${ratio.interpretation}
`).join('\n')}

USER'S STRENGTH SNAPSHOT:
${snapshotSummary}

POSSIBLE LIMITERS FOR THIS LIFT:
${lift.commonLimiters.map(l => `
- ID: ${l.id}
  Name: ${l.name}
  Description: ${l.description}
  Target Muscles: ${l.targetMuscles.join(', ')}
  Indicator Exercises: ${l.indicatorExercises?.join(', ') || 'N/A'}
`).join('\n')}

DIAGNOSTIC CONVERSATION:
${context.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.message}`).join('\n\n')}

Your task:
1. FIRST: Look at the user's SNAPSHOT DATA above and calculate actual strength ratios between their exercises
2. Identify 1-2 PRIMARY limiters based on BOTH snapshot ratios AND conversation answers
3. Assign confidence scores (0.0-1.0) based on evidence strength
4. For EVIDENCE, YOU MUST provide 3-5 DETAILED, SPECIFIC points. EACH evidence point MUST include:
   a) Actual weights from their snapshot (e.g., "Front squat at 185 lbs vs back squat at 255 lbs")
   b) Calculated ratio as a percentage (e.g., "which is only 72% of back squat")
   c) Expected ratio for comparison (e.g., "expected 80-90%")
   d) What this ratio indicates biomechanically
   e) User quotes when available to confirm
   
   DO NOT write generic evidence like "User struggles in bottom third"
   ALWAYS anchor evidence to specific weights and ratios from their snapshot
5. Select the primary lift programming (sets/reps/intensity)
6. Choose 2-4 targeted accessories that SPECIFICALLY address the identified limiters
7. For each accessory, explain HOW it improves the compound lift (be specific about phase/muscle/mechanics)
8. Provide clear progression rules
9. List specific tracking metrics for next session

CRITICAL: Evidence must be THOROUGH and include:
- Actual weights from snapshot with ratio calculations (e.g., "Close-grip bench at 140 lbs is only 76% of flat bench 185 lbs, below expected 85-95%")
- Biomechanics explanations (which muscle, which phase of lift, why it matters)
- Direct user quotes from diagnostic conversation
- Technical reasoning that connects the dots
- Body structure inferences when relevant (e.g., "This ratio pattern suggests longer limbs/posterior chain dominance")

STYLE GUIDE FOR EVIDENCE:
- Be specific and data-driven like an experienced coach analyzing numbers
- Calculate and cite exact ratios (e.g., "Your X is Y% of your Z, which indicates...")
- Connect multiple lifts to tell a coherent story (e.g., "Strong hip thrust but weak squat suggests...")
- Explain what ratios reveal about structure/leverages when applicable
- Make it feel like a conversation with an expert who's piecing together your profile

EXAMPLES OF GREAT EVIDENCE (like an expert coach):

Example 1 (Bench Press):
"Close-grip bench at 140 lbs is only 76% of flat bench 185 lbs (expected 85-95%). This ratio indicates your triceps are limiting the lockout phase (final 20% of ROM where triceps dominate elbow extension). Combined with your report that 'the bar slows down in the final 2 inches', this confirms triceps strength is your primary limiter, not chest or shoulder strength."

Example 2 (Deadlift):
"Hip thrust at 545 lbs × 7 (~670 lb 1RM) is massively ahead of your deadlift at 365 × 3 (~405 lb 1RM). This means your glutes are overqualified for your current deadlift - they're not the limiter. The issue is likely earlier in the pull: spinal erectors, lats keeping bar close, or initial leg drive. User reported: 'lockout feels easy but getting it off the floor is hard.'"

Example 3 (Squat):
"Front squat at 185 lbs is only 72% of back squat at 255 lbs (expected 80-90%). This lower-than-expected ratio suggests either quad strength is limiting or upper back can't maintain upright position. User mentioned: 'torso collapses forward on heavier sets.'"

MANDATORY REQUIREMENTS FOR EVIDENCE:
- AT LEAST 2 evidence points MUST include specific weights from the user's snapshot with calculated ratios
- AT LEAST 1 evidence point MUST reference OTHER exercises from their snapshot to rule in/out other limiters
- AT LEAST 1 evidence point MUST include direct user quotes from the diagnostic conversation
- Each evidence point should be 2-3 sentences, not just one generic statement
- DO NOT write generic statements like "User struggles in bottom third" - instead use actual snapshot data

BAD Evidence Example (too generic):
"User struggles most in the bottom third of the squat, indicating potential quad weakness."

GOOD Evidence Example (uses actual data):
"Front squat at 185 lbs is only 72% of back squat 255 lbs (expected 80-90%). This below-expected ratio specifically indicates quad weakness, as front squats are more quad-dominant. User reported: 'I collapse in the hole on heavy sets.'"

OUTPUT ONLY VALID JSON in this exact structure:
{
  "diagnosis": [
    {
      "limiter": "limiter_id_from_above",
      "limiterName": "Human readable name",
      "confidence": 0.75,
      "evidence": [
        "Front squat at 185 lbs is only 72% of back squat 255 lbs (expected 80-90%), indicating quad weakness as front squats are quad-dominant",
        "Leg press at XXX lbs shows... [use actual snapshot data]",
        "Hip thrust at XXX lbs is strong (YY% of squat), ruling out posterior chain as the limiter",
        "User reported: 'I collapse in the hole on heavy sets' - confirming quad weakness in bottom position",
        "Biomechanics: Quads are primary movers in bottom third of squat where user fails"
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
      "why": "Brief explanation of why this helps the limiter",
      "category": "targeted|stability|hypertrophy"
    }
  ],
  "progression_rules": [
    "When to add weight",
    "How to progress"
  ],
  "track_next_time": [
    "What to observe",
    "What to measure"
  ]
}

Be specific, evidence-based, and conservative with volume. Respond ONLY with the JSON.`;

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

  // Construct the full plan with lift info
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
    track_next_time: planData.track_next_time || ['Sticking point location', 'RPE at same load']
  };

  return plan;
}
