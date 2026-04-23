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
  generateAnakinDailyInsights, type AnakinInsight,
} from '../services/llmService.js';
import { buildRAGContext } from '../services/ragService.js';

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
    const { goal: requestedGoal, daysPerWeek, durationWeeks, gender } = programSchema.parse(req.body);

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
    const bodyCompositionGoal = extractBodyCompositionGoal(coachProfileObj?.primaryGoal);

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
        ...(isNewProgram ? { programStartDate: new Date() } : {}),
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
    const startDate = user.programStartDate || new Date();

    // Calculate which week we're on (1-indexed).
    // Use EST calendar dates so the day doesn't flip before midnight EST.
    const todayMidnight = estMidnight();
    const startMidnight = estMidnight(new Date(startDate));
    const daysSinceStart = Math.floor((todayMidnight.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24));
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
        const tipsPromise = generateTodayCoachingTips({
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
        }).catch(() => null);
        const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 8000));
        tips = await Promise.race([tipsPromise, timeoutPromise]);
      } catch (e) {
        console.error('Tips generation failed:', e);
      }
    }

    const todayResult = {
      todaySession: isRestDay ? null : todaySession,
      isRestDay,
      weekNumber,
      phaseNumber,
      phaseName: currentPhase.phaseName,
      tips,
      nextTrainingDay,
      programGoal: program.goal,
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
      const _todayMid = estMidnight();
      const _startMid = estMidnight(new Date(startDate));
      const daysSinceStart = Math.floor((_todayMid.getTime() - _startMid.getTime()) / (1000 * 60 * 60 * 24));
      const wk = Math.min(Math.floor(daysSinceStart / 7) + 1, program.durationWeeks || 12);
      weekNumber = wk;

      let cumulativeWeeks = 0;
      let currentPhase = program.phases?.[0] || null;
      if (program.phases) {
        for (let i = 0; i < program.phases.length; i++) {
          cumulativeWeeks += program.phases[i].durationWeeks;
          if (wk <= cumulativeWeeks) { currentPhase = program.phases[i]; break; }
          currentPhase = program.phases[i];
        }
      }
      phaseName = currentPhase?.phaseName || null;

      const trainingDays = currentPhase?.trainingDays || [];
      const totalDays = trainingDays.length;
      const dayInWeek = daysSinceStart % 7;
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

// GET /api/coach/schedule - Get the current week's schedule (Mon–Sun)
// Shared helper — computes schedule data for a user with a saved program.
function buildScheduleData(user: { savedProgram: string | null; programStartDate: Date | null }) {
  if (!user.savedProgram) return { weekDays: [], weekNumber: null, phaseName: null };

  const program = JSON.parse(user.savedProgram);
  const startDate = user.programStartDate || new Date();

  const todayMidnight = estMidnight();
  const startMidnight = estMidnight(new Date(startDate));
  const daysSinceStart = Math.floor((todayMidnight.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24));
  const weekNumber = Math.min(Math.floor(daysSinceStart / 7) + 1, program.durationWeeks || 12);

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
    const session = dayInWeek < totalDays ? trainingDays[dayInWeek] : null;
    const dateEST = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    weekDays.push({
      date: dateEST,
      dayLabel: DAY_LABELS[i],
      dateNumber: parseInt(dateEST.split('-')[2]),
      monthLabel: date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short' }),
      isToday: dateEST === getESTDateString(),
      isTrainingDay: !!session,
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

    const result = buildScheduleData(user);

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

    // Build schedule
    const schedule = buildScheduleData(user);

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
    const cachedDate = profile.welcomeMessageDate ? new Date(profile.welcomeMessageDate) : null;
    const cacheAgeHours = cachedDate ? (now.getTime() - cachedDate.getTime()) / 3600000 : Infinity;

    if (profile.welcomeMessage && cacheAgeHours < 6) {
      return res.json({ message: profile.welcomeMessage });
    }

    const latestPlan = user.sessions[0]?.plans[0]
      ? JSON.parse(user.sessions[0].plans[0].planJson) : null;
    const primaryLimiter = latestPlan?.diagnosis?.[0]?.limiterName ?? null;
    const selectedLift = user.sessions[0]?.selectedLift ?? null;

    let phaseName: string | null = null;
    let currentWeek: number | null = null;
    if (user.savedProgram) {
      try {
        const prog = JSON.parse(user.savedProgram);
        phaseName = prog.phases?.[0]?.phaseName ?? null;
        if (user.programStartDate) {
          currentWeek = Math.floor((now.getTime() - new Date(user.programStartDate).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
        }
      } catch { /* ignore */ }
    }

    const message = await generateWelcomeMessage({
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

    await prisma.user.update({
      where: { id: userId },
      data: { coachProfile: JSON.stringify({ ...profile, welcomeMessage: message, welcomeMessageDate: now.toISOString() }) },
    });

    res.json({ message });
  } catch (err) {
    console.error('Welcome message error:', err);
    res.status(500).json({ error: 'Failed to generate welcome message' });
  }
});

// POST /api/coach/welcome/dismiss — user taps X, never show again
router.post('/coach/welcome/dismiss', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const profile = user.coachProfile ? JSON.parse(user.coachProfile) : {};
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { coachProfile: JSON.stringify({ ...profile, welcomeDismissed: true }) },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Dismiss welcome error:', err);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

// ─── GET /api/coach/anakin-insights ──────────────────────────────────────────
// Daily home-page insights. Requires ≥3 workout logs with weight data.
// Cached once per calendar day in coachProfile JSON.

const MIN_WORKOUT_LOGS = 3;

router.get('/coach/anakin-insights', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const todayKey = new Date().toISOString().split('T')[0];

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check cached insights for today
    const profile = user.coachProfile ? (() => { try { return JSON.parse(user.coachProfile!); } catch { return {}; } })() : {};
    if (profile.anakinInsightsDate === todayKey && Array.isArray(profile.anakinInsights) && profile.anakinInsights.length > 0) {
      return res.json({ insights: profile.anakinInsights as AnakinInsight[], hasEnoughData: true, generatedAt: todayKey });
    }

    // Fetch workout logs with weight data
    const allLogs = await prisma.workoutLog.findMany({ where: { userId }, orderBy: { date: 'desc' } });
    const weightedLogs = allLogs.filter(log => {
      try {
        const exs = JSON.parse(log.exercises);
        return Array.isArray(exs) && exs.some((e: any) => e.weightKg && e.weightKg > 0);
      } catch { return false; }
    });

    if (weightedLogs.length < MIN_WORKOUT_LOGS) {
      return res.json({ insights: [], hasEnoughData: false, generatedAt: null });
    }

    // Pull strength profile from cache (built by /strength/profile route)
    const { cacheGet: strengthCacheGet } = await import('../services/cacheService.js');
    const cached = strengthCacheGet<any>(`strength:profile:${userId}`);
    const strengthData = cached ?? { lifts: [], radarScores: {}, overallStrengthIndex: null, strengthTier: 'Beginner' };

    // Recent nutrition summary (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenKey = sevenDaysAgo.toISOString().split('T')[0];
    const nutritionLogs = await prisma.nutritionLog.findMany({
      where: { userId, date: { gte: sevenKey } },
    });
    const recentNutrition = nutritionLogs.length >= 3 ? {
      avgCalories: nutritionLogs.reduce((s, l) => s + l.calories, 0) / nutritionLogs.length,
      avgProteinG: nutritionLogs.reduce((s, l) => s + l.proteinG, 0) / nutritionLogs.length,
      logDays: nutritionLogs.length,
    } : null;

    const bodyweightKg = user.weightKg ?? 80;

    const insights = await generateAnakinDailyInsights({
      bodyweightKg,
      lifts: (strengthData.lifts ?? []).slice(0, 6).map((l: any) => ({
        name: l.canonicalName,
        current1RMkg: l.current1RMkg,
        monthlyGainPct: l.monthlyGainPct,
        sessionCount: l.sessionCount,
        category: l.category,
      })),
      radarScores: strengthData.radarScores ?? {},
      overallStrengthIndex: strengthData.overallStrengthIndex ?? null,
      strengthTier: strengthData.strengthTier ?? 'Beginner',
      totalWorkoutLogs: weightedLogs.length,
      recentNutrition,
    });

    // Persist to coachProfile for daily caching
    await prisma.user.update({
      where: { id: userId },
      data: { coachProfile: JSON.stringify({ ...profile, anakinInsights: insights, anakinInsightsDate: todayKey }) },
    });

    res.json({ insights, hasEnoughData: true, generatedAt: todayKey });
  } catch (err) {
    console.error('[anakin-insights] error:', err);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

export default router;
