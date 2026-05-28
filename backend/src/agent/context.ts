// UserContext assembler — builds the "what's probably relevant" snapshot the
// agent sees at the start of each turn. This is working memory; tools are the
// "go fetch specifics" layer. Token-budgeted on purpose: compact summaries,
// not full history. The agent pulls detail via tools when it needs it.

import { PrismaClient } from '@prisma/client';
import { readMemory } from './memory.js';
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
  const [user, meals, bwLogs, wellness, memory] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true, tier: true, heightCm: true, weightKg: true,
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
      select: { date: true, weightLbs: true },
    }),
    prisma.wellnessCheckin.findFirst({
      where: { userId },
      orderBy: { date: 'desc' },
    }),
    readMemory(userId),
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

  // Body-weight summary: latest, 7-day avg, rough weekly trend.
  let bodyWeight: UserContext['bodyWeight'] = null;
  if (bwLogs.length) {
    const latestLbs = bwLogs[bwLogs.length - 1].weightLbs;
    const last7 = bwLogs.slice(-7).map((l) => l.weightLbs);
    const sevenDayAvgLbs = last7.length ? avg(last7) : null;
    let trendLbsPerWeek: number | null = null;
    if (bwLogs.length >= 2) {
      const n = bwLogs.length;
      const ys = bwLogs.map((l) => l.weightLbs);
      const xs = bwLogs.map((_, i) => i);
      const mx = avg(xs), my = avg(ys);
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
      trendLbsPerWeek = den === 0 ? 0 : (num / den) * 7;
    }
    bodyWeight = { latestLbs, sevenDayAvgLbs, trendLbsPerWeek };
  }

  return {
    userId,
    profile: {
      name: user.name,
      tier: user.tier,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
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
  if (p.weightKg) profileBits.push(`weight: ${p.weightKg}kg`);
  if (p.constraints) profileBits.push(`constraints: ${p.constraints}`);
  lines.push(`Profile — ${profileBits.join(', ')}`);

  if (ctx.todayNutrition) {
    const n = ctx.todayNutrition;
    lines.push(`Today's intake so far — ${Math.round(n.calories)} kcal, ${Math.round(n.proteinG)}g P / ${Math.round(n.carbsG)}g C / ${Math.round(n.fatG)}g F across ${n.mealCount} meal(s).`);
  } else {
    lines.push("Today's intake — nothing logged yet.");
  }

  if (ctx.bodyWeight && ctx.bodyWeight.latestLbs != null) {
    const b = ctx.bodyWeight;
    const trend = b.trendLbsPerWeek != null ? `${b.trendLbsPerWeek > 0 ? '+' : ''}${b.trendLbsPerWeek.toFixed(2)} lb/wk` : 'n/a';
    lines.push(`Body weight — latest ${b.latestLbs?.toFixed(1)} lb, 7d avg ${b.sevenDayAvgLbs?.toFixed(1) ?? 'n/a'} lb, trend ${trend}.`);
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
