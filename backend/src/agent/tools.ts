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
import { applyMacroChange, applyProgramUpdate, applyExerciseSwap } from './applyTools.js';
import { buildSwapProposal, getCurrentWeekSchedule, SwapProposalError } from '../routes/coach.js';
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

const logBodyWeight: AgentTool = {
  name: 'log_body_weight',
  description:
    "Log the user's body weight for a day (lbs). Use when they tell you their current weight. Confirm what you logged.",
  input_schema: {
    type: 'object',
    properties: {
      weightLbs: { type: 'number', description: 'Body weight in pounds.' },
      date: { type: 'string', description: 'YYYY-MM-DD. Omit for today.' },
    },
    required: ['weightLbs'],
  },
  execute: async (input, userId) => {
    const weightLbs = Number(input.weightLbs);
    if (!Number.isFinite(weightLbs) || weightLbs <= 0) throw new Error('weightLbs must be a positive number');
    const date = (input.date as string) || todayStr();
    const entry = await prisma.bodyWeightLog.create({
      data: { userId, date, weightLbs },
      select: { id: true, date: true, weightLbs: true },
    });
    return { logged: entry };
  },
};

const logWorkout: AgentTool = {
  name: 'log_workout',
  description:
    "Log a completed workout. Provide a title and a list of exercises (free-form text or a short list). Use when the user describes a session they did. Confirm what you logged.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short session title, e.g. "Push day".' },
      exercises: { type: 'string', description: 'Exercises performed — free text or a short list.' },
      durationMin: { type: 'number', description: 'Duration in minutes, if known.' },
      date: { type: 'string', description: 'YYYY-MM-DD. Omit for today.' },
    },
    required: ['exercises'],
  },
  execute: async (input, userId) => {
    const date = (input.date as string) || todayStr();
    const entry = await prisma.workoutLog.create({
      data: {
        userId, date,
        title: (input.title as string) || 'Workout',
        exercises: String(input.exercises ?? ''),
        duration: input.durationMin != null ? Number(input.durationMin) : null,
      },
      select: { id: true, date: true, title: true, duration: true },
    });
    return { logged: entry };
  },
};

const logWellness: AgentTool = {
  name: 'log_wellness',
  description:
    "Log a wellness check-in: mood, energy, stress (each 1-5) and sleep hours. Use when the user reports how they're feeling/sleeping. Confirm what you logged.",
  input_schema: {
    type: 'object',
    properties: {
      mood: { type: 'number', description: '1-5' },
      energy: { type: 'number', description: '1-5' },
      stress: { type: 'number', description: '1-5' },
      sleepHours: { type: 'number' },
      date: { type: 'string', description: 'YYYY-MM-DD. Omit for today.' },
    },
    required: ['mood', 'energy', 'stress', 'sleepHours'],
  },
  execute: async (input, userId) => {
    const clamp = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 0)));
    const date = (input.date as string) || todayStr();
    const entry = await prisma.wellnessCheckin.create({
      data: {
        userId, date,
        mood: clamp(input.mood), energy: clamp(input.energy), stress: clamp(input.stress),
        sleepHours: Math.max(0, Number(input.sleepHours) || 0),
      },
      select: { id: true, date: true, mood: true, energy: true, stress: true, sleepHours: true },
    });
    return { logged: entry };
  },
};

const readProgram: AgentTool = {
  name: 'read_program',
  description:
    "Read the user's current saved training program (the plan they're following — split, sessions, phase). Call this before adjusting their week, handling a missed session, or diagnosing a plateau, so your advice fits the plan they're actually on.",
  input_schema: { type: 'object', properties: {} },
  execute: async (_input, userId) => {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { savedProgram: true, programStartDate: true, coachGoal: true },
    });
    if (!u?.savedProgram) return { hasProgram: false };
    let program: unknown = u.savedProgram;
    try { program = JSON.parse(u.savedProgram); } catch { /* leave as string */ }
    // Cap stringified size so a huge plan doesn't blow the turn budget.
    const asText = typeof program === 'string' ? program : JSON.stringify(program);
    return {
      hasProgram: true,
      programStartDate: u.programStartDate,
      goal: u.coachGoal,
      program: asText.length > 6000 ? asText.slice(0, 6000) + '…(truncated)' : program,
    };
  },
};

const readLatestDiagnostic: AgentTool = {
  name: 'read_latest_diagnostic',
  description:
    "Read the user's most recent lift diagnostic — which lift, the goal, and the generated plan/analysis text. Call this when advising on programming, accessories, or what's limiting a lift. This reflects the deterministic diagnostic engine's output; don't re-derive it yourself.",
  input_schema: { type: 'object', properties: {} },
  execute: async (_input, userId) => {
    const session = await prisma.session.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!session) return { found: false };
    const plan = session.plans[0];
    return {
      found: true,
      lift: session.selectedLift,
      goal: session.goal,
      createdAt: session.createdAt,
      // planText can be long; cap so a giant plan doesn't blow the turn's budget.
      planText: plan?.planText ? String(plan.planText).slice(0, 4000) : null,
    };
  },
};

const queryResearch: AgentTool = {
  name: 'query_research',
  description:
    "Search the curated research/article feed (PubMed, NIH, top medical schools, Huberman Lab) for a topic and return a few relevant summaries with sources. Use to ground a claim in evidence or answer 'what does the research say about X'.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Topic or keywords, e.g. "creatine timing".' },
      limit: { type: 'number', description: 'Max results. Default 3.' },
    },
    required: ['query'],
  },
  execute: async (input, _userId) => {
    const q = String(input.query ?? '').trim();
    const limit = Math.max(1, Math.min(8, Number(input.limit) || 3));
    if (!q) return { results: [] };
    // Simple keyword match against title/summary/tags. The feed is small
    // enough that a contains-filter is fine; swap for FTS if it grows.
    const items = await prisma.feedItem.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { summary: { contains: q } },
          { tags: { contains: q.toLowerCase() } },
        ],
      },
      orderBy: { fetchedAt: 'desc' },
      take: limit,
      select: { title: true, summary: true, source: true, url: true },
    });
    return { query: q, count: items.length, results: items };
  },
};

const adjustMacros: AgentTool = {
  name: 'adjust_macros',
  description:
    "Apply new daily macro targets to the user's saved nutrition plan (the Nutrition tab will reflect them). Pass absolute target values for any of calories/proteinG/carbsG/fatG; omitted fields are left unchanged. ONLY call this after the user has agreed to a specific change you proposed — never apply silently. Keeps their goal intact and recomputes projected weight change.",
  input_schema: {
    type: 'object',
    properties: {
      calories: { type: 'number', description: 'New daily calorie target.' },
      proteinG: { type: 'number', description: 'New daily protein target (g).' },
      carbsG: { type: 'number', description: 'New daily carb target (g).' },
      fatG: { type: 'number', description: 'New daily fat target (g).' },
    },
  },
  execute: async (input, userId) => {
    const change = {
      calories: input.calories as number | undefined,
      proteinG: input.proteinG as number | undefined,
      carbsG: input.carbsG as number | undefined,
      fatG: input.fatG as number | undefined,
    };
    if (Object.values(change).every((v) => v == null)) {
      throw new Error('Provide at least one macro target to change.');
    }
    return applyMacroChange(userId, change);
  },
};

const applyProgramUpdateTool: AgentTool = {
  name: 'apply_program_update',
  description:
    "Persist a modification to the user's training program. First call read_program to get the current program, then construct the FULL updated program object preserving their goal, phase structure, and sensible progression — change only what the suggestion calls for (e.g. add accessories to a day, adjust sets/reps). ONLY call this after the user has confirmed the specific change. Refuses updates that drop the structure or change the goal.",
  input_schema: {
    type: 'object',
    properties: {
      updatedProgram: {
        type: 'object',
        description: 'The complete updated training program object (same shape as read_program returns), with the suggested change applied and the goal preserved.',
      },
      summary: { type: 'string', description: 'One-line summary of what changed, for the log/confirmation.' },
    },
    required: ['updatedProgram'],
  },
  execute: async (input, userId) => {
    const result = await applyProgramUpdate(userId, input.updatedProgram);
    return { ...result, summary: (input.summary as string) ?? undefined };
  },
};

// Non-persisting counterpart to apply_program_update. Used by the
// "Apply to my plan" flow when we want the user to see the diff and confirm
// before any change lands on their program. The loop pulls the proposal off
// the tool result (via the `_proposal: true` marker) and surfaces it on
// AgentTurnResult.proposal so the client can render a side-by-side diff.
const proposeProgramUpdateTool: AgentTool = {
  name: 'propose_program_update',
  description:
    "Propose a goal-preserving modification to the user's training program for them to REVIEW before it lands. This DOES NOT persist — the client will render a side-by-side diff and the user will tap Confirm before anything changes. Construct the FULL updated program object the same way you would for apply_program_update, but call THIS tool instead whenever the change comes from a tap-driven 'Apply' suggestion. Preferred change type, in order: (1) bump sets/reps on an existing exercise that already targets the weak area, (2) substitute one weaker-fit exercise for a stronger-fit one of equal volume, (3) add a single accessory at the end of a relevant training day. Touch as few days as possible. Keep goal, phase count, and phase durations identical.",
  input_schema: {
    type: 'object',
    properties: {
      updatedProgram: {
        type: 'object',
        description: 'The complete proposed training program object — same shape as read_program returns, with the minimal goal-preserving change applied.',
      },
      summary: { type: 'string', description: 'One-line plain-English summary of what changed (e.g. "Added 2 sets to RDL on Lower Day A; bumped GHR from 3×10 to 3×12").' },
      changedDays: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of training days affected, for highlighting in the diff UI.',
      },
    },
    required: ['updatedProgram', 'summary'],
  },
  execute: async (input) => {
    // No DB write. Marker lets the loop pull it off the tool result and stamp
    // it onto the turn's result.
    return {
      _proposal: true,
      kind: 'program_update',
      updatedProgram: input.updatedProgram,
      summary: String(input.summary ?? 'Proposed program change'),
      changedDays: Array.isArray(input.changedDays) ? (input.changedDays as string[]) : [],
    };
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

// ─── Schedule / swap-workout tools ──────────────────────────────────────────

const readScheduleWeek: AgentTool = {
  name: 'read_schedule_week',
  description:
    "Read the user's resolved training schedule for the current week (Mon–Sun) with any swap/override sessions already applied. Each day includes its date, day label, the planned session (name + focus + exercise list) or null for rest, and an isToday flag. Use this any time the user asks about 'today', 'this week', 'tomorrow', 'what's my workout', or wants to swap a day — it shows what's actually scheduled, including the effect of any prior swaps. Returns weekDays, today, weekNumber, phaseName, and goal.",
  input_schema: { type: 'object', properties: {} },
  execute: async (_input, userId) => {
    return getCurrentWeekSchedule(userId);
  },
};

const proposeWorkoutSwap: AgentTool = {
  name: 'propose_workout_swap',
  description:
    "Propose pulling another day's training session into today (or another target day) and re-balancing the rest of the week for proper recovery spacing. Returns a proposed week the user must REVIEW and confirm before anything persists — the loop surfaces it on AgentTurnResult.proposal so the client can render the swap card. Always call read_schedule_week first so you know which date holds the workout the user wants to bring in. Inputs: date = target day to receive the workout (default = today), sourceDate = the day whose session to pull in. Goal- and recovery-preserving by construction (LLM rebalances spacing internally).",
  input_schema: {
    type: 'object',
    properties: {
      sourceDate: {
        type: 'string',
        description: 'YYYY-MM-DD — the date whose scheduled session should move into the target day.',
      },
      date: {
        type: 'string',
        description: 'YYYY-MM-DD — target day to receive the swapped-in session. Defaults to today (EST) if omitted.',
      },
    },
    required: ['sourceDate'],
  },
  execute: async (input, userId) => {
    const sourceDate = String(input.sourceDate ?? '');
    const date = String(input.date ?? todayStr());
    try {
      const { proposedWeek, rationale, chosenSessionName } = await buildSwapProposal(userId, date, sourceDate);
      return {
        _proposal: true,
        kind: 'workout_swap',
        proposedWeek,
        rationale,
        sourceDate,
        chosenSessionName,
        summary: `Move ${chosenSessionName} into ${date}; rebalance the rest of the week.`,
      };
    } catch (err) {
      if (err instanceof SwapProposalError) return { error: err.message };
      throw err;
    }
  },
};

const proposeExerciseSwap: AgentTool = {
  name: 'propose_exercise_swap',
  description:
    "CALL THIS when the user agrees to swap one exercise for another in their program — even casually (\"yes\", \"sure\", \"ok do it\"). This is the ONLY way to make the swap actually take effect; text-only confirmation does NOT modify the program. Returns a proposal card the user taps to apply (goal-preserving validation runs server-side at that moment, not now). REQUIRED steps before calling: (1) call read_program to get the exact stored exercise name and which day(s) it appears on; (2) construct the FULL updatedProgram object with the exercise replaced everywhere it appears, reps/sets/RPE mapped sensibly to the new movement, all other days untouched. Inputs: fromExerciseName = exact name as stored; toExerciseName = the replacement; reason = one short sentence for the proposal summary; updatedProgram = complete updated program object.",
  input_schema: {
    type: 'object',
    properties: {
      fromExerciseName: { type: 'string', description: 'Exact name of the exercise to replace, e.g. "Back Squat".' },
      toExerciseName:   { type: 'string', description: 'Exact name of the replacement, e.g. "Bulgarian Split Squat".' },
      reason:           { type: 'string', description: 'One short sentence explaining the swap (e.g. equipment, injury, preference).' },
      updatedProgram:   {
        type: 'object',
        description: 'The COMPLETE updated training program object (same shape as read_program returns), with fromExerciseName replaced by toExerciseName everywhere it appears. Reps/sets/RPE should map sensibly to the new movement.',
      },
    },
    required: ['fromExerciseName', 'toExerciseName', 'updatedProgram'],
  },
  execute: async (input) => {
    const from = String(input.fromExerciseName ?? '');
    const to   = String(input.toExerciseName ?? '');
    const reason = String(input.reason ?? '');
    return {
      _proposal: true,
      kind: 'program_update', // shares the confirm-proposal path with propose_program_update
      updatedProgram: input.updatedProgram,
      summary: `Swap ${from} → ${to}${reason ? ` (${reason})` : ''}`,
      changedDays: [],
    };
  },
};

const swapExerciseInProgram: AgentTool = {
  name: 'swap_exercise_in_program',
  description:
    "Replace one exercise in the user's saved training program with another, EVERYWHERE it appears, AND PERSIST. Use this the moment the user agrees to a swap suggestion (any agreement: 'yes', 'sure', 'ok', 'go with X', 'let's do it', etc.). This is the simpler alternative to propose_exercise_swap — no need to construct a full updatedProgram object; the backend does the surgery from just the names. Returns occurrences swapped + days affected so you can report what changed. After calling this, your reply MUST acknowledge that the program was updated (e.g. 'Done — swapped on Day 4'). Inputs: fromExerciseName = exact stored name (call read_program if you're not 100% sure of the casing); toExerciseName = the replacement; reason = one short string surfaced in audit (e.g. 'no bench available').",
  input_schema: {
    type: 'object',
    properties: {
      fromExerciseName: { type: 'string', description: 'Exact name as stored, e.g. "Bulgarian Split Squat".' },
      toExerciseName:   { type: 'string', description: 'Replacement, e.g. "Reverse Lunge".' },
      reason:           { type: 'string', description: 'One short sentence for audit/log.' },
    },
    required: ['fromExerciseName', 'toExerciseName'],
  },
  execute: async (input, userId) => {
    const from = String(input.fromExerciseName ?? '');
    const to   = String(input.toExerciseName ?? '');
    const reason = input.reason != null ? String(input.reason) : undefined;
    return applyExerciseSwap(userId, from, to, reason);
  },
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  // Reads
  readProfile,
  readNutritionToday,
  readBodyWeightTrend,
  readRecentWorkouts,
  readWellness,
  readProgram,
  readScheduleWeek,
  readLatestDiagnostic,
  queryResearch,
  // Writes
  logMeal,
  logBodyWeight,
  logWorkout,
  logWellness,
  adjustMacros,
  applyProgramUpdateTool,
  proposeProgramUpdateTool,
  proposeWorkoutSwap,
  proposeExerciseSwap,
  swapExerciseInProgram,
  remember,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t]),
);

// Anthropic-API-shaped tool definitions (name/description/input_schema only).
export const TOOL_DEFINITIONS = AGENT_TOOLS.map(({ name, description, input_schema }) => ({
  name, description, input_schema,
}));
