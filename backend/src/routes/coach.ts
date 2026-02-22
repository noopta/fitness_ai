import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createCoachThread, sendCoachMessage, getCoachMessages, type CoachSession,
  generateNutritionPlan, generateTrainingProgram, generateCoachInsight,
} from '../services/llmService.js';

const router = Router();
const prisma = new PrismaClient();

const coachMessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

// GET /api/coach/messages - Get coach thread history and context for the user
router.get('/coach/messages', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessionSummaries = user.sessions.map(s => {
      const plan = s.plans[0] ? JSON.parse(s.plans[0].planJson) : null;
      return {
        id: s.id,
        selectedLift: s.selectedLift,
        createdAt: s.createdAt,
        primaryLimiter: plan?.diagnosis?.[0]?.limiterName || null,
        confidence: plan?.diagnosis?.[0]?.confidence || null,
        archetype: plan?.dominance_archetype?.label || null,
        efficiencyScore: plan?.diagnostic_signals?.efficiency_score?.score || null,
        accessories: plan?.bench_day_plan?.accessories?.map((a: any) => a.exercise_name) || [],
        plan,
      };
    });

    let messages: Array<{ role: string; content: string }> = [];
    if (user.coachThreadId) {
      try {
        messages = await getCoachMessages(user.coachThreadId);
      } catch {
        // Thread may have expired — will be recreated on next chat
      }
    }

    res.json({
      hasThread: !!user.coachThreadId,
      messages,
      sessionSummaries,
      tier: user.tier,
    });
  } catch (err) {
    console.error('Coach messages error:', err);
    res.status(500).json({ error: 'Failed to load coach' });
  }
});

// POST /api/coach/chat - Send a message to the AI Coach
router.post('/coach/chat', requireAuth, async (req, res) => {
  try {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'AI Coach is a pro feature', upgrade: true });
    }

    const { message } = coachMessageSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    let threadId = user.coachThreadId;

    // Create thread if it doesn't exist yet
    if (!threadId) {
      const sessions: CoachSession[] = user.sessions.map(s => {
        const plan = s.plans[0] ? JSON.parse(s.plans[0].planJson) : null;
        return {
          id: s.id,
          selectedLift: s.selectedLift,
          createdAt: s.createdAt,
          primaryLimiter: plan?.diagnosis?.[0]?.limiterName || null,
          confidence: plan?.diagnosis?.[0]?.confidence || null,
          archetype: plan?.dominance_archetype?.label || null,
          efficiencyScore: plan?.diagnostic_signals?.efficiency_score?.score || null,
          accessories: plan?.bench_day_plan?.accessories?.map((a: any) => a.exercise_name) || [],
          plan,
        };
      });

      threadId = await createCoachThread({
        userName: user.name,
        trainingAge: user.trainingAge,
        equipment: user.equipment,
        constraintsText: user.constraintsText,
        heightCm: user.heightCm,
        weightKg: user.weightKg,
        sessions,
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { coachThreadId: threadId },
      });
    }

    const reply = await sendCoachMessage(threadId, message);
    res.json({ reply });

  } catch (err: any) {
    console.error('Coach chat error:', err);
    res.status(500).json({ error: err.message || 'Coach chat failed' });
  }
});

// DELETE /api/coach/thread - Reset coach conversation
router.delete('/coach/thread', requireAuth, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { coachThreadId: null },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Coach reset error:', err);
    res.status(500).json({ error: 'Failed to reset coach' });
  }
});

// GET /api/coach/insights - One-sentence AI insight from latest session
router.get('/coach/insights', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const session = user.sessions[0];
    if (!session?.plans[0]) return res.json({ insight: null });
    const plan = JSON.parse(session.plans[0].planJson);
    const insight = await generateCoachInsight({
      primaryLimiter: plan?.diagnosis?.[0]?.limiterName || null,
      archetype: plan?.dominance_archetype?.label || null,
      efficiencyScore: plan?.diagnostic_signals?.efficiency_score?.score ?? null,
      selectedLift: session.selectedLift,
    });
    res.json({ insight });
  } catch (err) {
    console.error('Coach insights error:', err);
    res.status(500).json({ error: 'Failed to generate insight' });
  }
});

// GET /api/coach/analytics - Aggregate all user session data for charts
router.get('/coach/analytics', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        sessions: {
          orderBy: { createdAt: 'asc' },
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const dataPoints = user.sessions
      .filter(s => s.plans[0])
      .map(s => {
        const plan = JSON.parse(s.plans[0].planJson);
        const ds = plan?.diagnostic_signals;
        return {
          sessionId: s.id,
          date: s.createdAt.toISOString().split('T')[0],
          lift: s.selectedLift,
          primaryLimiter: plan?.diagnosis?.[0]?.limiterName || null,
          archetype: plan?.dominance_archetype?.label || null,
          efficiencyScore: ds?.efficiency_score?.score ?? null,
          hypothesisScores: ds?.hypothesis_scores || [],
          phaseScores: ds?.phase_scores || [],
          primaryPhase: ds?.primary_phase || null,
          indices: ds?.indices || {},
        };
      });

    // Limiter frequency count
    const limiterCounts: Record<string, number> = {};
    for (const d of dataPoints) {
      if (d.primaryLimiter) {
        limiterCounts[d.primaryLimiter] = (limiterCounts[d.primaryLimiter] || 0) + 1;
      }
    }

    res.json({ dataPoints, limiterCounts });
  } catch (err) {
    console.error('Coach analytics error:', err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// POST /api/coach/nutrition-plan - AI macro + food recommendations
const nutritionPlanSchema = z.object({
  goal: z.string().optional(),
  weightKg: z.number().nullable().optional(),
  trainingAge: z.string().nullable().optional(),
  primaryLimiter: z.string().nullable().optional(),
  selectedLift: z.string().nullable().optional(),
  budget: z.string().nullable().optional(),
});

router.post('/coach/nutrition-plan', requireAuth, async (req, res) => {
  try {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'Pro feature', upgrade: true });
    }
    const params = nutritionPlanSchema.parse(req.body);
    const plan = await generateNutritionPlan({
      goal: params.goal || 'general strength',
      weightKg: params.weightKg ?? null,
      trainingAge: params.trainingAge ?? null,
      primaryLimiter: params.primaryLimiter ?? null,
      selectedLift: params.selectedLift ?? null,
      budget: params.budget ?? null,
    });
    res.json(plan);
  } catch (err: any) {
    console.error('Nutrition plan error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate nutrition plan' });
  }
});

// POST /api/coach/program - Generate training program
const programSchema = z.object({
  goal: z.string(),
  daysPerWeek: z.number().int().min(2).max(6),
  durationWeeks: z.number().int().min(2).max(16),
});

router.post('/coach/program', requireAuth, async (req, res) => {
  try {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'Pro feature', upgrade: true });
    }
    const { goal, daysPerWeek, durationWeeks } = programSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const latestPlan = user.sessions[0]?.plans[0] ? JSON.parse(user.sessions[0].plans[0].planJson) : null;
    const accessories = latestPlan?.bench_day_plan?.accessories?.map((a: any) => a.exercise_name) || [];

    // Build diagnostic signals context from latest plan
    const ds = latestPlan?.diagnostic_signals;
    const diagnosticSignals = ds ? {
      primaryPhase: ds.primary_phase || null,
      hypothesisScores: ds.hypothesis_scores || [],
      efficiencyScore: ds.efficiency_score?.score ?? undefined,
      indices: ds.indices || {},
    } : null;

    const program = await generateTrainingProgram({
      goal,
      daysPerWeek,
      durationWeeks,
      trainingAge: user.trainingAge,
      equipment: user.equipment,
      primaryLimiter: latestPlan?.diagnosis?.[0]?.limiterName || null,
      selectedLift: user.sessions[0]?.selectedLift || null,
      accessories,
      coachProfile: user.coachProfile,
      diagnosticSignals,
    });

    res.json(program);
  } catch (err: any) {
    console.error('Program generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate program' });
  }
});

// GET /api/coach/program - Fetch saved program
router.get('/coach/program', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const program = user.savedProgram ? JSON.parse(user.savedProgram) : null;
    res.json({ program });
  } catch (err) {
    console.error('Get program error:', err);
    res.status(500).json({ error: 'Failed to fetch program' });
  }
});

// PUT /api/coach/program - Save program
router.put('/coach/program', requireAuth, async (req, res) => {
  try {
    const { program } = req.body;
    if (!program) return res.status(400).json({ error: 'program required' });
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { savedProgram: JSON.stringify(program) },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Save program error:', err);
    res.status(500).json({ error: 'Failed to save program' });
  }
});

export default router;
