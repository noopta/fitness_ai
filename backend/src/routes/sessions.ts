import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import twilio from 'twilio';
import { generateDiagnosticQuestion, generateWorkoutPlan, generateInitialAnalysis } from '../services/llmService.js';
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
  sets: z.number(),
  repsSchema: z.string(),
  rpeOrRir: z.string().optional()
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

// POST /api/sessions/:id/snapshots - Add exercise snapshot
router.post('/sessions/:id/snapshots', async (req, res) => {
  try {
    const { id } = req.params;
    const data = addSnapshotSchema.parse(req.body);
    
    const snapshot = await prisma.exerciseSnapshot.create({
      data: {
        sessionId: id,
        exerciseId: data.exerciseId,
        weight: data.weight,
        sets: data.sets,
        repsSchema: data.repsSchema,
        rpeOrRir: data.rpeOrRir
      }
    });
    
    res.json({ snapshot });
  } catch (error) {
    console.error('Error adding snapshot:', error);
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
    
    // Generate plan
    const plan = await generateWorkoutPlan({
      selectedLift: session.selectedLift,
      trainingAge: session.user?.trainingAge || undefined,
      goal: session.goal || undefined,
      equipment: session.user?.equipment || undefined,
      constraints: session.user?.constraintsText || undefined,
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
