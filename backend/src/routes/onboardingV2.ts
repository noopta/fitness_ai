// v2 onboarding routes.
//   POST /coach/onboarding/gaps  { goal }            → ledger, sources, questions, prefilled, health, consent
//   POST /coach/onboarding/build { goal, answers, prefilled?, consent? } → phases, nutrition, program
//
// build() persists the intake exactly as the v1 form did (PUT /auth/profile
// fields + coachProfile JSON), then runs the existing generator by calling
// the same code path POST /coach/program uses, so a v2-built program is
// indistinguishable from a v1 one to every downstream feature.

import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { gapsForGoal, profileFromAnswers, phasesFromProgram, nutritionLine, goalKind } from '../services/onboardingV2.js';
import { cacheClearByPrefix } from '../services/cacheService.js';

const router = Router();
const prisma = new PrismaClient();

const gapsSchema = z.object({ goal: z.string().min(2).max(200) });
const buildSchema = z.object({
  goal: z.string().min(2).max(200),
  answers: z.record(z.string(), z.string().max(200)).default({}),
  prefilled: z.array(z.object({ key: z.string(), label: z.string(), value: z.string(), source: z.string(), field: z.string().optional() })).optional(),
  consent: z.record(z.string(), z.boolean()).optional(),
});

router.post('/coach/onboarding/gaps', requireAuth, async (req, res) => {
  try {
    const { goal } = gapsSchema.parse(req.body);
    const out = await gapsForGoal(req.user!.id, goal.trim());
    res.json(out);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[onboarding/gaps]', err?.message ?? err);
    res.status(500).json({ error: 'Failed to read the goal' });
  }
});

router.post('/coach/onboarding/build', requireAuth, async (req, res) => {
  try {
    const { goal, answers, prefilled, consent } = buildSchema.parse(req.body);
    const userId = req.user!.id;
    const { kind, daysPerWeek, durationWeeks, profileUpdate } = profileFromAnswers(goal.trim(), answers, prefilled ?? []);
    // A red-flag route to a clinician means no program yet: persist the intake, return paused.
    if (answers.redFlagRoute === 'clinician') {
      await prisma.user.update({ where: { id: userId }, data: { ...profileUpdate, coachOnboardingDone: false } });
      return res.json({ paused: true, reason: 'clinician' });
    }
    const consentJson = consent ? JSON.stringify(consent) : null;
    await prisma.user.update({ where: { id: userId }, data: { ...profileUpdate, ...(consentJson ? { coachProfile: JSON.stringify({ ...JSON.parse(profileUpdate.coachProfile), consent }) } : {}) } });
    cacheClearByPrefix(`today:${userId}:`);
    cacheClearByPrefix(`schedule:${userId}:`);
    cacheClearByPrefix(`brief:${userId}:`);

    // Generate through the existing program route's handler by an internal
    // request, so tier checks, RAG, reveal sources and caching all apply.
    const { generateProgramForUser } = await import('./coach.js');
    const gentle = answers.redFlagRoute === 'gentle';
    const result: any = await generateProgramForUser(userId, {
      goal: gentle ? `${goal} — gentle plan while a clinician clears the red flag` : goal,
      daysPerWeek: gentle ? Math.min(3, daysPerWeek) : daysPerWeek,
      durationWeeks,
      tier: req.user!.tier,
      save: true,
    });
    const program = result;
    res.json({
      paused: false,
      kind,
      phases: phasesFromProgram(program),
      nutrition: nutritionLine(program, kind),
      totalWeeks: phasesFromProgram(program).reduce((s, p) => s + p.weeks, 0) || durationWeeks,
      sources: result?.sources ?? [],
      program,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[onboarding/build]', err?.message ?? err);
    res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed to build the program' });
  }
});

export default router;
export { goalKind };
