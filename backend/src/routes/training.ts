// GET /api/training/overview — the Training tab (RN spec "Focus bands",
// 3 Oct 2026): goal, program, this week and archive in one call. Loading
// lives here; the shaping is buildTrainingOverview (unit-tested).

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { normalizePreference } from '../services/weightUnits.js';
import { computePhaseState } from '../services/programPhaseService.js';
import { parseJsonObjectColumn } from '../services/jsonColumn.js';
import { buildTrainingOverview, programFinished } from '../services/trainingOverview.js';
import { computeProgramStats } from '../services/completedProgramService.js';
import { buildScheduleData, fetchOverridesMap, getESTDateString, addDaysStr } from './coach.js';
import { getStrengthProfileCached, toWeekKey } from './strength.js';
import { z } from 'zod';
import { freestyleAvailableFor, phaseInferenceAvailableFor } from '../services/featureFlags.js';
import { inferPhase, inferPhaseDetailed, setConfirmedPhase } from '../services/phaseInference.js';
import { loadFreestyleHome } from '../adaptation/freestyleHome.js';
import { TRAINING_PHASES } from '../adaptation/types.js';

const router = Router();
const prisma = new PrismaClient();

router.get('/training/overview', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { savedProgram: true, programStartDate: true, unitPreference: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const program = parseJsonObjectColumn<any>(user.savedProgram);
    const phase = computePhaseState(program, user.programStartDate);
    const freestyleOn = freestyleAvailableFor(userId, req.user!.email);

    // Mon–Sun, with overrides and logged days, same rules as /coach/schedule.
    const today = getESTDateString();
    const overrides = program ? await fetchOverridesMap(userId, addDaysStr(today, -7), addDaysStr(today, 7)) : new Map();
    const schedule = buildScheduleData(user, overrides, { weekStart: 'mon' });
    const weekDays: any[] = schedule.weekDays;
    if (weekDays.length) {
      const logs = await prisma.workoutLog.findMany({
        where: { userId, date: { gte: weekDays[0].date.slice(0, 10), lte: weekDays[6].date.slice(0, 10) } },
        select: { date: true },
      });
      const logged = new Set(logs.map((l) => l.date.slice(0, 10)));
      for (const d of weekDays) d.isLogged = logged.has(d.date.slice(0, 10));
    }

    const [strength, completed, formAnalyses, sessions] = await Promise.all([
      // Freestyle users (no program) still get their strength profile.
      program || freestyleOn ? getStrengthProfileCached(userId).catch(() => null) : Promise.resolve(null),
      prisma.completedProgram.findMany({
        where: { userId }, orderBy: { endDate: 'desc' }, take: 30,
        select: { id: true, goal: true, startDate: true, endDate: true, durationWeeks: true, reason: true },
      }),
      prisma.formAnalysis.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: 30,
        select: { id: true, exercise: true, status: true, formScore: true, createdAt: true },
      }),
      prisma.session.findMany({
        where: { userId }, orderBy: { updatedAt: 'desc' }, take: 30,
        select: { id: true, selectedLift: true, flow: true, updatedAt: true, plans: { take: 1, select: { id: true } } },
      }),
    ]);

    const overview = buildTrainingOverview({
      program,
      weekNumber: phase.weekNumber,
      phaseIndex: phase.phaseIndex,
      totalWeeks: phase.totalWeeks,
      startWeekKey: user.programStartDate ? toWeekKey(user.programStartDate.toISOString().slice(0, 10)) : null,
      weekDays,
      lifts: (strength?.lifts ?? []) as any[],
      unitPref: normalizePreference(user.unitPreference),
      completed,
      formAnalyses,
      liftDiagnostics: sessions.map((s) => ({
        id: s.id,
        lift: s.selectedLift,
        flow: s.flow === 'conversation' ? 'conversation' as const : 'wizard' as const,
        status: s.plans.length ? 'complete' : 'in_progress',
        updatedAt: s.updatedAt,
      })),
    });
    // The goal band is program-shaped; without a program (freestyle flag on)
    // the strength profile still ships as `strength` so the tab isn't empty.
    if (!program && freestyleOn) {
      const lifts = ((strength?.lifts ?? []) as any[])
        .filter((l) => (l?.current1RMkg ?? 0) > 0)
        .sort((a, b) => (b.sessionCount ?? 0) - (a.sessionCount ?? 0))
        .slice(0, 6)
        .map((l) => ({ name: l.canonicalName, current1RMkg: l.current1RMkg, sessionCount: l.sessionCount ?? null, weekSeries: l.weekSeries ?? [] }));
      return res.json({ ...overview, strength: { lifts } });
    }
    // Program finished (T-09): the tab shows the result until the user picks what's next.
    let finished: any = null;
    if (program && overview.program && programFinished({ isComplete: phase.isComplete, weekNumber: phase.weekNumber, totalWeeks: phase.totalWeeks, days: overview.week.days })) {
      const start = user.programStartDate ?? new Date();
      const stats = await computeProgramStats(userId, start, new Date(), program).catch(() => null);
      const planned = (Number(program.daysPerWeek) || overview.week.planned || 0) * phase.totalWeeks;
      finished = { weeks: phase.totalWeeks, goal: program.goal ?? null, sessionsLogged: stats?.workoutsLogged ?? null, sessionsPlanned: planned || null, bodyWeightChangeLb: stats?.bodyWeightChangeLb ?? null };
    }
    res.json({ ...overview, finished });
  } catch (err) {
    console.error('Training overview error:', err);
    res.status(500).json({ error: 'Failed to load training' });
  }
});

// GET /api/training/freestyle — the freestyle home (contract 3). Always
// answers (enabled reflects the flag); `phase` only when phase inference is on.
router.get('/training/freestyle', requireAuth, async (req, res) => {
  try {
    const { id, email } = req.user!;
    const phaseOn = phaseInferenceAvailableFor(id, email);
    const home = await loadFreestyleHome(id, {
      enabled: freestyleAvailableFor(id, email),
      phase: async (exposuresByKey, workoutDates) => {
        if (!phaseOn) return null;
        const { signals: _s, ...r } = await inferPhaseDetailed(id, new Date(), { exposuresByKey, workoutDates, useCache: true });
        return r;
      },
    });
    res.json(home);
  } catch (err) {
    console.error('Freestyle home error:', err);
    res.status(500).json({ error: 'Failed to load freestyle home' });
  }
});

// GET /api/training/phase — contract 6. Flag off → 200 { enabled: false }
// (same shape the /adaptation routes use), never a 404 the client must special-case.
router.get('/training/phase', requireAuth, async (req, res) => {
  try {
    const { id, email } = req.user!;
    if (!phaseInferenceAvailableFor(id, email)) return res.json({ enabled: false });
    res.json({ enabled: true, ...(await inferPhase(id)) });
  } catch (err) {
    console.error('Training phase error:', err);
    res.status(500).json({ error: 'Failed to load training phase' });
  }
});

// POST /api/training/phase { phase: TrainingPhase | 'auto' } — set (user_set)
// or clear the confirmed phase. Flag off → 403 { enabled: false }.
const phaseBody = z.object({ phase: z.enum(['auto', ...TRAINING_PHASES] as [string, ...string[]]) });
router.post('/training/phase', requireAuth, async (req, res) => {
  const { id, email } = req.user!;
  if (!phaseInferenceAvailableFor(id, email)) return res.status(403).json({ enabled: false, error: 'Not available' });
  const parsed = phaseBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid phase', details: parsed.error.issues });
  try {
    await setConfirmedPhase(id, parsed.data.phase as any, 'user_set');
    res.json({ enabled: true, ...(await inferPhase(id)) });
  } catch (err) {
    console.error('Set training phase error:', err);
    res.status(500).json({ error: 'Failed to set training phase' });
  }
});

export default router;
