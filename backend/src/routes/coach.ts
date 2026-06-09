import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import twilio from 'twilio';
import OpenAI from 'openai';
import { logActivity } from '../services/activityService.js';
import { cacheGet, cacheSet, cacheDelete, cacheClearByPrefix } from '../services/cacheService.js';
import {
  createCoachThread, sendCoachMessage, getCoachMessages, type CoachSession,
  generateNutritionPlan, generateMealSuggestions, generateTrainingProgram, generateCoachInsight,
  generateTodayCoachingTips, generateProgramAdjustment, extractBodyCompositionGoal, generateWelcomeMessage,
  rebalanceWeekAfterSwap,
} from '../services/llmService.js';
import { buildRAGContext } from '../services/ragService.js';
import { computePhaseState, parseSavedProgram } from '../services/programPhaseService.js';
import { detectAndNotifyWeightMilestone } from '../services/progressService.js';
import { archiveProgram } from '../services/completedProgramService.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
import { getExerciseVideo } from '../services/youtubeService.js';

const router = Router();
const prisma = new PrismaClient();

// Returns the current calendar date string (YYYY-MM-DD) in America/New_York (EST/EDT).
// The server runs UTC; without this, after 7 PM EST (midnight UTC) the "today" date flips a day early.
function getESTDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // 'YYYY-MM-DD'
}

// Returns noon UTC for a given EST calendar date, suitable for both day-diff arithmetic
// and display (midnight UTC = 7 PM EST the prior day, causing off-by-one in toLocaleDateString).
function estMidnight(date: Date = new Date()): Date {
  return new Date(getESTDateString(date) + 'T12:00:00Z');
}

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

    const phaseState = computePhaseState(parseSavedProgram(user.savedProgram), user.programStartDate);

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
      currentWeek: user.savedProgram ? phaseState.weekNumber : null,
      currentPhaseName: phaseState.phaseName,
      currentPhaseIndex: user.savedProgram ? phaseState.phaseIndex : null,
      currentPhaseNumber: user.savedProgram ? phaseState.phaseNumber : null,
      weekInPhase: user.savedProgram ? phaseState.weekInPhase : null,
      totalWeeks: user.savedProgram ? phaseState.totalWeeks : null,
      // Mobile reads this to surface a "your program is complete — start the
      // next one" CTA that routes to ProgramSetup.
      programComplete: user.savedProgram ? phaseState.isComplete : false,
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

// ─── Full user context builder for streaming chat ─────────────────────────────
// Cached per user (TTL: 90 min). Bust on any data write.
const USER_CTX_TTL = 90 * 60 * 1000;

async function buildFullUserContext(userId: string): Promise<string> {
  const cacheKey = `userctx:${userId}`;
  const cached = cacheGet<string>(cacheKey);
  if (cached) return cached;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10);

  const [user, workoutLogs, nutritionLogs, mealEntries, wellnessCheckins, bodyWeightLogs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        sessions: {
          orderBy: { createdAt: 'desc' },
          include: {
            plans: { orderBy: { createdAt: 'desc' }, take: 1 },
            snapshots: true,
          },
        },
      },
    }),
    prisma.workoutLog.findMany({
      where: { userId, date: { gte: thirtyDaysAgoStr } },
      orderBy: { date: 'desc' },
    }),
    prisma.nutritionLog.findMany({
      where: { userId, date: { gte: thirtyDaysAgoStr } },
      orderBy: { date: 'desc' },
    }),
    prisma.mealEntry.findMany({
      where: { userId, date: { gte: thirtyDaysAgoStr } },
      orderBy: { date: 'desc' },
    }),
    prisma.wellnessCheckin.findMany({
      where: { userId, date: { gte: fourteenDaysAgoStr } },
      orderBy: { date: 'desc' },
    }),
    prisma.bodyWeightLog.findMany({
      where: { userId, date: { gte: thirtyDaysAgoStr } },
      orderBy: { date: 'desc' },
    }),
  ]);

  if (!user) return '';

  const lines: string[] = [];
  lines.push('=== ATHLETE PROFILE ===');
  if (user.name) lines.push(`Name: ${user.name}`);
  if (user.email) lines.push(`Email: ${user.email}`);
  if (user.trainingAge) lines.push(`Training age: ${user.trainingAge}`);
  if (user.equipment) lines.push(`Equipment: ${user.equipment}`);
  if (user.constraintsText) lines.push(`Constraints/injuries: ${user.constraintsText}`);
  if (user.weightKg) lines.push(`Body weight: ${user.weightKg} kg (${Math.round(user.weightKg * 2.205)} lbs)`);
  if (user.heightCm) lines.push(`Height: ${user.heightCm} cm`);
  if (user.coachGoal) lines.push(`Primary goal: ${user.coachGoal}`);
  if (user.coachBudget) lines.push(`Weekly food budget: ${user.coachBudget}`);
  if (user.coachProfile) lines.push(`Coach profile notes: ${user.coachProfile}`);

  // Active training program
  if (user.savedProgram) {
    try {
      const prog = JSON.parse(user.savedProgram);
      lines.push('\n=== ACTIVE TRAINING PROGRAM ===');
      if (prog.programName) lines.push(`Program: ${prog.programName}`);
      if (prog.weeksTotal) lines.push(`Duration: ${prog.weeksTotal} weeks`);
      if (prog.daysPerWeek) lines.push(`Days/week: ${prog.daysPerWeek}`);
      if (prog.primaryGoal) lines.push(`Goal: ${prog.primaryGoal}`);
      if (prog.coachNote) lines.push(`Coach note: ${prog.coachNote}`);
      if (prog.weeks && Array.isArray(prog.weeks)) {
        lines.push('Weeks:');
        for (const week of prog.weeks.slice(0, 4)) {
          lines.push(`  Week ${week.weekNumber} (${week.focus || ''}): ${week.days?.length || 0} training days`);
          if (week.days) {
            for (const day of week.days) {
              const exNames = (day.exercises || []).map((e: any) => e.exercise).join(', ');
              lines.push(`    ${day.day}: ${day.sessionType || ''} — ${exNames}`);
            }
          }
        }
      }
      if (prog.nutritionPlan) {
        const n = prog.nutritionPlan;
        lines.push(`Nutrition plan: ${n.calories} kcal — P:${n.proteinG}g C:${n.carbsG}g F:${n.fatG}g`);
        if (n.mealTiming) lines.push(`Meal timing: ${n.mealTiming}`);
      }
    } catch { /* skip bad JSON */ }
  }

  // Diagnostic sessions
  if (user.sessions.length > 0) {
    lines.push('\n=== DIAGNOSTIC ANALYSIS HISTORY ===');
    for (const s of user.sessions) {
      const plan = s.plans[0] ? JSON.parse(s.plans[0].planJson) : null;
      lines.push(`\n--- ${s.selectedLift.replace(/_/g, ' ').toUpperCase()} (${new Date(s.createdAt).toLocaleDateString()}) ---`);
      if (s.snapshots.length > 0) {
        lines.push('  Working weights logged:');
        for (const snap of s.snapshots) {
          lines.push(`    ${snap.exerciseId}: ${snap.weight} lbs × ${snap.sets}×${snap.repsSchema}${snap.rpeOrRir ? ` @ RPE ${snap.rpeOrRir}` : ''}`);
        }
      }
      if (plan?.diagnosis?.length > 0) {
        lines.push('  Limiters identified:');
        for (const d of plan.diagnosis) {
          lines.push(`    [${Math.round((d.confidence || 0) * 100)}%] ${d.limiterName}: ${(d.evidence || []).join('; ')}`);
        }
      }
      if (plan?.dominance_archetype) lines.push(`  Archetype: ${plan.dominance_archetype.label}`);
      if (plan?.diagnostic_signals?.efficiency_score?.score != null) {
        lines.push(`  Muscle balance score: ${plan.diagnostic_signals.efficiency_score.score}/100`);
      }
      if (plan?.diagnostic_signals?.primary_phase) {
        lines.push(`  Primary weak phase: ${plan.diagnostic_signals.primary_phase}`);
      }
      if (plan?.bench_day_plan?.accessories?.length > 0) {
        lines.push('  Prescribed accessories:');
        for (const a of plan.bench_day_plan.accessories) {
          lines.push(`    ${a.exercise_name}: ${a.sets}×${a.reps} — ${a.why}`);
        }
      }
      if (plan?.progression_rules?.length > 0) {
        lines.push(`  Progression: ${plan.progression_rules.join('; ')}`);
      }
    }
  }

  // Recent workout logs
  if (workoutLogs.length > 0) {
    lines.push('\n=== RECENT WORKOUT LOGS (last 30 days) ===');
    for (const log of workoutLogs) {
      const exs: any[] = JSON.parse(log.exercises);
      const summary = exs.map((e: any) =>
        `${e.name} ${e.sets}×${e.reps}${e.weightKg != null ? ` @ ${e.weightKg} lbs` : ''}${e.rpe ? ` RPE ${e.rpe}` : ''}`
      ).join(' | ');
      lines.push(`  ${log.date} — ${log.title || 'Workout'}: ${summary}`);
      if (log.notes) lines.push(`    Notes: ${log.notes}`);
    }
  }

  // Nutrition logs + individual meal entries grouped by date
  if (nutritionLogs.length > 0 || mealEntries.length > 0) {
    lines.push('\n=== NUTRITION LOGS (last 30 days) ===');
    // Build a map of date → meal entries for quick lookup
    const mealsByDate = new Map<string, typeof mealEntries>();
    for (const m of mealEntries) {
      if (!mealsByDate.has(m.date)) mealsByDate.set(m.date, []);
      mealsByDate.get(m.date)!.push(m);
    }
    // Print daily totals with individual meals nested underneath
    for (const log of nutritionLogs) {
      lines.push(`  ${log.date}: ${Math.round(log.calories)} kcal — P:${log.proteinG}g C:${log.carbsG}g F:${log.fatG}g${log.notes ? ` (${log.notes})` : ''}`);
      const meals = mealsByDate.get(log.date);
      if (meals?.length) {
        for (const m of meals) {
          lines.push(`    • ${m.name} — ${Math.round(m.calories)} kcal P:${m.proteinG}g C:${m.carbsG}g F:${m.fatG}g${m.notes ? ` (${m.notes})` : ''}`);
        }
        mealsByDate.delete(log.date); // mark as printed
      }
    }
    // Any meal entries on dates that don't have a daily total yet
    for (const [date, meals] of mealsByDate) {
      lines.push(`  ${date}: (meal entries only)`);
      for (const m of meals) {
        lines.push(`    • ${m.name} — ${Math.round(m.calories)} kcal P:${m.proteinG}g C:${m.carbsG}g F:${m.fatG}g${m.notes ? ` (${m.notes})` : ''}`);
      }
    }
  }

  // Wellness check-ins
  if (wellnessCheckins.length > 0) {
    lines.push('\n=== WELLNESS CHECK-INS (last 14 days) ===');
    for (const c of wellnessCheckins) {
      lines.push(`  ${c.date}: mood ${c.mood}/5, energy ${c.energy}/5, sleep ${c.sleepHours}h, stress ${c.stress}/5`);
    }
  }

  // Body weight trend
  if (bodyWeightLogs.length > 0) {
    lines.push('\n=== BODY WEIGHT LOG (last 30 days) ===');
    const recent = bodyWeightLogs.slice(0, 5);
    for (const w of recent) {
      lines.push(`  ${w.date}: ${w.weightLbs} lbs${w.notes ? ` (${w.notes})` : ''}`);
    }
    if (bodyWeightLogs.length > 5) {
      const oldest = bodyWeightLogs[bodyWeightLogs.length - 1].weightLbs;
      const newest = bodyWeightLogs[0].weightLbs;
      const delta = newest - oldest;
      lines.push(`  Trend: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} lbs over ${bodyWeightLogs.length} entries`);
    }
  }

  const ctx = lines.join('\n');
  cacheSet(cacheKey, ctx, USER_CTX_TTL);
  return ctx;
}

// POST /api/coach/chat/stream - Streaming chat with gpt-4.1-mini via SSE
router.post('/coach/chat/stream', requireAuth, async (req, res) => {
  try {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'AI Coach is a pro feature', upgrade: true });
    }

    const { message, history } = req.body as {
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    // Build full user context (cached, DB hit only on cold cache) + RAG in parallel
    const [userContext, ragContext] = await Promise.all([
      buildFullUserContext(req.user!.id),
      buildRAGContext(message, 3),
    ]);

    const systemPrompt = [
      `You are Anakin, an expert AI strength and fitness coach with expertise equivalent to NSCA-CSCS, ACE, and ISSN certifications.`,
      `You have full access to this athlete's complete profile, training history, nutrition data, wellness check-ins, and active program below.`,
      `Reference specific data from their profile when relevant. Be direct, evidence-based, practical, and encouraging.`,
      `Use markdown formatting for structured responses. All weights are in lbs.`,
      userContext,
      ragContext || '',
    ].filter(Boolean).join('\n\n');

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...((history ?? []).slice(-12) as OpenAI.ChatCompletionMessageParam[]),
      { role: 'user', content: message },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      stream: true,
      max_completion_tokens: 800,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? '';
      if (text) {
        res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
    logActivity(req.user!.id, 'analysis').catch(() => {});
  } catch (err: any) {
    console.error('Coach stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Stream failed' });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message ?? 'Stream error' })}\n\n`);
      res.end();
    }
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
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { heightCm: true, coachProfile: true } });
    const coachProfileObj = user?.coachProfile ? (() => { try { return JSON.parse(user.coachProfile!); } catch { return {}; } })() : {};
    const resolvedGender = coachProfileObj?.gender || null;
    const bodyCompositionGoal = extractBodyCompositionGoal(coachProfileObj?.primaryGoal);
    const plan = await generateNutritionPlan({
      goal: params.goal || 'general strength',
      bodyCompositionGoal,
      weightKg: params.weightKg ?? null,
      heightCm: user?.heightCm ?? null,
      trainingAge: params.trainingAge ?? null,
      primaryLimiter: params.primaryLimiter ?? null,
      selectedLift: params.selectedLift ?? null,
      budget: params.budget ?? null,
      gender: resolvedGender,
      activityLevel: coachProfileObj?.activityLevel || null,
      dietaryRestrictions: coachProfileObj?.dietaryRestrictions || null,
      nutritionQuality: coachProfileObj?.nutritionQuality || null,
      currentProteinIntake: coachProfileObj?.proteinIntake || null,
    });
    res.json(plan);
  } catch (err: any) {
    console.error('Nutrition plan error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate nutrition plan' });
  }
});

// POST /api/coach/program - Generate training program
const programSchema = z.object({
  goal: z.string().optional(), // Optional — derived from coachProfile.trainingPreference if not provided
  // Explicit body-composition goal from the goal picker. When present it
  // overrides the free-text inference (so "lose fat / weight" reliably drives
  // a calorie-deficit nutrition plan instead of defaulting to maintenance).
  bodyCompositionGoal: z.enum(['fat_loss', 'muscle_gain', 'recomp', 'maintenance']).optional(),
  daysPerWeek: z.number().int().min(2).max(6),
  durationWeeks: z.number().int().min(2).max(16),
  gender: z.string().nullable().optional(),
});

function inferGoalFromProfile(trainingPreference?: string, primaryGoal?: string): string {
  const pref = (trainingPreference || '').toLowerCase();
  if (pref === 'strength') return 'strength';
  if (pref === 'hypertrophy') return 'hypertrophy';
  if (pref === 'athletic') return 'athletic';
  if (pref === 'mixed') return 'mixed';
  const goal = (primaryGoal || '').toLowerCase();
  if (goal.includes('strength') || goal.includes('strong')) return 'strength';
  if (goal.includes('muscle') || goal.includes('hypertro') || goal.includes('size')) return 'hypertrophy';
  if (goal.includes('athletic') || goal.includes('power') || goal.includes('sport')) return 'athletic';
  return 'strength';
}

router.post('/coach/program', requireAuth, async (req, res) => {
  try {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'Pro feature', upgrade: true });
    }
    const { goal: requestedGoal, bodyCompositionGoal: requestedBodyComp, daysPerWeek, durationWeeks, gender } = programSchema.parse(req.body);

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

    // Resolve gender and goal: request param > coachProfile JSON > inferred
    const coachProfileObj = user.coachProfile ? (() => { try { return JSON.parse(user.coachProfile); } catch { return {}; } })() : {};
    const resolvedGender = gender || coachProfileObj?.gender || null;
    const goal = requestedGoal || inferGoalFromProfile(coachProfileObj?.trainingPreference, coachProfileObj?.primaryGoal);
    // Explicit picker value wins; otherwise infer from the onboarding free text.
    const bodyCompositionGoal = requestedBodyComp || extractBodyCompositionGoal(coachProfileObj?.primaryGoal);

    const [program, nutritionPlan] = await Promise.all([
      generateTrainingProgram({
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
        gender: resolvedGender,
      }),
      generateNutritionPlan({
        goal,
        bodyCompositionGoal,
        weightKg: user.weightKg || null,
        heightCm: user.heightCm || null,
        trainingAge: user.trainingAge,
        primaryLimiter: latestPlan?.diagnosis?.[0]?.limiterName || null,
        selectedLift: user.sessions[0]?.selectedLift || null,
        budget: user.coachBudget || null,
        gender: resolvedGender,
        activityLevel: coachProfileObj?.activityLevel || null,
        dietaryRestrictions: coachProfileObj?.dietaryRestrictions || null,
        nutritionQuality: coachProfileObj?.nutritionQuality || null,
        currentProteinIntake: coachProfileObj?.proteinIntake || null,
      }).catch(() => null),
    ]);

    res.json({ ...program, nutritionPlan: nutritionPlan ?? undefined });
  } catch (err: any) {
    console.error('Program generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate program' });
  }
});

// GET /api/coach/program - Fetch saved program
router.get('/coach/program', requireAuth, async (req, res) => {
  try {
    const cacheKey = `program:${req.user!.id}`;
    const cached = cacheGet<{ program: unknown }>(cacheKey);
    if (cached) return res.json(cached);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { savedProgram: true, programStartDate: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const result = {
      program: user.savedProgram ? JSON.parse(user.savedProgram) : null,
      programStartDate: user.programStartDate ? user.programStartDate.toISOString() : null,
    };
    cacheSet(cacheKey, result); // no expiry — only cleared on save
    res.json(result);
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

    // Archive the prior program before it's overwritten — this is the
    // "Finished programs" history surface. We snapshot the JSON plus computed
    // stats (workouts logged, total volume, BW change, etc.) so the history
    // screen can render without re-querying. Errors here must NOT block the
    // save; archiving is best-effort.
    if (!isNewProgram) {
      try {
        // If we can tell the prior program ran its full duration, mark it
        // completed; otherwise it's just being replaced mid-cycle.
        const priorProgram = parseSavedProgram(existing!.savedProgram ?? null);
        const phaseState = computePhaseState(priorProgram, existing!.programStartDate ?? null);
        await archiveProgram(
          req.user!.id,
          existing!.savedProgram ?? null,
          existing!.programStartDate ?? null,
          phaseState.isComplete ? 'completed' : 'replaced',
        );
      } catch (err) {
        console.error('[coach] archive prior program failed:', (err as any)?.message ?? err);
      }
    }

    // Extract nutrition targets from the program's nutritionPlan so the
    // Nutrition Tab uses the program's calorie goal instead of TDEE formula.
    const nutritionMacros = program?.nutritionPlan?.macros ?? program?.nutritionPlan ?? null;
    const programCalories = nutritionMacros?.calories ?? null;
    const nutritionUpdate = programCalories != null
      ? { dailyCalorieTarget: Math.round(programCalories) }
      : {};

    const updatedUser = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        savedProgram: JSON.stringify(program),
        // Whether this is the first program OR a replacement, reset the start
        // date so the new program's week 1 starts today. Otherwise replacing
        // a finished program would land the user mid-way through the new one.
        programStartDate: new Date(),
        ...nutritionUpdate,
      },
      select: { name: true, email: true, tier: true },
    });

    if (isNewProgram) {
      const goalLabel = program.goal || 'unknown';
      const weeks = program.durationWeeks || '?';
      const days = program.daysPerWeek || '?';
      sendCoachSMS(`💪 Program created: ${updatedUser.name || 'User'} (${updatedUser.email}) — ${goalLabel}, ${weeks}wk, ${days}d/wk [${updatedUser.tier}]`);
    }

    // Invalidate caches since program changed
    cacheDelete(`program:${req.user!.id}`);
    cacheClearByPrefix(`today:${req.user!.id}:`);
    cacheClearByPrefix(`schedule:${req.user!.id}:`);
    cacheClearByPrefix(`dashboard:${req.user!.id}:`);
    cacheDelete(`userctx:${req.user!.id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Save program error:', err);
    res.status(500).json({ error: 'Failed to save program' });
  }
});

// GET /api/coach/completed-programs — paginated history of the user's prior
// programs, each with a stats summary. Sorted newest-finished first.
router.get('/coach/completed-programs', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20')) || 20, 50);
    const programs = await prisma.completedProgram.findMany({
      where: { userId: req.user!.id },
      orderBy: { endDate: 'desc' },
      take: limit,
      select: {
        id: true, startDate: true, endDate: true,
        goal: true, durationWeeks: true, daysPerWeek: true,
        stats: true, reason: true,
      },
    });
    res.json({
      programs: programs.map((p) => ({
        ...p,
        stats: p.stats ? safeJsonParse(p.stats) : null,
      })),
    });
  } catch (err) {
    console.error('List completed programs error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// GET /api/coach/completed-programs/:id — full archived program JSON + stats.
router.get('/coach/completed-programs/:id', requireAuth, async (req, res) => {
  try {
    const row = await prisma.completedProgram.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...row,
      programJson: safeJsonParse(row.programJson),
      stats: row.stats ? safeJsonParse(row.stats) : null,
    });
  } catch (err) {
    console.error('Get completed program error:', err);
    res.status(500).json({ error: 'Failed to load program' });
  }
});

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

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

    // Cache key includes date + latest check-in id so new check-ins bust the cache
    const dateKey = getESTDateString();
    const checkinId = user.wellnessCheckins[0]?.id || 'none';
    const todayCacheKey = `today:${req.user!.id}:${dateKey}:${checkinId}`;
    const cachedToday = cacheGet(todayCacheKey);
    if (cachedToday) return res.json(cachedToday);

    const program = JSON.parse(user.savedProgram);
    const phaseState = computePhaseState(program, user.programStartDate);
    const { weekNumber, phaseNumber, currentPhase, daysSinceStart } = phaseState;

    if (!currentPhase || !currentPhase.trainingDays) {
      return res.json({
        program: null,
        weekNumber,
        phaseNumber,
        phaseName: currentPhase?.phaseName || null,
      });
    }

    // Training days are indexed within the week; we cycle through trainingDays
    const trainingDays = currentPhase.trainingDays;
    const totalDays = trainingDays.length;

    // Use daysSinceStart mod 7 to pick which day in the template week
    const dayInWeek = daysSinceStart % 7; // 0–6
    // Find if today is a training day; simple mapping: first N days of week = training
    let todaySession = dayInWeek < totalDays ? trainingDays[dayInWeek] : null;
    // A per-date override (from a workout swap / rebalance) wins for today.
    const todayOverride = await prisma.scheduleOverride.findUnique({
      where: { userId_date: { userId: req.user!.id, date: dateKey } },
    });
    if (todayOverride) {
      todaySession = todayOverride.sessionJson ? JSON.parse(todayOverride.sessionJson) : null;
    }
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
        const tipsPromise = generateTodayCoachingTips({
          dayName: todaySession.day,
          dayFocus: todaySession.focus,
          exercises: todaySession.exercises || [],
          phaseName: phaseState.phaseName ?? '',
          weekNumber,
          sleepHours: latestCheckin?.sleepHours ?? null,
          stressLevel: latestCheckin?.stress ?? null,
          energyLevel: latestCheckin?.energy ?? null,
          trainingAge: user.trainingAge,
          primaryLimiter,
        }).catch(() => null);
        const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 8000));
        tips = await Promise.race([tipsPromise, timeoutPromise]);
      } catch (e) {
        console.error('Tips generation failed:', e);
      }
    }

    // Sum any workout calorie burn already logged today. Mobile NutritionTab
    // subtracts this from the day's kcal-left display when the user has
    // subtractWorkoutBurnFromCalories enabled.
    const todaysLogs = await prisma.workoutLog.findMany({
      where: { userId: req.user!.id, date: dateKey },
      select: { caloriesBurnedKcal: true },
    });
    const caloriesBurnedKcalToday = todaysLogs.reduce(
      (sum, l) => sum + (l.caloriesBurnedKcal ?? 0),
      0,
    );

    const todayResult = {
      todaySession: isRestDay ? null : todaySession,
      isRestDay,
      weekNumber,
      phaseNumber,
      phaseName: currentPhase.phaseName,
      tips,
      nextTrainingDay,
      programGoal: program.goal,
      caloriesBurnedKcalToday,
    };
    // Cache until the next EST day (use noon UTC of tomorrow EST to avoid timezone bleed)
    const tomorrowEST = new Date(getESTDateString() + 'T12:00:00Z');
    tomorrowEST.setUTCDate(tomorrowEST.getUTCDate() + 1);
    cacheSet(todayCacheKey, todayResult, tomorrowEST.getTime() - Date.now());
    res.json(todayResult);
  } catch (err) {
    console.error('Today endpoint error:', err);
    res.status(500).json({ error: 'Failed to load today\'s workout' });
  }
});

// POST /api/coach/adjust - Analyze a life disruption and return an adjustment plan
router.post('/coach/adjust', requireAuth, async (req, res) => {
  try {
    const { userInput } = req.body;
    if (!userInput || typeof userInput !== 'string' || userInput.trim().length < 5) {
      return res.status(400).json({ error: 'Please describe what happened.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Build today context (reuse schedule logic)
    let phaseName: string | null = null;
    let weekNumber: number | null = null;
    let todaySession: { day: string; focus: string } | null = null;
    let isRestDay = false;
    let weekSchedule: Array<{ dayLabel: string; isTrainingDay: boolean; sessionName?: string }> = [];

    if (user.savedProgram) {
      const program = JSON.parse(user.savedProgram);
      const startDate = user.programStartDate || new Date();
      const phaseState = computePhaseState(program, user.programStartDate);
      weekNumber = phaseState.weekNumber;
      phaseName = phaseState.phaseName;

      const trainingDays = phaseState.trainingDays;
      const totalDays = trainingDays.length;
      const dayInWeek = phaseState.daysSinceStart % 7;
      const session = dayInWeek < totalDays ? trainingDays[dayInWeek] : null;
      isRestDay = !session;
      todaySession = session ? { day: session.day, focus: session.focus } : null;

      // Build week schedule preview (Mon–Sun) using EST dates
      const todayEST = estMidnight();
      const dow = new Date(getESTDateString() + 'T12:00:00Z').getUTCDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(todayEST);
      monday.setUTCDate(todayEST.getUTCDate() + mondayOffset);
      const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + i);
        const daysForDate = Math.floor((date.getTime() - estMidnight(new Date(startDate)).getTime()) / (1000 * 60 * 60 * 24));
        const diw = ((daysForDate % 7) + 7) % 7;
        const s = diw < totalDays ? trainingDays[diw] : null;
        weekSchedule.push({ dayLabel: DAY_LABELS[i], isTrainingDay: !!s, sessionName: s?.day });
      }
    }

    const latestPlan = user.sessions[0]?.plans[0] ? JSON.parse(user.sessions[0].plans[0].planJson) : null;
    const primaryLimiter = latestPlan?.diagnosis?.[0]?.limiterName || null;

    const adjustment = await generateProgramAdjustment({
      userInput: userInput.trim(),
      goal: user.coachGoal,
      trainingAge: user.trainingAge,
      primaryLimiter,
      phaseName,
      weekNumber,
      todaySession,
      isRestDay,
      weekSchedule,
    });

    res.json(adjustment);
  } catch (err) {
    console.error('Adjust endpoint error:', err);
    res.status(500).json({ error: 'Failed to analyze disruption' });
  }
});

// POST /api/coach/apply-adjustment - Apply schedule shift to programStartDate
router.post('/coach/apply-adjustment', requireAuth, async (req, res) => {
  try {
    const { shiftDays } = req.body;
    if (typeof shiftDays !== 'number') return res.status(400).json({ error: 'shiftDays required' });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.savedProgram) return res.status(400).json({ error: 'No active program' });

    const currentStart = user.programStartDate || new Date();
    const newStart = new Date(new Date(currentStart).getTime() + shiftDays * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { programStartDate: newStart },
    });

    // Bust schedule/today/dashboard/userctx caches since start date changed
    cacheClearByPrefix(`today:${req.user!.id}:`);
    cacheClearByPrefix(`schedule:${req.user!.id}:`);
    cacheClearByPrefix(`dashboard:${req.user!.id}:`);
    cacheDelete(`userctx:${req.user!.id}`);

    res.json({ success: true, newProgramStartDate: newStart.toISOString() });
  } catch (err) {
    console.error('Apply adjustment error:', err);
    res.status(500).json({ error: 'Failed to apply adjustment' });
  }
});

// POST /api/coach/swap-day — propose swapping the chosen day's workout into the
// target day (today) and re-balancing the rest of the week. Returns a proposed
// week for the user to confirm; does NOT persist. Apply via /coach/apply-week-plan.
const swapDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),       // target day (usually today)
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // day whose workout to pull in
});
router.post('/coach/swap-day', requireAuth, async (req, res) => {
  try {
    const { date, sourceDate } = swapDaySchema.parse(req.body);
    if (date === sourceDate) return res.status(400).json({ error: 'Pick a different day to swap in.' });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.savedProgram) return res.status(400).json({ error: 'No active program' });

    const today = getESTDateString();
    const overrides = await fetchOverridesMap(req.user!.id, addDaysStr(today, -7), addDaysStr(today, 7));
    const { weekDays } = buildScheduleData(user, overrides);

    // Mark logged days (can't be reflowed/rewritten).
    const weekStart = weekDays[0]?.date ?? today;
    const weekEnd = weekDays[weekDays.length - 1]?.date ?? today;
    const logs = await prisma.workoutLog.findMany({
      where: { userId: req.user!.id, date: { gte: weekStart, lte: weekEnd } },
      select: { date: true },
    });
    const loggedDates = new Set(logs.map(l => l.date.slice(0, 10)));

    const targetDay = weekDays.find(d => d.date === date);
    const sourceDay = weekDays.find(d => d.date === sourceDate);
    if (!targetDay) return res.status(400).json({ error: 'Target day not in current week' });
    if (!sourceDay || !sourceDay.session) return res.status(400).json({ error: 'Selected day has no workout to swap in' });

    const chosenSession = sourceDay.session;                 // moves to the target day
    const displacedSession = targetDay.session ?? null;      // needs a new home

    // Future, unlocked slots we may re-arrange (strictly after target, not logged).
    const openSlots = weekDays.filter(d => d.date > date && !loggedDates.has(d.date));

    // Pool = future sessions + the displaced target session, minus one copy of
    // the chosen session (it moved to the target day).
    const pool: any[] = [];
    for (const d of openSlots) if (d.session) pool.push(d.session);
    if (displacedSession) pool.push(displacedSession);
    const chosenIdx = pool.findIndex(s => s?.day === chosenSession.day);
    if (chosenIdx >= 0) pool.splice(chosenIdx, 1);

    // Name → session lookup. Keyed by a normalized form (lowercase, em/en-dash
    // → '-', collapsed whitespace) because LLMs routinely return punctuation
    // variants like "Day 4 - Lower" instead of the stored "Day 4 — Lower",
    // which used to silently fail the exact-match lookup and drop every slot
    // into Rest.
    const normalizeName = (s: string) =>
      s.toLowerCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
    const sessionByName = new Map<string, any>();
    for (const s of [chosenSession, displacedSession, ...pool]) {
      if (s?.day) sessionByName.set(normalizeName(s.day), s);
    }

    // Ask the LLM to sequence the pool across the open slots (rest spacing).
    let assignments: Array<{ date: string; sessionName: string | null }> = [];
    let rationale = '';
    try {
      const result = await rebalanceWeekAfterSwap({
        goal: user.coachGoal,
        trainingAge: user.trainingAge,
        lockedDays: [
          { date, dayLabel: targetDay.dayLabel, sessionName: chosenSession.day, focus: chosenSession.focus, note: 'swapped in for today' },
          ...weekDays
            .filter(d => d.date < date || loggedDates.has(d.date))
            .map(d => ({ date: d.date, dayLabel: d.dayLabel, sessionName: d.session?.day ?? null, focus: d.session?.focus ?? null, note: loggedDates.has(d.date) ? 'already logged' : 'past' })),
        ],
        openSlots: openSlots.map(d => ({ date: d.date, dayLabel: d.dayLabel })),
        pool: pool.map(s => ({ name: s.day, focus: s.focus })),
      });
      assignments = result.assignments;
      rationale = result.rationale;
    } catch (e) {
      console.error('[swap-day] LLM rebalance failed, using deterministic fallback:', e);
    }

    // Build proposed open-slot assignments. Prefer the LLM's mapping; fall back
    // to placing the pool in order. Each pool session is used at most once.
    const usedNames = new Set<string>();
    const proposedOpen = new Map<string, any | null>();
    if (assignments.length > 0) {
      for (const a of assignments) {
        if (!openSlots.some(s => s.date === a.date)) continue;
        const s = a.sessionName ? sessionByName.get(normalizeName(a.sessionName)) : null;
        if (s && !usedNames.has(s.day)) { proposedOpen.set(a.date, s); usedNames.add(s.day); }
        // Intentionally do NOT set a null here. If the LLM placed null or named
        // a session we couldn't match, leave the slot OPEN so the leftover
        // pass below fills it. The old behavior set null here, then the
        // leftover loop's `proposedOpen.has(...)` check skipped these slots,
        // so any session we couldn't match got silently dropped into Rest.
      }
    }
    // Fill any open slot the LLM didn't *successfully* address with leftover
    // pool sessions in order. Uses `.get(...) !== undefined` rather than
    // `.has(...)` so explicit-null entries above don't block leftover fill.
    const leftovers = pool.filter(s => !usedNames.has(s.day));
    for (const slot of openSlots) {
      if (proposedOpen.get(slot.date) != null) continue;
      const next = leftovers.shift();
      if (next) { proposedOpen.set(slot.date, next); usedNames.add(next.day); }
      else proposedOpen.set(slot.date, null);
    }

    // Assemble the proposed week for the client to confirm.
    const proposedWeek = weekDays.map(d => {
      if (d.date === date) {
        return { ...d, session: chosenSession, isTrainingDay: true, isSwapped: true, locked: false };
      }
      if (d.date < date || loggedDates.has(d.date)) {
        return { ...d, locked: true };
      }
      const s = proposedOpen.has(d.date) ? proposedOpen.get(d.date) : d.session;
      const changed = (s?.day ?? null) !== (d.session?.day ?? null);
      return { ...d, session: s ?? null, isTrainingDay: !!s, isSwapped: changed, locked: false };
    });

    res.json({
      proposedWeek,
      rationale: rationale || `Moved ${chosenSession.day} to today and re-spaced the rest of your week for recovery.`,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('Swap-day error:', err);
    res.status(500).json({ error: 'Failed to plan swap' });
  }
});

// POST /api/coach/apply-week-plan — persist a confirmed proposed week as
// per-date ScheduleOverrides and bust the today/schedule/dashboard caches.
const applyWeekSchema = z.object({
  week: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    session: z.any().nullable().optional(),
    locked: z.boolean().optional(),
  })),
  reason: z.string().max(300).optional(),
});
router.post('/coach/apply-week-plan', requireAuth, async (req, res) => {
  try {
    const { week, reason } = applyWeekSchema.parse(req.body);
    const userId = req.user!.id;

    // Only persist non-locked days (locked = past / logged — never overwrite).
    const writable = week.filter(d => !d.locked);
    await prisma.$transaction(
      writable.map(d => prisma.scheduleOverride.upsert({
        where: { userId_date: { userId, date: d.date } },
        create: { userId, date: d.date, sessionJson: d.session ? JSON.stringify(d.session) : null, reason: reason ?? null },
        update: { sessionJson: d.session ? JSON.stringify(d.session) : null, reason: reason ?? null },
      })),
    );

    cacheClearByPrefix(`today:${userId}:`);
    cacheClearByPrefix(`schedule:${userId}:`);
    cacheClearByPrefix(`dashboard:${userId}:`);
    cacheDelete(`userctx:${userId}`);

    res.json({ success: true, applied: writable.length });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('Apply week plan error:', err);
    res.status(500).json({ error: 'Failed to apply week plan' });
  }
});

// Load per-date schedule overrides for a user within a date window and return
// them as a Map<dateStr, session|null>. A row with null sessionJson is an
// explicit rest day.
async function fetchOverridesMap(userId: string, fromDate: string, toDate: string): Promise<Map<string, any | null>> {
  const rows = await prisma.scheduleOverride.findMany({
    where: { userId, date: { gte: fromDate, lte: toDate } },
  });
  const map = new Map<string, any | null>();
  for (const r of rows) {
    map.set(r.date, r.sessionJson ? JSON.parse(r.sessionJson) : null);
  }
  return map;
}

// Add/subtract whole days from a YYYY-MM-DD string (EST-noon anchored).
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// GET /api/coach/schedule - Get the current week's schedule (Mon–Sun)
// Shared helper — computes schedule data for a user with a saved program.
function buildScheduleData(
  user: { savedProgram: string | null; programStartDate: Date | null },
  overrides?: Map<string, any | null>,
) {
  if (!user.savedProgram) return { weekDays: [], weekNumber: null, phaseName: null };

  const program = JSON.parse(user.savedProgram);
  const startDate = user.programStartDate || new Date();
  const phaseState = computePhaseState(program, user.programStartDate);
  const { weekNumber, currentPhase } = phaseState;

  const todayMidnight = estMidnight();
  const startMidnight = estMidnight(new Date(startDate));

  const trainingDays = phaseState.trainingDays;
  const totalDays = trainingDays.length;

  const dow = new Date(getESTDateString() + 'T12:00:00Z').getUTCDay();
  const sunday = new Date(todayMidnight);
  sunday.setUTCDate(todayMidnight.getUTCDate() - dow);

  const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const weekDays = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(sunday);
    date.setUTCDate(sunday.getUTCDate() + i);
    const daysForDate = Math.floor((date.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24));
    const dayInWeek = ((daysForDate % 7) + 7) % 7;
    const dateEST = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // A per-date override (from a swap/rebalance) wins over the index lookup.
    const hasOverride = overrides?.has(dateEST) ?? false;
    const session = hasOverride
      ? overrides!.get(dateEST)  // may be null = explicit rest
      : (dayInWeek < totalDays ? trainingDays[dayInWeek] : null);

    weekDays.push({
      date: dateEST,
      dayLabel: DAY_LABELS[i],
      dateNumber: parseInt(dateEST.split('-')[2]),
      monthLabel: date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short' }),
      isToday: dateEST === getESTDateString(),
      isTrainingDay: !!session,
      isSwapped: hasOverride,
      session: session || null,
    });
  }

  return { weekDays, weekNumber, phaseName: currentPhase?.phaseName || null };
}

router.get('/coach/schedule', requireAuth, async (req, res) => {
  try {
    const dateKey = getESTDateString();
    const scheduleCacheKey = `schedule:${req.user!.id}:${dateKey}`;
    const cached = cacheGet(scheduleCacheKey);
    if (cached) return res.json(cached);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.savedProgram) {
      return res.json({ weekDays: [], weekNumber: null, phaseName: null });
    }

    const today = getESTDateString();
    const overrides = await fetchOverridesMap(req.user!.id, addDaysStr(today, -7), addDaysStr(today, 7));
    const result = buildScheduleData(user, overrides);

    // Mark days that have a logged workout
    if (result.weekDays.length > 0) {
      const weekStart = result.weekDays[0].date.slice(0, 10);
      const weekEnd = result.weekDays[6].date.slice(0, 10);
      const logs = await prisma.workoutLog.findMany({
        where: { userId: req.user!.id, date: { gte: weekStart, lte: weekEnd } },
        select: { date: true },
      });
      const loggedDates = new Set(logs.map((l: { date: string }) => l.date.slice(0, 10)));
      for (const day of result.weekDays) {
        (day as any).isLogged = loggedDates.has(day.date.slice(0, 10));
      }
    }

    const tomorrowEST = new Date(getESTDateString() + 'T12:00:00Z');
    tomorrowEST.setUTCDate(tomorrowEST.getUTCDate() + 1);
    cacheSet(scheduleCacheKey, result, tomorrowEST.getTime() - Date.now());

    res.json(result);
  } catch (err) {
    console.error('Schedule endpoint error:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// GET /api/coach/dashboard - Returns today's workout + schedule in one request (both cached)
router.get('/coach/dashboard', requireAuth, async (req, res) => {
  try {
    const dateKey = getESTDateString();
    const dashCacheKey = `dashboard:${req.user!.id}:${dateKey}`;
    const cached = cacheGet(dashCacheKey);
    if (cached) return res.json(cached);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        wellnessCheckins: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Build schedule (with any swap overrides for the week applied)
    const overrides = await fetchOverridesMap(req.user!.id, addDaysStr(dateKey, -7), addDaysStr(dateKey, 7));
    const schedule = buildScheduleData(user, overrides);

    // Build today — reuse /coach/today cache if already warm
    const checkinId = user.wellnessCheckins[0]?.id || 'none';
    const todayCacheKey = `today:${user.id}:${dateKey}:${checkinId}`;
    const todayCached = cacheGet(todayCacheKey);
    // We intentionally skip re-computing today here if cache is cold — the full
    // /coach/today endpoint handles that with its richer logic (tips, nextTrainingDay, etc).
    // Dashboard returns schedule immediately plus today from cache if warm.
    const today = todayCached ?? null;

    const result = { today, schedule };

    const tomorrowEST = new Date(getESTDateString() + 'T12:00:00Z');
    tomorrowEST.setUTCDate(tomorrowEST.getUTCDate() + 1);
    cacheSet(dashCacheKey, result, tomorrowEST.getTime() - Date.now());

    res.json(result);
  } catch (err) {
    console.error('Dashboard endpoint error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/coach/exercise-video?name=... - Fetch YouTube tutorial for a free-form exercise name
router.get('/coach/exercise-video', requireAuth, async (req, res) => {
  try {
    const name = (req.query.name as string || '').trim();
    if (!name) return res.status(400).json({ error: 'name query param required' });
    // Use a slug as cache key so the same exercise always hits cache
    const cacheKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const video = await getExerciseVideo(cacheKey, name);
    if (!video) return res.status(404).json({ error: 'No video found' });
    res.json(video);
  } catch (err) {
    console.error('Coach exercise-video error:', err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// POST /api/coach/meal-suggestions - AI-generated meal ideas matching macros + budget
const mealSuggestionsSchema = z.object({
  macros: z.object({
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
    calories: z.number(),
  }),
  budget: z.string().nullable().optional(),
  goal: z.string().nullable().optional(),
  numberOfMeals: z.number().int().min(3).max(10).optional(),
});

router.post('/coach/meal-suggestions', requireAuth, async (req, res) => {
  try {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'Pro feature', upgrade: true });
    }
    const params = mealSuggestionsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { coachProfile: true, coachBudget: true } });
    const coachProfileObj = user?.coachProfile ? (() => { try { return JSON.parse(user.coachProfile!); } catch { return {}; } })() : {};
    const meals = await generateMealSuggestions({
      macros: params.macros,
      budget: params.budget ?? user?.coachBudget ?? null,
      goal: params.goal ?? null,
      numberOfMeals: params.numberOfMeals ?? 5,
      dietaryRestrictions: coachProfileObj?.dietaryRestrictions || null,
    });
    res.json({ meals });
  } catch (err: any) {
    console.error('Meal suggestions error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate meal suggestions' });
  }
});

// PUT /api/coach/budget - Save user's weekly food budget
router.put('/coach/budget', requireAuth, async (req, res) => {
  try {
    const { budget } = req.body;
    if (typeof budget !== 'string') return res.status(400).json({ error: 'budget string required' });
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { coachBudget: budget || null },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Budget save error:', err);
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

// ── Nutrition Calorie Adjustment ───────────────────────────────────────────────

// PUT /api/coach/nutrition-adjustment - Apply a calorie delta to the saved nutrition plan
router.put('/coach/nutrition-adjustment', requireAuth, async (req, res) => {
  try {
    const { calorieAdjustment } = z.object({ calorieAdjustment: z.number() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { savedProgram: true } });
    if (!user?.savedProgram) return res.status(404).json({ error: 'No saved program' });

    const program = JSON.parse(user.savedProgram);
    if (program.nutritionPlan?.macros) {
      // Store original calories on first adjustment so subsequent adjustments apply from base
      const original = program.nutritionPlan.macros._originalCalories ?? program.nutritionPlan.macros.calories;
      program.nutritionPlan.macros._originalCalories = original;
      program.nutritionPlan.macros.calories = original + calorieAdjustment;

      if (program.nutritionPlan.expectedOutcomes?.tdee) {
        const tdee = program.nutritionPlan.expectedOutcomes.tdee;
        const delta = program.nutritionPlan.macros.calories - tdee;
        program.nutritionPlan.expectedOutcomes.surplusOrDeficit = delta;
        program.nutritionPlan.expectedOutcomes.weeklyWeightChangeLb = Math.round(delta / 3500 * 7 * 10) / 10;
        program.nutritionPlan.expectedOutcomes.monthlyWeightChangeLb = Math.round(delta / 3500 * 30 * 10) / 10;
      }
    }

    const adjustedCalories = program.nutritionPlan?.macros?.calories ?? null;
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        savedProgram: JSON.stringify(program),
        ...(adjustedCalories != null ? { dailyCalorieTarget: Math.round(adjustedCalories) } : {}),
      },
    });
    cacheDelete(`program:${req.user!.id}`);

    res.json({ success: true, updatedNutritionPlan: program.nutritionPlan });
  } catch (err: any) {
    console.error('Nutrition adjustment error:', err);
    res.status(400).json({ error: err.message || 'Failed to save adjustment' });
  }
});

// ── Body Weight Log ────────────────────────────────────────────────────────────

const bodyWeightSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightLbs: z.number().positive(),
  notes: z.string().optional(),
});

// POST /api/coach/body-weight - Log a body weight entry
router.post('/coach/body-weight', requireAuth, async (req, res) => {
  try {
    const { date, weightLbs, notes } = bodyWeightSchema.parse(req.body);
    const userId = req.user!.id;

    // Upsert: replace existing entry for same date
    const existing = await prisma.bodyWeightLog.findFirst({ where: { userId, date } });
    let entry;
    if (existing) {
      entry = await prisma.bodyWeightLog.update({
        where: { id: existing.id },
        data: { weightLbs, notes: notes || null },
      });
    } else {
      entry = await prisma.bodyWeightLog.create({
        data: { userId, date, weightLbs, notes: notes || null },
      });
    }
    cacheDelete(`userctx:${userId}`);

    // Fire-and-forget weight-progress milestone detection — neuro-style
    // reinforcement when the user crosses ±5/10/15+ lbs in their goal direction.
    detectAndNotifyWeightMilestone(prisma, userId, date, weightLbs).catch(err =>
      console.error('[coach] weight milestone detection error:', err)
    );

    res.json(entry);
  } catch (err: any) {
    console.error('Body weight log error:', err);
    res.status(400).json({ error: err.message || 'Failed to save body weight' });
  }
});

// GET /api/coach/body-weight - Get body weight history (last 90 days)
router.get('/coach/body-weight', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const startDate = ninetyDaysAgo.toISOString().split('T')[0];

    const logs = await prisma.bodyWeightLog.findMany({
      where: { userId, date: { gte: startDate } },
      orderBy: { date: 'asc' },
    });
    res.json({ logs });
  } catch (err) {
    console.error('Body weight fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch body weight logs' });
  }
});

// GET /api/strength-profile — aggregate diagnostic + workout data for strength profile page
router.get('/strength-profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Fetch sessions with plans (last 20)
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    // Fetch workout logs (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
    const workoutLogs = await prisma.workoutLog.findMany({
      where: { userId, date: { gte: ninetyDaysAgoStr } },
      orderBy: { date: 'asc' },
    });

    // Fetch body weight logs (last 90 days)
    const weightLogs = await prisma.bodyWeightLog.findMany({
      where: { userId, date: { gte: ninetyDaysAgoStr } },
      orderBy: { date: 'asc' },
    });

    // Build session history with key stats
    const sessionHistory = sessions.map(s => {
      const plan = s.plans[0] ? JSON.parse(s.plans[0].planJson) : null;
      const signals = plan?.diagnostic_signals;
      return {
        id: s.id,
        date: s.createdAt.toISOString().split('T')[0],
        selectedLift: s.selectedLift,
        primaryLimiter: plan?.diagnosis?.[0]?.limiterName || null,
        efficiencyScore: signals?.efficiency_score?.score ?? null,
        indices: signals?.indices || null,
        hypothesisScores: signals?.hypothesis_scores || [],
      };
    });

    // Latest diagnostic signals (for indices / radar)
    const latestWithSignals = sessionHistory.find(s => s.indices);

    // Top limiters by frequency
    const limiterCounts: Record<string, number> = {};
    for (const s of sessionHistory) {
      if (s.primaryLimiter) {
        limiterCounts[s.primaryLimiter] = (limiterCounts[s.primaryLimiter] || 0) + 1;
      }
    }
    const topLimiters = Object.entries(limiterCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Efficiency score trend (for line chart)
    const efficiencyTrend = sessionHistory
      .filter(s => s.efficiencyScore !== null)
      .map(s => ({ date: s.date, score: s.efficiencyScore, lift: s.selectedLift }))
      .reverse();

    // Exercise progression from workout logs (group by exercise name, track max weight over time)
    const parsedLogs = workoutLogs.map(l => ({ ...l, exercises: JSON.parse(l.exercises) as any[] }));
    const exerciseProgression: Record<string, Array<{ date: string; maxWeightKg: number; sets: number; reps: string }>> = {};
    for (const log of parsedLogs) {
      for (const ex of log.exercises) {
        if (ex.weightKg == null) continue;
        const key = ex.name.toLowerCase().trim();
        if (!exerciseProgression[key]) exerciseProgression[key] = [];
        const existing = exerciseProgression[key].find(e => e.date === log.date);
        if (existing) {
          existing.maxWeightKg = Math.max(existing.maxWeightKg, ex.weightKg);
        } else {
          exerciseProgression[key].push({ date: log.date, maxWeightKg: ex.weightKg, sets: ex.sets, reps: ex.reps });
        }
      }
    }

    // Only include exercises with at least 2 data points
    const progressionData = Object.entries(exerciseProgression)
      .filter(([, data]) => data.length >= 2)
      .map(([name, data]) => ({
        name: name.replace(/\b\w/g, c => c.toUpperCase()),
        data: data.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .slice(0, 8); // Top 8 exercises

    // Total workout volume per week (for bar chart)
    const weeklyVolume: Record<string, { totalSets: number; totalExercises: number }> = {};
    for (const log of parsedLogs) {
      const weekStart = new Date(log.date + 'T00:00:00');
      const dow = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - dow);
      const weekKey = weekStart.toISOString().split('T')[0];
      if (!weeklyVolume[weekKey]) weeklyVolume[weekKey] = { totalSets: 0, totalExercises: 0 };
      for (const ex of log.exercises) {
        weeklyVolume[weekKey].totalSets += ex.sets || 0;
        weeklyVolume[weekKey].totalExercises++;
      }
    }
    const weeklyVolumeData = Object.entries(weeklyVolume)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, v]) => ({ week, ...v }));

    res.json({
      latestIndices: latestWithSignals?.indices || null,
      efficiencyTrend,
      topLimiters,
      sessionHistory: sessionHistory.slice(0, 10),
      progressionData,
      weeklyVolumeData,
      weightLogs: weightLogs.map(w => ({ date: w.date, weightLbs: w.weightLbs })),
      totalSessions: sessions.length,
      totalWorkouts: workoutLogs.length,
    });
  } catch (err) {
    console.error('Strength profile error:', err);
    res.status(500).json({ error: 'Failed to load strength profile' });
  }
});

// ─── GET /api/coach/welcome ────────────────────────────────────────────────────
// Returns a personalised welcome message from Anakin. Generated once on first
// call, stored in coachProfile JSON, never regenerated unless dismissed+reset.

// Fallback used when LLM generation fails or returns empty — keeps the home
// card populated instead of showing nothing. Personalized lightly with whatever
// data we have so it doesn't read like canned filler.
function fallbackWelcomeMessage(opts: {
  firstName: string;
  phaseName: string | null;
  currentWeek: number | null;
  currentStreak: number;
}): string {
  if (opts.phaseName && opts.currentWeek) {
    return `You're in week ${opts.currentWeek} of the ${opts.phaseName} phase — the work compounds from here, ${opts.firstName}.`;
  }
  if (opts.currentStreak >= 3) {
    return `${opts.currentStreak} days in a row, ${opts.firstName}. Don't break the chain — one session today keeps the streak alive.`;
  }
  return `Welcome back, ${opts.firstName}. Log a workout today to keep the momentum going.`;
}

router.get('/coach/welcome', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const sevenDaysAgoStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [user, recentWorkouts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          sessions: { orderBy: { createdAt: 'desc' }, take: 1,
            include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        },
      }),
      prisma.workoutLog.findMany({
        where: { userId, date: { gte: sevenDaysAgoStr } },
        select: { id: true },
      }),
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const profile = user.coachProfile ? JSON.parse(user.coachProfile) : {};

    // Dismiss is a "not right now" signal, not "never show me this again" —
    // resurface a fresh note 24h after the user tapped X. Matches how Twitter,
    // IG, and iOS suggestion cards behave. Without this, one accidental X tap
    // hides Anakin's note forever.
    const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
    const dismissedAt = profile.welcomeDismissedAt
      ? new Date(profile.welcomeDismissedAt).getTime()
      : null;
    const dismissActive =
      profile.welcomeDismissed === true &&
      dismissedAt !== null &&
      Date.now() - dismissedAt < DISMISS_TTL_MS;

    if (dismissActive) {
      return res.json({ message: null, dismissed: true });
    }

    const cachedDate = profile.welcomeMessageDate ? new Date(profile.welcomeMessageDate) : null;
    const cacheAgeHours = cachedDate ? (now.getTime() - cachedDate.getTime()) / 3600000 : Infinity;

    if (profile.welcomeMessage && cacheAgeHours < 6) {
      return res.json({ message: profile.welcomeMessage, dismissed: false });
    }

    const latestPlan = user.sessions[0]?.plans[0]
      ? JSON.parse(user.sessions[0].plans[0].planJson) : null;
    const primaryLimiter = latestPlan?.diagnosis?.[0]?.limiterName ?? null;
    const selectedLift = user.sessions[0]?.selectedLift ?? null;

    let phaseName: string | null = null;
    let currentWeek: number | null = null;
    if (user.savedProgram) {
      const prog = parseSavedProgram(user.savedProgram);
      const state = computePhaseState(prog, user.programStartDate, now);
      phaseName = state.phaseName;
      currentWeek = state.weekNumber;
    }

    const firstName = user.name?.split(' ')[0] || user.username || 'Athlete';
    const fallback = fallbackWelcomeMessage({
      firstName,
      phaseName,
      currentWeek,
      currentStreak: user.currentStreak ?? 0,
    });

    let message = '';
    try {
      message = await generateWelcomeMessage({
        name: user.name,
        coachGoal: user.coachGoal,
        trainingAge: user.trainingAge,
        primaryLimiter,
        selectedLift,
        phaseName,
        currentStreak: user.currentStreak,
        recentWorkoutCount: recentWorkouts.length,
        currentWeek,
      });
    } catch (genErr) {
      console.error('Welcome message: LLM generation failed, using fallback:', genErr);
    }

    // Reject empty/whitespace results from the LLM — they'd hide the card on
    // the client. Anything under 8 chars is almost certainly a bad response.
    if (!message || message.trim().length < 8) {
      console.warn(`Welcome message empty for user ${userId}, using fallback`);
      message = fallback;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { coachProfile: JSON.stringify({ ...profile, welcomeMessage: message, welcomeMessageDate: now.toISOString() }) },
    });

    res.json({ message, dismissed: false });
  } catch (err) {
    console.error('Welcome message error:', err);
    // Never let this break the home page — return a fallback so the UI has
    // something to render rather than a hidden card.
    res.json({
      message: 'Welcome back. Log a workout today to keep the momentum going.',
      dismissed: false,
    });
  }
});

// POST /api/coach/welcome/dismiss — user taps X. Hides the note for 24h
// (the GET endpoint resurfaces it after that). Stamping welcomeDismissedAt
// is what gates the TTL on the GET side.
router.post('/coach/welcome/dismiss', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const profile = user.coachProfile ? JSON.parse(user.coachProfile) : {};
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        coachProfile: JSON.stringify({
          ...profile,
          welcomeDismissed: true,
          welcomeDismissedAt: new Date().toISOString(),
        }),
      },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Dismiss welcome error:', err);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

export default router;
