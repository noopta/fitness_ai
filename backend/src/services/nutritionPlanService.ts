// Nutrition & gut-protocol plan generation (gut-health feature).
//
// Deterministic core first: computeMicroTargets picks the numbers, the
// assessment picks the emphasis. The LLM writes the narrative around those
// numbers — foods per focus nutrient, food-first supplement suggestions,
// the gut protocol — grounded in RAG context and returning citations. The
// LLM is never allowed to invent targets; we overwrite any it returns.
import { PrismaClient } from '@prisma/client';
import { chatComplete } from './chatClient.js';
import { buildRAGContext } from './ragService.js';
import { buildPodcastContext, type PodcastReference } from './podcast/podcastRagService.js';
import {
  computeMicroTargets,
  type MicroTargetInput,
  type MicroTargetResult,
  type NutritionGoal,
  type DietaryStyle,
} from './microTargetsService.js';

const prisma = new PrismaClient();

// Stronger model for the one long-form generation in the feature; env-tunable.
const PLAN_MODEL = process.env.NUTRITION_PLAN_MODEL || 'z-ai/glm-5.2';

export interface NutritionAssessment {
  typicalDay?: string;
  mealsPerDay?: number;
  orderOutPerWeek?: number;
  travelsOften?: boolean;
  digestion?: {
    bloating?: 'never' | 'sometimes' | 'often';
    regularity?: 'regular' | 'irregular';
    intolerances?: string[];
  };
  energy?: {
    afternoonCrashes?: boolean;
    caffeinePerDay?: number;
    alcoholPerWeek?: number;
  };
  sleepQualityLow?: boolean;
  fermentedPerWeek?: number;
  plantVarietyGuess?: 'low' | 'medium' | 'high';
  supplements?: string[];
  dietaryStyle?: DietaryStyle;
  goals?: NutritionGoal[];
  medicalFlags?: string[];
}

export interface PlanSource {
  id: number;
  type: 'podcast' | 'library';
  title: string;
  detail?: string | null;
  url?: string | null;
}

export interface GeneratedNutritionPlan {
  summary: string;
  focusNutrients: Array<{
    key: string;
    label: string;
    target: number;
    unit: string;
    why: string;
    foods: string[];
    citationIds: number[];
  }>;
  gutProtocol: {
    principles: Array<{ pillar: string; guidance: string; citationIds: number[] }>;
  };
  supplements: Array<{
    name: string;
    doseRange: string;
    rationale: string;
    citationIds: number[];
  }>;
  disclaimer: string;
  seeProfessional: boolean;
}

const DISCLAIMER =
  'General wellness guidance, not medical advice. Estimates carry ±30% uncertainty.';

export function assessmentToTargetInput(
  assessment: NutritionAssessment,
  user: { weightKg?: number | null; dailyCalorieTarget?: number | null; gender?: string | null; trainingDaysPerWeek?: number | null },
): MicroTargetInput {
  return {
    sex: user.gender === 'female' ? 'female' : user.gender === 'male' ? 'male' : null,
    weightKg: user.weightKg ?? null,
    calorieTarget: user.dailyCalorieTarget ?? null,
    trainingDaysPerWeek: user.trainingDaysPerWeek ?? null,
    dietaryStyle: assessment.dietaryStyle ?? null,
    goals: assessment.goals ?? null,
    sleepQualityLow: assessment.sleepQualityLow ?? null,
  };
}

function coercePlan(
  raw: any,
  targets: MicroTargetResult,
  hasMedicalFlags: boolean,
): GeneratedNutritionPlan {
  const byKey = new Map(targets.targets.map((t) => [t.key, t]));
  const focusNutrients = targets.focus.map((key) => {
    const t = byKey.get(key)!;
    const fromLlm = Array.isArray(raw?.focusNutrients)
      ? raw.focusNutrients.find((f: any) => f?.key === key)
      : null;
    return {
      key,
      label: t.label,
      // Numbers come from the deterministic engine — never the LLM.
      target: t.target,
      unit: t.unit,
      why: typeof fromLlm?.why === 'string' ? fromLlm.why.slice(0, 240) : '',
      foods: Array.isArray(fromLlm?.foods)
        ? fromLlm.foods.map((f: unknown) => String(f)).slice(0, 6)
        : [],
      citationIds: Array.isArray(fromLlm?.citationIds)
        ? fromLlm.citationIds.map((n: unknown) => Number(n)).filter(Number.isFinite)
        : [],
    };
  });

  const principles = Array.isArray(raw?.gutProtocol?.principles)
    ? raw.gutProtocol.principles.slice(0, 6).map((p: any) => ({
        pillar: String(p?.pillar ?? '').slice(0, 40),
        guidance: String(p?.guidance ?? '').slice(0, 300),
        citationIds: Array.isArray(p?.citationIds)
          ? p.citationIds.map((n: unknown) => Number(n)).filter(Number.isFinite)
          : [],
      }))
    : [];

  const supplements = Array.isArray(raw?.supplements)
    ? raw.supplements.slice(0, 5).map((s: any) => ({
        name: String(s?.name ?? '').slice(0, 80),
        doseRange: String(s?.doseRange ?? '').slice(0, 80),
        rationale: String(s?.rationale ?? '').slice(0, 240),
        citationIds: Array.isArray(s?.citationIds)
          ? s.citationIds.map((n: unknown) => Number(n)).filter(Number.isFinite)
          : [],
      }))
    : [];

  return {
    summary: typeof raw?.summary === 'string' ? raw.summary.slice(0, 600) : '',
    focusNutrients,
    gutProtocol: { principles },
    supplements,
    disclaimer: DISCLAIMER,
    seeProfessional: hasMedicalFlags,
  };
}

export async function generateNutritionPlan(userId: string): Promise<{
  plan: GeneratedNutritionPlan;
  targets: MicroTargetResult;
  sources: PlanSource[];
  planId: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      weightKg: true,
      dailyCalorieTarget: true,
      coachProfile: true,
      savedProgram: true,
    },
  });
  if (!user) throw new Error('User not found');

  let coachProfile: any = {};
  try { coachProfile = user.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { /* tolerate */ }
  const assessment: NutritionAssessment = coachProfile?.nutrition ?? {};

  let trainingDays: number | null = null;
  try {
    const program = user.savedProgram ? JSON.parse(user.savedProgram) : null;
    const days = program?.week?.length ?? program?.days?.length;
    if (Number.isFinite(days)) trainingDays = Number(days);
  } catch { /* tolerate */ }

  const targets = computeMicroTargets(
    assessmentToTargetInput(assessment, {
      weightKg: user.weightKg,
      dailyCalorieTarget: (user as any).dailyCalorieTarget ?? null,
      gender: coachProfile?.gender ?? null,
      trainingDaysPerWeek: trainingDays,
    }),
  );

  // RAG context: gut-health + the focus nutrients, from both knowledge bases.
  const focusLabels = targets.focus
    .map((k) => targets.targets.find((t) => t.key === k)?.label)
    .filter(Boolean)
    .join(', ');
  const ragQuery = `gut health microbiome fiber fermented foods plant diversity ${focusLabels} deficiency food sources supplementation`;
  const [libraryContext, podcast] = await Promise.all([
    buildRAGContext(ragQuery, 4).catch(() => null),
    buildPodcastContext(ragQuery, 6).catch(() => ({ context: '', references: [] as PodcastReference[] })),
  ]);

  // Numbered source list the LLM cites by id.
  const sources: PlanSource[] = [];
  podcast.references.forEach((r) => {
    sources.push({
      id: sources.length + 1,
      type: 'podcast',
      title: r.episodeTitle,
      detail: [r.speaker ?? r.guestName, r.chapterTitle].filter(Boolean).join(' · ') || null,
      url: r.youtubeUrl,
    });
  });
  if (libraryContext) {
    sources.push({ id: sources.length + 1, type: 'library', title: 'Axiom research library', detail: 'internal reference corpus' });
  }

  const targetTable = targets.targets
    .map((t) => `${t.key} (${t.label}): ${t.target}${t.unit} [${t.direction}]${targets.focus.includes(t.key) ? ' *FOCUS*' : ''}`)
    .join('\n');
  const sourceTable = sources
    .map((s) => `[${s.id}] ${s.type}: ${s.title}${s.detail ? ` — ${s.detail}` : ''}`)
    .join('\n');

  const hasMedicalFlags = (assessment.medicalFlags ?? []).length > 0;

  const prompt = `You are an elite nutritionist writing a personalized nutrition & gut-health plan for a committed gym-goer.

THEIR ASSESSMENT (verbatim JSON):
${JSON.stringify(assessment)}

THEIR DAILY TARGETS (deterministic — do NOT change any number; *FOCUS* marks their 6 focus nutrients):
${targetTable}

SOURCES you may cite by id (cite honestly — only where genuinely relevant; omit citationIds when none apply):
${sourceTable || '(none available — omit citationIds everywhere)'}

CONTEXT FROM SOURCES:
${podcast.context || ''}
${libraryContext || ''}

Write JSON only:
{
  "summary": "3-4 sentences addressed to the user: what this plan optimizes and why, referencing their stated goals and day-to-day reality.",
  "focusNutrients": [{ "key": "<focus key>", "why": "1 sentence tied to THEIR goals/assessment", "foods": ["specific food with rough serving", ...4-6], "citationIds": [1] }],
  "gutProtocol": { "principles": [{ "pillar": "fiber|plants|ferment|avoid|rhythm", "guidance": "1-2 specific, doable sentences tuned to their habits", "citationIds": [] } ...all 5 pillars] },
  "supplements": [{ "name": "...", "doseRange": "DOSE ONLY, short, e.g. '200-400mg' — timing/format goes in rationale, never here", "rationale": "food-first framing: when diet alone likely falls short for THEM", "citationIds": [] } 0-4 items],
  "seeProfessional": ${hasMedicalFlags}
}

Rules: food-first always — supplements only where their diet plausibly can't cover the gap. Conservative doses only. Never diagnose. Second person, clipped, no exclamation marks.`;

  const response = await chatComplete({
    modelOverride: PLAN_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_completion_tokens: 3000,
  });

  let raw: any = {};
  try { raw = JSON.parse(response.choices[0].message.content || '{}'); } catch { /* coerce handles */ }
  const plan = coercePlan(raw, targets, hasMedicalFlags);

  const saved = await prisma.nutritionPlan.create({
    data: {
      userId,
      planJson: JSON.stringify(plan),
      microTargetsJson: JSON.stringify(targets),
      sourcesJson: JSON.stringify(sources),
    },
    select: { id: true },
  });

  return { plan, targets, sources, planId: saved.id };
}

export async function latestNutritionPlan(userId: string): Promise<{
  plan: GeneratedNutritionPlan;
  targets: MicroTargetResult;
  sources: PlanSource[];
  generatedAt: Date;
} | null> {
  const row = await prisma.nutritionPlan.findFirst({
    where: { userId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!row) return null;
  try {
    return {
      plan: JSON.parse(row.planJson),
      targets: JSON.parse(row.microTargetsJson),
      sources: row.sourcesJson ? JSON.parse(row.sourcesJson) : [],
      generatedAt: row.generatedAt,
    };
  } catch {
    return null;
  }
}
