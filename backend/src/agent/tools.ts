// Tool registry — wraps existing backend capabilities as callable tools the
// agent's reasoning loop can invoke. Each tool reads/writes real state via
// Prisma or delegates to an existing service function.
//
// Design rule (mirrors how Claude Code calls git instead of reimplementing
// it): tools delegate to the real implementation. The deterministic
// diagnostic engine, the meal parser, etc. stay authoritative — the agent
// CALLS them, it does not reason in their place.

import { PrismaClient } from '@prisma/client';
import { parseMealMacros } from '../services/llmService.js';
import { appendMemory } from './memory.js';
import type { AgentTool } from './types.js';

const prisma = new PrismaClient();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Read tools ───────────────────────────────────────────────────────────────

const readProfile: AgentTool = {
  name: 'read_profile',
  description:
    "Read the user's training profile: name, tier, height/weight, training age, available equipment, injury constraints, and their coaching goal + budget. Call this when you need to tailor advice to who they are.",
  input_schema: { type: 'object', properties: {} },
  execute: async (_input, userId) => {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true, tier: true, heightCm: true, weightKg: true,
        trainingAge: true, equipment: true, constraintsText: true,
        coachGoal: true, coachBudget: true,
      },
    });
    if (!u) throw new Error('User not found');
    return u;
  },
};

const readNutritionToday: AgentTool = {
  name: 'read_nutrition_today',
  description:
    "Read everything the user has eaten today: each meal with its macros, plus the running totals. Call this before giving nutrition advice or computing what's left in their day.",
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'YYYY-MM-DD. Omit for today.',
      },
    },
  },
  execute: async (input, userId) => {
    const date = (input.date as string) || todayStr();
    const meals = await prisma.mealEntry.findMany({
      where: { userId, date },
      orderBy: { createdAt: 'asc' },
      select: { name: true, mealType: true, calories: true, proteinG: true, carbsG: true, fatG: true },
    });
    const totals = meals.reduce(
      (a, m) => ({
        calories: a.calories + m.calories,
        proteinG: a.proteinG + m.proteinG,
        carbsG: a.carbsG + m.carbsG,
        fatG: a.fatG + m.fatG,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
    return { date, meals, totals, mealCount: meals.length };
  },
};

const readBodyWeightTrend: AgentTool = {
  name: 'read_body_weight_trend',
  description:
    "Read the user's body-weight log over a window (default 30 days), with the most recent value and a simple linear trend in lb/week. Call this for weight-change or cut/bulk progress questions.",
  input_schema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Look-back window in days. Default 30.' },
    },
  },
  execute: async (input, userId) => {
    const days = Math.max(1, Math.min(365, Number(input.days) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);
    const logs = await prisma.bodyWeightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { date: true, weightLbs: true },
    });
    const windowed = logs.filter((l) => new Date(l.date) >= since);
    const latest = windowed.length ? windowed[windowed.length - 1].weightLbs : null;
    // Linear slope over index ≈ per-entry change; ×7 for a rough per-week.
    let trendPerWeek: number | null = null;
    if (windowed.length >= 2) {
      const n = windowed.length;
      const xs = windowed.map((_, i) => i);
      const ys = windowed.map((l) => l.weightLbs);
      const mx = xs.reduce((s, v) => s + v, 0) / n;
      const my = ys.reduce((s, v) => s + v, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
      trendPerWeek = den === 0 ? 0 : (num / den) * 7;
    }
    return { days, count: windowed.length, latestLbs: latest, trendLbsPerWeek: trendPerWeek, series: windowed };
  },
};

const readRecentWorkouts: AgentTool = {
  name: 'read_recent_workouts',
  description:
    "Read the user's recent logged workouts (default last 14 days): date, type, and estimated calorie burn. Call this to understand training load before advising on volume, recovery, or nutrition timing.",
  input_schema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Look-back window in days. Default 14.' },
    },
  },
  execute: async (input, userId) => {
    const days = Math.max(1, Math.min(90, Number(input.days) || 14));
    const since = new Date();
    since.setDate(since.getDate() - days);
    const workouts = await prisma.workoutLog.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { days, count: workouts.length, workouts };
  },
};

const readWellness: AgentTool = {
  name: 'read_wellness',
  description:
    "Read the user's recent wellness check-ins (mood, energy, sleep hours, stress). Call this when recovery, fatigue, or sleep could be affecting your advice — e.g. before pushing volume.",
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'How many recent check-ins. Default 7.' },
    },
  },
  execute: async (input, userId) => {
    const limit = Math.max(1, Math.min(30, Number(input.limit) || 7));
    const checkins = await prisma.wellnessCheckin.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: limit,
    });
    return { count: checkins.length, checkins };
  },
};

// ─── Write tools ───────────────────────────────────────────────────────────────

const logMeal: AgentTool = {
  name: 'log_meal',
  description:
    "Log a meal to the user's day. Provide a description in plain English (e.g. '2 eggs and oatmeal with berries') and the tool will parse macros automatically, OR pass explicit macro values to skip parsing. Always confirm what you logged back to the user.",
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: "Plain-English meal description. Used when explicit macros aren't given." },
      name: { type: 'string', description: 'Meal name. Optional if description is given.' },
      mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'meal'], description: 'Meal slot. Default "meal".' },
      calories: { type: 'number' },
      proteinG: { type: 'number' },
      carbsG: { type: 'number' },
      fatG: { type: 'number' },
      date: { type: 'string', description: 'YYYY-MM-DD. Omit for today.' },
    },
  },
  execute: async (input, userId) => {
    const date = (input.date as string) || todayStr();
    const mealType = (input.mealType as string) || 'meal';
    let { name, calories, proteinG, carbsG, fatG } = input as {
      name?: string; calories?: number; proteinG?: number; carbsG?: number; fatG?: number;
    };
    let source = 'agent-manual';
    // If macros weren't given but a description was, parse it via the same
    // service the Describe sheet uses — single source of truth for parsing.
    const hasMacros = [calories, proteinG, carbsG, fatG].some((v) => typeof v === 'number');
    if (!hasMacros && input.description) {
      const parsed = await parseMealMacros(String(input.description));
      name = name ?? parsed.name;
      calories = parsed.calories; proteinG = parsed.proteinG; carbsG = parsed.carbsG; fatG = parsed.fatG;
      source = 'agent-parsed';
    }
    const entry = await prisma.mealEntry.create({
      data: {
        userId, date, name: name || String(input.description ?? 'Meal'),
        mealType,
        calories: Number(calories) || 0, proteinG: Number(proteinG) || 0,
        carbsG: Number(carbsG) || 0, fatG: Number(fatG) || 0,
        source,
      },
      select: { id: true, name: true, mealType: true, calories: true, proteinG: true, carbsG: true, fatG: true, date: true },
    });
    return { logged: entry };
  },
};

const remember: AgentTool = {
  name: 'remember',
  description:
    "Save a durable fact about the user for future sessions — a goal, a strong preference, or a constraint (e.g. 'knee pain on back squats, prefers front squats', 'targeting a 405 deadlift by summer', 'vegetarian'). Use sparingly for things that will matter weeks from now, NOT for transient details. These notes are shown to you at the start of every future conversation.",
  input_schema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'The fact to remember, phrased concisely in the third person.' },
    },
    required: ['note'],
  },
  execute: async (input, userId) => {
    const notes = await appendMemory(userId, String(input.note ?? ''));
    return { saved: true, totalNotes: notes.length };
  },
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  readProfile,
  readNutritionToday,
  readBodyWeightTrend,
  readRecentWorkouts,
  readWellness,
  logMeal,
  remember,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t]),
);

// Anthropic-API-shaped tool definitions (name/description/input_schema only).
export const TOOL_DEFINITIONS = AGENT_TOOLS.map(({ name, description, input_schema }) => ({
  name, description, input_schema,
}));
