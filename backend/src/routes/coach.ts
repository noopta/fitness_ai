import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import twilio from 'twilio';
import {
  createCoachThread, sendCoachMessage, getCoachMessages, type CoachSession,
  generateNutritionPlan, generateTrainingProgram, generateCoachInsight,
  generateTodayCoachingTips,
} from '../services/llmService.js';

const router = Router();
const prisma = new PrismaClient();

let twilioClient: ReturnType<typeof twilio> | null = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try { twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }
  catch { /* disabled */ }
}

async function sendCoachSMS(body: string) {
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER || !process.env.NOTIFICATION_PHONE) return;
  try {
    await twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: process.env.NOTIFICATION_PHONE });
  } catch (e) { console.error('Coach SMS failed:', e); }
}

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

    // Check if this is a new program (no existing savedProgram)
    const existing = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { savedProgram: true, programStartDate: true },
    });
    const isNewProgram = !existing?.savedProgram || !existing?.programStartDate;

    const updatedUser = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        savedProgram: JSON.stringify(program),
        ...(isNewProgram ? { programStartDate: new Date() } : {}),
      },
      select: { name: true, email: true, tier: true },
    });

    if (isNewProgram) {
      const goalLabel = program.goal || 'unknown';
      const weeks = program.durationWeeks || '?';
      const days = program.daysPerWeek || '?';
      sendCoachSMS(`💪 Program created: ${updatedUser.name || 'User'} (${updatedUser.email}) — ${goalLabel}, ${weeks}wk, ${days}d/wk [${updatedUser.tier}]`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Save program error:', err);
    res.status(500).json({ error: 'Failed to save program' });
  }
});

// GET /api/coach/today - Get today's workout from saved program
router.get('/coach/today', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        wellnessCheckins: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.savedProgram) return res.json({ program: null });

    const program = JSON.parse(user.savedProgram);
    const startDate = user.programStartDate || new Date();

    // Calculate which week we're on (1-indexed)
    const msSinceStart = Date.now() - new Date(startDate).getTime();
    const daysSinceStart = Math.floor(msSinceStart / (1000 * 60 * 60 * 24));
    const weekNumber = Math.min(Math.floor(daysSinceStart / 7) + 1, program.durationWeeks || 12);

    // Find which phase we're in
    let cumulativeWeeks = 0;
    let currentPhase = program.phases?.[0] || null;
    let phaseNumber = 1;
    if (program.phases) {
      for (let i = 0; i < program.phases.length; i++) {
        cumulativeWeeks += program.phases[i].durationWeeks;
        if (weekNumber <= cumulativeWeeks) {
          currentPhase = program.phases[i];
          phaseNumber = i + 1;
          break;
        }
        currentPhase = program.phases[i];
        phaseNumber = i + 1;
      }
    }

    if (!currentPhase || !currentPhase.trainingDays) {
      return res.json({
        program: null,
        weekNumber,
        phaseNumber,
        phaseName: currentPhase?.phaseName || null,
      });
    }

    // Determine today's day of the week (0=Sun, 1=Mon, ...) and map to training day
    const dayOfWeek = new Date().getDay(); // 0=Sun
    // Training days are indexed within the week; we cycle through trainingDays
    const trainingDays = currentPhase.trainingDays;
    const totalDays = trainingDays.length;

    // Use daysSinceStart mod 7 to pick which day in the template week
    const dayInWeek = daysSinceStart % 7; // 0–6
    // Find if today is a training day; simple mapping: first N days of week = training
    const todaySession = dayInWeek < totalDays ? trainingDays[dayInWeek] : null;
    const isRestDay = !todaySession;

    // Next training day
    let nextTrainingDay: string | null = null;
    if (isRestDay) {
      // Find next training day index
      for (let i = dayInWeek + 1; i < 7; i++) {
        if (i < totalDays) {
          nextTrainingDay = trainingDays[i].day;
          break;
        }
      }
      if (!nextTrainingDay && totalDays > 0) {
        nextTrainingDay = trainingDays[0].day; // Next week
      }
    }

    // Get wellness signals for tips
    const latestCheckin = user.wellnessCheckins[0] || null;
    const latestPlan = user.sessions[0]?.plans[0] ? JSON.parse(user.sessions[0].plans[0].planJson) : null;
    const primaryLimiter = latestPlan?.diagnosis?.[0]?.limiterName || null;

    let tips: string | null = null;
    if (!isRestDay && todaySession) {
      try {
        tips = await generateTodayCoachingTips({
          dayName: todaySession.day,
          dayFocus: todaySession.focus,
          exercises: todaySession.exercises || [],
          phaseName: currentPhase.phaseName,
          weekNumber,
          sleepHours: latestCheckin?.sleepHours ?? null,
          stressLevel: latestCheckin?.stress ?? null,
          energyLevel: latestCheckin?.energy ?? null,
          trainingAge: user.trainingAge,
          primaryLimiter,
        });
      } catch (e) {
        console.error('Tips generation failed:', e);
      }
    }

    res.json({
      todaySession: isRestDay ? null : todaySession,
      isRestDay,
      weekNumber,
      phaseNumber,
      phaseName: currentPhase.phaseName,
      tips,
      nextTrainingDay,
      programGoal: program.goal,
    });
  } catch (err) {
    console.error('Today endpoint error:', err);
    res.status(500).json({ error: 'Failed to load today\'s workout' });
  }
});

// GET /api/coach/schedule - Get the current week's schedule (Mon–Sun)
router.get('/coach/schedule', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.savedProgram) {
      return res.json({ weekDays: [], weekNumber: null, phaseName: null });
    }

    const program = JSON.parse(user.savedProgram);
    const startDate = user.programStartDate || new Date();

    const msSinceStart = Date.now() - new Date(startDate).getTime();
    const daysSinceStart = Math.floor(msSinceStart / (1000 * 60 * 60 * 24));
    const weekNumber = Math.min(Math.floor(daysSinceStart / 7) + 1, program.durationWeeks || 12);

    // Find current phase
    let cumulativeWeeks = 0;
    let currentPhase = program.phases?.[0] || null;
    if (program.phases) {
      for (let i = 0; i < program.phases.length; i++) {
        cumulativeWeeks += program.phases[i].durationWeeks;
        if (weekNumber <= cumulativeWeeks) { currentPhase = program.phases[i]; break; }
        currentPhase = program.phases[i];
      }
    }

    const trainingDays = currentPhase?.trainingDays || [];
    const totalDays = trainingDays.length;

    // Start of current ISO week (Monday)
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const weekDays = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);

      const daysForDate = Math.floor(
        (date.getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      const dayInWeek = ((daysForDate % 7) + 7) % 7;
      const session = dayInWeek < totalDays ? trainingDays[dayInWeek] : null;

      weekDays.push({
        date: date.toISOString(),
        dayLabel: DAY_LABELS[i],
        dateNumber: date.getDate(),
        monthLabel: date.toLocaleDateString('en-US', { month: 'short' }),
        isToday: date.toDateString() === today.toDateString(),
        isTrainingDay: !!session,
        session: session || null,
      });
    }

    res.json({ weekDays, weekNumber, phaseName: currentPhase?.phaseName || null });
  } catch (err) {
    console.error('Schedule endpoint error:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

export default router;
