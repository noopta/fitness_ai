// GET /api/training/overview — the Training tab (RN spec "Focus bands",
// 3 Oct 2026): goal, program, this week and archive in one call. Loading
// lives here; the shaping is buildTrainingOverview (unit-tested).

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { normalizePreference } from '../services/weightUnits.js';
import { computePhaseState } from '../services/programPhaseService.js';
import { parseJsonObjectColumn } from '../services/jsonColumn.js';
import { buildTrainingOverview } from '../services/trainingOverview.js';
import { buildScheduleData, fetchOverridesMap, getESTDateString, addDaysStr } from './coach.js';
import { getStrengthProfileCached, toWeekKey } from './strength.js';

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
      program ? getStrengthProfileCached(userId).catch(() => null) : Promise.resolve(null),
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

    res.json(buildTrainingOverview({
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
    }));
  } catch (err) {
    console.error('Training overview error:', err);
    res.status(500).json({ error: 'Failed to load training' });
  }
});

export default router;
