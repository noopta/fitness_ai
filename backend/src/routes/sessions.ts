import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import twilio from 'twilio';
import { generateDiagnosticQuestion, generateWorkoutPlan, generateInitialAnalysis, createChatThread, sendChatMessage } from '../services/llmService.js';
import { getExerciseById } from '../data/exercises.js';

const router = Router();
const prisma = new PrismaClient();

// Initialize Twilio client if credentials are provided
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && 
    process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (error) {
    console.warn('⚠ Twilio initialization failed in sessions route');
  }
}

// Validation schemas
const createSessionSchema = z.object({
  selectedLift: z.string(),
  goal: z.string().optional(),
  userId: z.string().optional(),
  profile: z.object({
    heightCm: z.number().optional(),
    weightKg: z.number().optional(),
    bodyCompTag: z.string().optional(),
    trainingAge: z.string().optional(),
    equipment: z.string().optional(),
    constraintsText: z.string().optional()
  }).optional()
});

const addSnapshotSchema = z.object({
  exerciseId: z.string(),
  weight: z.number(),
  weightUnit: z.string().optional(),
  reps: z.number(),
  sets: z.number().optional().default(1),
  rpe: z.number().nullish().transform(v => v ?? undefined),
  date: z.string().optional()
});

const addSnapshotsSchema = z.object({
  snapshots: z.array(addSnapshotSchema)
});

const addMessageSchema = z.object({
  message: z.string()
});

// POST /api/sessions - Create new session
router.post('/sessions', async (req, res) => {
  try {
    const data = createSessionSchema.parse(req.body);
    
    let userId = data.userId;
    
    // Create or update user if profile provided
    if (data.profile) {
      const user = await prisma.user.create({
        data: {
          heightCm: data.profile.heightCm,
          weightKg: data.profile.weightKg,
          bodyCompTag: data.profile.bodyCompTag,
          trainingAge: data.profile.trainingAge,
          equipment: data.profile.equipment,
          constraintsText: data.profile.constraintsText
        }
      });
      userId = user.id;
    }
    
    const session = await prisma.session.create({
      data: {
        selectedLift: data.selectedLift,
        goal: data.goal,
        userId
      }
    });
    
    res.json({ session });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(400).json({ error: 'Invalid request data' });
  }
});

// POST /api/sessions/:id/snapshots - Add exercise snapshots
router.post('/sessions/:id/snapshots', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if session exists
    const sessionExists = await prisma.session.findUnique({
      where: { id }
    });

    if (!sessionExists) {
      console.error(`Session not found: ${id}`);
      return res.status(404).json({
        error: 'Session not found',
        sessionId: id,
        message: 'Please create a session first using POST /api/sessions'
      });
    }

    // Check if request has snapshots array or single snapshot
    let snapshotsData;
    if (req.body.snapshots && Array.isArray(req.body.snapshots)) {
      // Array of snapshots
      const validated = addSnapshotsSchema.parse(req.body);
      snapshotsData = validated.snapshots;
    } else {
      // Single snapshot (legacy support)
      const validated = addSnapshotSchema.parse(req.body);
      snapshotsData = [validated];
    }

    console.log(`Adding ${snapshotsData.length} snapshots to session ${id}`);

    // Create all snapshots
    const createdSnapshots = await Promise.all(
      snapshotsData.map(data =>
        prisma.exerciseSnapshot.create({
          data: {
            sessionId: id,
            exerciseId: data.exerciseId,
            weight: data.weight,
            sets: data.sets,
            repsSchema: data.reps.toString(), // Convert reps to string for compatibility
            rpeOrRir: data.rpe ? `RPE ${data.rpe}` : undefined
          }
        })
      )
    );

    console.log(`✓ Successfully added ${createdSnapshots.length} snapshots`);

    res.json({
      snapshots: createdSnapshots,
      count: createdSnapshots.length
    });
  } catch (error) {
    console.error('Error adding snapshots:', error);
    if (error instanceof z.ZodError) {
      console.error('Validation errors:', error.errors);
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      });
    }
    res.status(400).json({ error: 'Invalid request data' });
  }
});

// POST /api/sessions/:id/messages - Add message and get AI response
router.post('/sessions/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const data = addMessageSchema.parse(req.body);
    
    // Save user message
    await prisma.diagnosticMessage.create({
      data: {
        sessionId: id,
        role: 'user',
        message: data.message
      }
    });
    
    // Get session context
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        user: true,
        snapshots: true,
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Build context for LLM
    const snapshots = session.snapshots.map(s => {
      const exercise = getExerciseById(s.exerciseId);
      return {
        exerciseId: s.exerciseId,
        exerciseName: exercise?.name || s.exerciseId,
        weight: s.weight,
        sets: s.sets,
        repsSchema: s.repsSchema,
        rpeOrRir: s.rpeOrRir || undefined
      };
    });

    const conversationHistory = session.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      message: m.message
    }));

    const bodyweightLbs = session.user?.weightKg
      ? session.user.weightKg * 2.20462
      : undefined;

    const sessionFlags = parseSessionFlags(conversationHistory.map(m => m.message).join(' '));

    // Check if this is the very first interaction (no previous assistant messages)
    const assistantMessageCount = conversationHistory.filter(m => m.role === 'assistant').length;

    if (assistantMessageCount === 0 && snapshots.length > 0) {
      // First interaction - generate initial analysis and tailored questions
      try {
        const analysis = await generateInitialAnalysis({
          selectedLift: session.selectedLift,
          trainingAge: session.user?.trainingAge || undefined,
          goal: session.goal || undefined,
          equipment: session.user?.equipment || undefined,
          constraints: session.user?.constraintsText || undefined,
          bodyweightLbs,
          sessionFlags,
          snapshots,
          conversationHistory
        });
        
        // Format all 3 tailored questions as a single message
        const questionsMessage = `Based on your strength profile, I have a few specific questions to help diagnose your limiting factors:\n\n` +
          `**1.** ${analysis.tailoredQuestions[0] || 'Where do you feel the lift is hardest?'}\n\n` +
          `**2.** ${analysis.tailoredQuestions[1] || 'Which muscle group fatigues first?'}\n\n` +
          `**3.** ${analysis.tailoredQuestions[2] || 'Describe any form breakdown under heavy loads.'}\n\n` +
          `Please answer these questions - they'll help me identify exactly what's holding back your progress.`;
        
        const assistantMessage = await prisma.diagnosticMessage.create({
          data: {
            sessionId: id,
            role: 'assistant',
            message: questionsMessage
          }
        });
        
        return res.json({ 
          complete: false,
          message: assistantMessage.message,
          analysis: analysis.analysis
        });
      } catch (error) {
        console.error('Error generating initial analysis:', error);
        // Fall back to regular diagnostic flow if analysis fails
      }
    }
    
    // Regular diagnostic question generation
    const response = await generateDiagnosticQuestion({
      selectedLift: session.selectedLift,
      trainingAge: session.user?.trainingAge || undefined,
      goal: session.goal || undefined,
      equipment: session.user?.equipment || undefined,
      constraints: session.user?.constraintsText || undefined,
      bodyweightLbs,
      sessionFlags,
      snapshots,
      conversationHistory
    });
    
    if (response.complete) {
      // Diagnostic complete, ready to generate plan
      return res.json({ 
        complete: true,
        message: 'Diagnostic complete. Ready to generate your plan.'
      });
    }
    
    // Save assistant message
    const assistantMessage = await prisma.diagnosticMessage.create({
      data: {
        sessionId: id,
        role: 'assistant',
        message: response.question || ''
      }
    });
    
    res.json({ 
      complete: false,
      message: assistantMessage.message
    });
    
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// POST /api/sessions/:id/generate - Generate workout plan
router.post('/sessions/:id/generate', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get session with full context
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        user: true,
        snapshots: true,
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Build context
    const snapshots = session.snapshots.map(s => {
      const exercise = getExerciseById(s.exerciseId);
      return {
        exerciseId: s.exerciseId,
        exerciseName: exercise?.name || s.exerciseId,
        weight: s.weight,
        sets: s.sets,
        repsSchema: s.repsSchema,
        rpeOrRir: s.rpeOrRir || undefined
      };
    });

    const conversationHistory = session.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      message: m.message
    }));

    const bodyweightLbs = session.user?.weightKg
      ? session.user.weightKg * 2.20462
      : undefined;

    const sessionFlags = parseSessionFlags(conversationHistory.map(m => m.message).join(' '));

    // Generate plan
    const plan = await generateWorkoutPlan({
      selectedLift: session.selectedLift,
      trainingAge: session.user?.trainingAge || undefined,
      goal: session.goal || undefined,
      equipment: session.user?.equipment || undefined,
      constraints: session.user?.constraintsText || undefined,
      bodyweightLbs,
      sessionFlags,
      snapshots,
      conversationHistory
    });
    
    // Save plan
    const savedPlan = await prisma.generatedPlan.create({
      data: {
        sessionId: id,
        planJson: JSON.stringify(plan),
        planText: formatPlanAsText(plan)
      }
    });
    
    // Send SMS notification that a user has generated a plan
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER && process.env.NOTIFICATION_PHONE) {
      try {
        await twilioClient.messages.create({
          body: `A user has analyzed their workout plan for ${session.selectedLift.replace(/_/g, ' ')}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: process.env.NOTIFICATION_PHONE,
        });
        console.log('✓ Plan generation SMS sent');
      } catch (error) {
        console.error('✗ Failed to send plan generation SMS:', error);
      }
    }
    
    res.json({ plan });
    
  } catch (error) {
    console.error('Error generating plan:', error);
    res.status(500).json({ error: 'Failed to generate plan' });
  }
});

// GET /api/sessions/:id - Get session details
router.get('/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        user: true,
        snapshots: true,
        messages: {
          orderBy: { createdAt: 'asc' }
        },
        plans: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({ session });
    
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Parse conversational text into structured SessionFlags for the diagnostic engine.
// Patterns are order-independent — keyword proximity matters, not word order.
function parseSessionFlags(text: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  const t = text.toLowerCase();

  // ── hard_off_floor ─────────────────────────────────────────────────────────
  // Catches: "hard off the floor", "off the floor is hard", "struggle off the floor",
  //          "hardest off the floor", "hard to get off the floor", "hard from the floor",
  //          "hard at the start", "hardest at the start", "hard leaving the ground"
  if (
    /hard.{0,25}(off|from|at|on).{0,15}(floor|ground|start|bottom)/i.test(t) ||
    /(off|from).{0,15}(floor|ground).{0,25}(hard|difficult|struggle|tough)/i.test(t) ||
    /(floor|ground|start|initial).{0,25}(hard|difficult|struggle|tough|worst|hardest)/i.test(t) ||
    /(struggle|difficult|tough|hardest|worst).{0,30}(floor|ground|off|start|initial.pull)/i.test(t) ||
    /\b(off the floor|off the ground|from the floor|from the ground)\b.{0,30}(hard|difficult|struggle|issue|problem)/i.test(t) ||
    /(hard|difficult|struggle|issue|problem).{0,30}\b(off the floor|off the ground|from the floor)\b/i.test(t)
  ) flags.hard_off_floor = true;

  // ── hard_off_chest (bench/press specific) ──────────────────────────────────
  if (
    /hard.{0,20}(off|from|at|on).{0,10}(chest|bottom|start)/i.test(t) ||
    /(chest|bottom).{0,20}(hard|difficult|struggle|tough|worst)/i.test(t) ||
    /(struggle|difficult|tough).{0,20}(chest|bottom|off chest)/i.test(t)
  ) flags.hard_off_chest = true;

  // ── hard_mid_range ─────────────────────────────────────────────────────────
  if (
    /hard.{0,20}(mid|middle|halfway|half.?way)/i.test(t) ||
    /(mid|middle|halfway).{0,20}(hard|difficult|struggle|sticking|stall)/i.test(t) ||
    /sticking.{0,15}point.{0,20}(mid|middle|halfway)/i.test(t)
  ) flags.hard_mid_range = true;

  // ── hard_at_lockout ────────────────────────────────────────────────────────
  if (
    /(hard|fail|struggle|difficult).{0,20}lock(out|ing)/i.test(t) ||
    /lock(out|ing).{0,20}(hard|fail|struggle|difficult|weak)/i.test(t) ||
    /can.t.{0,10}lock(out| it| them)/i.test(t)
  ) flags.hard_at_lockout = true;

  // ── hips_shoot_up ──────────────────────────────────────────────────────────
  if (
    /hip.{0,15}shoot/i.test(t) ||
    /hips.{0,10}(rise|come up|go up|shoot|high|pop)/i.test(t) ||
    /(hips|butt|posterior).{0,20}(rise|shoot|come up|go up|first|before)/i.test(t)
  ) flags.hips_shoot_up = true;

  // ── back_rounds ────────────────────────────────────────────────────────────
  if (
    /back.{0,15}round/i.test(t) ||
    /round.{0,15}back/i.test(t) ||
    /spine.{0,15}(round|flex|bend|lose)/i.test(t) ||
    /(lose|losing|lost).{0,15}(back|spinal).{0,10}(position|neutral|flat)/i.test(t)
  ) flags.back_rounds = true;

  // ── bar_drifts / bar_drifts_forward ────────────────────────────────────────
  if (/bar.{0,15}drift/i.test(t)) flags.bar_drifts = true;
  if (/bar.{0,15}(drift|move|shift|swing).{0,15}forward/i.test(t) ||
      /bar.{0,15}(away|out|forward).{0,15}(body|legs|me)/i.test(t)) flags.bar_drifts_forward = true;

  // ── tension loss (new) — maps to hard_off_floor for deadlift / setup issues
  // "hard to maintain tension", "lose tension", "can't keep tension", "tension breaks"
  if (
    /(maintain|keep|hold|create).{0,20}tension/i.test(t) ||
    /tension.{0,20}(hard|difficult|issue|problem|lose|lost|breaks|gone)/i.test(t) ||
    /(lose|losing|lost|break|breaking).{0,20}tension/i.test(t) ||
    /can.t.{0,20}(maintain|keep|hold|create|get).{0,20}tension/i.test(t)
  ) {
    // Tension issues on deadlift → setup/initial pull problem
    flags.hard_off_floor = true;
  }

  // ── feel_lower_back ────────────────────────────────────────────────────────
  if (
    /lower back.{0,20}(pain|sore|tight|feel|strain|stress|work|pump)/i.test(t) ||
    /(feel|feeling|feel it).{0,20}lower back/i.test(t)
  ) flags.feel_lower_back = true;

  // ── elbows_flare_early ─────────────────────────────────────────────────────
  if (
    /chest.{0,15}drop/i.test(t) ||
    /elbows.{0,15}(flare|out|wide|up)/i.test(t) ||
    /(flare|flaring).{0,15}elbow/i.test(t)
  ) flags.elbows_flare_early = true;

  // ── shoulder_discomfort ────────────────────────────────────────────────────
  if (/shoulder.{0,15}(pain|discomfort|hurt|ache|issue)/i.test(t)) flags.shoulder_discomfort = true;

  // ── mobility_restriction ───────────────────────────────────────────────────
  if (/mobility.{0,15}(issue|problem|limit|restrict)/i.test(t) ||
      /(tight|stiff).{0,15}(hip|ankle|shoulder|wrist)/i.test(t)) flags.mobility_restriction = true;

  // ── grip_limiting ──────────────────────────────────────────────────────────
  if (/grip.{0,15}(limit|fail|slip|weak|issue|problem)/i.test(t) ||
      /(hand|hands|wrist).{0,15}(slip|fail|weak|give)/i.test(t)) flags.grip_limiting = true;

  // ── pause_much_harder ──────────────────────────────────────────────────────
  if (/pause.{0,20}(harder|much harder|worse|difficult)/i.test(t)) flags.pause_much_harder = true;

  // ── touch_point_inconsistent ───────────────────────────────────────────────
  if (/touch.{0,20}(inconsistent|vary|different|spot|point)/i.test(t)) flags.touch_point_inconsistent = true;

  return flags;
}

// ─── POST /sessions/:id/chat ───────────────────────────────────────────────────
const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});

router.post('/sessions/:id/chat', async (req, res) => {
  try {
    const { message } = chatMessageSchema.parse(req.body);
    const sessionId = req.params.id;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        snapshots: true,
        messages: { orderBy: { createdAt: 'asc' } },
        plans: { orderBy: { createdAt: 'desc' }, take: 1 },
        user: true,
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    let threadId = session.threadId;

    // Create thread on first chat message
    if (!threadId) {
      const latestPlan = session.plans[0] ? JSON.parse(session.plans[0].planJson) : null;

      threadId = await createChatThread({
        selectedLift: session.selectedLift,
        profile: session.user ? {
          trainingAge: session.user.trainingAge ?? undefined,
          equipment: session.user.equipment ?? undefined,
          constraintsText: session.user.constraintsText ?? undefined,
          weightKg: session.user.weightKg ?? undefined,
          heightCm: session.user.heightCm ?? undefined,
        } : undefined,
        snapshots: session.snapshots.map(s => ({
          exerciseId: s.exerciseId,
          weight: s.weight,
          sets: s.sets,
          repsSchema: s.repsSchema,
          rpeOrRir: s.rpeOrRir ?? undefined,
        })),
        diagnosticMessages: session.messages.map(m => ({
          role: m.role,
          message: m.message,
        })),
        plan: latestPlan,
      });

      await prisma.session.update({
        where: { id: sessionId },
        data: { threadId },
      });
    }

    const reply = await sendChatMessage(threadId, message);
    return res.json({ reply });

  } catch (err: any) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

function formatPlanAsText(plan: any): string {
  let text = `# ${plan.bench_day_plan.primary_lift.exercise_name} Training Plan\n\n`;
  
  text += `## Diagnosis\n`;
  plan.diagnosis.forEach((d: any) => {
    text += `- **${d.limiterName}** (${Math.round(d.confidence * 100)}% confidence)\n`;
    d.evidence.forEach((e: string) => text += `  - ${e}\n`);
  });
  
  text += `\n## Primary Lift\n`;
  const pl = plan.bench_day_plan.primary_lift;
  text += `**${pl.exercise_name}**: ${pl.sets} sets × ${pl.reps} reps @ ${pl.intensity}, ${pl.rest_minutes}min rest\n`;
  
  text += `\n## Accessories\n`;
  plan.bench_day_plan.accessories.forEach((acc: any) => {
    text += `**${acc.exercise_name}**: ${acc.sets} sets × ${acc.reps} reps\n`;
    text += `  *Why: ${acc.why}*\n\n`;
  });
  
  text += `\n## Progression\n`;
  plan.progression_rules.forEach((rule: string) => text += `- ${rule}\n`);
  
  text += `\n## Track Next Time\n`;
  plan.track_next_time.forEach((item: string) => text += `- ${item}\n`);
  
  return text;
}

export default router;
