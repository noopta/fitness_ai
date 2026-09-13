// UserContext assembler — builds the "what's probably relevant" snapshot the
// agent sees at the start of each turn. This is working memory; tools are the
// "go fetch specifics" layer. Token-budgeted on purpose: compact summaries,
// not full history. The agent pulls detail via tools when it needs it.

import { PrismaClient } from '@prisma/client';
import { readMemory } from './memory.js';
import { bodyWeightKg, displayWeight, normalizePreference, unitLabel } from '../services/weightUnits.js';
import type { UserContext } from './types.js';

const prisma = new PrismaClient();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

export async function assembleContext(userId: string): Promise<UserContext> {
  const date = todayStr();

  // Run the independent reads in parallel — they don't depend on each other.
  const [user, meals, bwLogs, wellness, memory, pendingAdaptation] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true, tier: true, heightCm: true, weightKg: true,
        unitPreference: true,
        trainingAge: true, equipment: true, constraintsText: true,
        coachGoal: true, coachBudget: true,
      },
    }),
    prisma.mealEntry.findMany({
      where: { userId, date },
      select: { calories: true, proteinG: true, carbsG: true, fatG: true },
    }),
    prisma.bodyWeightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { date: true, weightKg: true, weightLbs: true },
    }),
    prisma.wellnessCheckin.findFirst({
      where: { userId },
      orderBy: { date: 'desc' },
    }),
    readMemory(userId),
    // Promise.resolve wrapper: tolerate test mocks / old clients where the
    // adaptationProposal model doesn't exist (sync throw, not a rejection).
    Promise.resolve()
      .then(() => prisma.adaptationProposal.findMany({ where: { userId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 3, select: { title: true } }))
      .catch(() => [] as Array<{ title: string }>),
  ]);

  if (!user) throw new Error('User not found');

  // Today's nutrition rollup.
  const todayNutrition = meals.length
    ? {
        date,
        calories: meals.reduce((s, m) => s + m.calories, 0),
        proteinG: meals.reduce((s, m) => s + m.proteinG, 0),
        carbsG: meals.reduce((s, m) => s + m.carbsG, 0),
        fatG: meals.reduce((s, m) => s + m.fatG, 0),
        mealCount: meals.length,
      }
    : null;

  // Body-weight summary in canonical kg: latest, 7-day avg, rough weekly trend.
  // Rows may still carry legacy pounds until the backfill runs, so normalise.
  let bodyWeight: UserContext['bodyWeight'] = null;
  const bwKg = bwLogs.map((l) => bodyWeightKg(l)).filter((v): v is number => v != null);
  if (bwKg.length) {
    const latestKg = bwKg[bwKg.length - 1];
    const last7 = bwKg.slice(-7);
    const sevenDayAvgKg = last7.length ? avg(last7) : null;
    let trendKgPerWeek: number | null = null;
    if (bwKg.length >= 2) {
      const n = bwKg.length;
      const ys = bwKg;
      const xs = bwKg.map((_, i) => i);
      const mx = avg(xs), my = avg(ys);
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
      trendKgPerWeek = den === 0 ? 0 : (num / den) * 7;
    }
    bodyWeight = { latestKg, sevenDayAvgKg, trendKgPerWeek };
  }

  return {
    userId,
    profile: {
      name: user.name,
      tier: user.tier,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      unitPreference: normalizePreference(user.unitPreference),
      trainingAge: user.trainingAge,
      equipment: user.equipment,
      constraints: user.constraintsText,
      goal: user.coachGoal,
      budget: user.coachBudget,
    },
    todayNutrition,
    bodyWeight,
    lastWellness: wellness
      ? {
          date: wellness.date,
          mood: wellness.mood,
          energy: wellness.energy,
          sleepHours: wellness.sleepHours,
          stress: wellness.stress,
        }
      : null,
    memory,
    adaptation: { pendingCount: pendingAdaptation.length, latestTitle: pendingAdaptation[0]?.title ?? null },
  };
}

/**
 * Render the context as a compact system-prompt fragment. Kept terse — every
 * token here is paid on every turn. Nulls are omitted so the model isn't fed
 * a wall of "unknown".
 */
export function renderContext(ctx: UserContext): string {
  const p = ctx.profile;
  const lines: string[] = ['## What you know about this user'];

  const profileBits: string[] = [];
  if (p.name) profileBits.push(`name: ${p.name}`);
  profileBits.push(`tier: ${p.tier}`);
  if (p.trainingAge) profileBits.push(`training age: ${p.trainingAge}`);
  if (p.equipment) profileBits.push(`equipment: ${p.equipment}`);
  if (p.goal) profileBits.push(`goal: ${p.goal}`);
  if (p.budget) profileBits.push(`budget: ${p.budget}`);
  if (p.heightCm) profileBits.push(`height: ${p.heightCm}cm`);
  if (p.weightKg) profileBits.push(`weight: ${displayWeight(p.weightKg, p.unitPreference, 1)} ${unitLabel(p.unitPreference)}`);
  if (p.constraints) profileBits.push(`constraints: ${p.constraints}`);
  lines.push(`Profile — ${profileBits.join(', ')}`);

  if (ctx.adaptation && ctx.adaptation.pendingCount > 0) {
    lines.push(`Adaptive progression — ${ctx.adaptation.pendingCount} proposal(s) PENDING the user's decision${ctx.adaptation.latestTitle ? ` (latest: "${ctx.adaptation.latestTitle}")` : ''}. If the user mentions targets, suggestions, or "the card", call read_adaptation for the details before answering.`);
  }

  if (ctx.todayNutrition) {
    const n = ctx.todayNutrition;
    lines.push(`Today's intake so far — ${Math.round(n.calories)} kcal, ${Math.round(n.proteinG)}g P / ${Math.round(n.carbsG)}g C / ${Math.round(n.fatG)}g F across ${n.mealCount} meal(s).`);
  } else {
    lines.push("Today's intake — nothing logged yet.");
  }

  const b = ctx.bodyWeight;
  if (b && b.latestKg != null) {
    const u = ctx.profile.unitPreference;
    const lbl = unitLabel(u);
    const latest = displayWeight(b.latestKg, u, 1);
    const avg7 = b.sevenDayAvgKg != null ? `${displayWeight(b.sevenDayAvgKg, u, 1)} ${lbl}` : 'n/a';
    const trend = b.trendKgPerWeek != null
      ? `${b.trendKgPerWeek > 0 ? '+' : ''}${displayWeight(b.trendKgPerWeek, u, 2)} ${lbl}/wk`
      : 'n/a';
    lines.push(`Body weight — latest ${latest} ${lbl}, 7d avg ${avg7}, trend ${trend}.`);
  }

  if (ctx.lastWellness) {
    const w = ctx.lastWellness;
    lines.push(`Last wellness check-in (${w.date}) — mood ${w.mood}/5, energy ${w.energy}/5, sleep ${w.sleepHours}h, stress ${w.stress}/5.`);
  }

  if (ctx.memory.length) {
    lines.push('Long-term memory (things you\'ve learned about them):');
    ctx.memory.forEach((m) => lines.push(`  - ${m}`));
  }

  return lines.join('\n');
}
