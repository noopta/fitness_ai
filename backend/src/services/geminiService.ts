// Gemini 3.1 Pro Preview — multimodal service layer.
//
// Single source of truth for any code path that wants vision/text/video
// inference. We intentionally keep this thin: the route layer composes
// these primitives with rate limiting + persistence; this file just talks
// to the model.
//
// Auth: Vertex AI via Application Default Credentials. The SDK auto-picks up
// ADC from ~/.config/gcloud/application_default_credentials.json (set up by
// `gcloud auth application-default login` on the EC2). No API key in env —
// the previous AI Studio key path ran out of prepayment credits and made
// the photo analyzer 429 in prod; ADC bills against GCP project
// 656267185967, which holds the GCP/Vertex credits.
//
// Project + location are env-overridable so the same code runs against a
// different GCP project for staging / locally.

import { GoogleGenAI, Type } from '@google/genai';

const MODEL = 'gemini-3.1-pro-preview';
const PROJECT = process.env.GCP_PROJECT_NUMBER ?? '656267185967';
const LOCATION = process.env.GCP_LOCATION ?? 'global';

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  _client = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return _client;
}

// ─── Meal: image → macros ─────────────────────────────────────────────────────

export interface MealMacros {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  tags?: string[];
  confidence?: 'high' | 'medium' | 'low';
}

const MEAL_SCHEMA = {
  type: Type.OBJECT,
  required: ['name', 'calories', 'proteinG', 'carbsG', 'fatG'],
  properties: {
    name: { type: Type.STRING, description: 'Short descriptive name of the meal.' },
    calories: { type: Type.NUMBER },
    proteinG: { type: Type.NUMBER, description: 'Protein in grams.' },
    carbsG: { type: Type.NUMBER, description: 'Carbohydrates in grams.' },
    fatG: { type: Type.NUMBER, description: 'Fat in grams.' },
    fiberG: { type: Type.NUMBER, nullable: true },
    sugarG: { type: Type.NUMBER, nullable: true },
    sodiumMg: { type: Type.NUMBER, nullable: true },
    tags: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'], nullable: true },
  },
};

const MEAL_SYSTEM = `You are a registered dietitian estimating macros from food images or descriptions. Be specific about portion estimates and return realistic macro splits. If a meal photo is unclear or contains multiple plates, name the dominant dish. Tags should include flags like 'high-protein', 'fried', 'whole-food', 'processed' when obvious.`;

export async function analyzeMealImage(base64: string, mimeType: string): Promise<MealMacros> {
  const res = await client().models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: MEAL_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: MEAL_SCHEMA,
    },
    contents: [{ role: 'user', parts: [
      { text: 'Estimate the macros for this meal photo.' },
      { inlineData: { mimeType, data: base64 } },
    ]}],
  });
  return JSON.parse(res.text ?? '{}');
}

export async function parseMealText(description: string): Promise<MealMacros> {
  const res = await client().models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: MEAL_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: MEAL_SCHEMA,
    },
    contents: `Estimate macros for: "${description}"`,
  });
  return JSON.parse(res.text ?? '{}');
}

// ─── Workout video → form analysis ───────────────────────────────────────────

export interface WorkoutVideoAnalysis {
  exercise: string;                       // e.g. "Back squat"
  formScore: number;                       // 1-10, holistic
  repCount: number | null;
  strengths: string[];                     // 2-4 short bullets
  weaknesses: { issue: string; severity: 'minor' | 'moderate' | 'major'; cue: string }[];
  recommendedDrills: { name: string; why: string; setsReps?: string }[];
  programmingNotes: string[];              // 1-3 short progression suggestions
  safetyFlags: string[];                   // empty if nothing concerning
  summary: string;                         // 2-3 sentence narrative summary
}

const WORKOUT_VIDEO_SCHEMA = {
  type: Type.OBJECT,
  required: ['exercise', 'formScore', 'strengths', 'weaknesses', 'recommendedDrills', 'programmingNotes', 'safetyFlags', 'summary'],
  properties: {
    exercise: { type: Type.STRING, description: 'Name of the lift performed.' },
    formScore: { type: Type.NUMBER, description: 'Holistic form quality 1-10 (10 = competition-perfect).' },
    repCount: { type: Type.NUMBER, nullable: true, description: 'Number of complete reps visible.' },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: '2-4 short, specific positives.' },
    weaknesses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['issue', 'severity', 'cue'],
        properties: {
          issue: { type: Type.STRING, description: 'What went wrong in 6-10 words.' },
          severity: { type: Type.STRING, enum: ['minor', 'moderate', 'major'] },
          cue: { type: Type.STRING, description: 'Concrete coaching cue to fix it.' },
        },
      },
    },
    recommendedDrills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['name', 'why'],
        properties: {
          name: { type: Type.STRING },
          why: { type: Type.STRING },
          setsReps: { type: Type.STRING, nullable: true },
        },
      },
    },
    programmingNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    safetyFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING },
  },
};

const WORKOUT_VIDEO_SYSTEM = `You are an elite strength & conditioning coach analyzing a lifter's video. Be direct, specific, and evidence-based. Focus on the BIGGEST single fix the lifter can make first. When you spot a weakness, give a concrete coaching cue ("push knees out", "brace before unrack", "drive hips forward through the bar") — not vague advice. Drill recommendations should target the actual weakness, not generic warm-ups. Flag anything that looks like an immediate injury risk (lumbar rounding under load, valgus knee collapse, dangerous unrack, etc.). If the video is too dark, too short, or doesn't show a recognizable exercise, return exercise="unknown" and explain in summary.`;

/**
 * Analyze a workout video for form. Videos are uploaded to Gemini's File
 * API (cleaner than inlining base64 for anything >5MB) and the file is
 * deleted after the call — we don't keep the user's video on Google's side
 * once we have the analysis.
 */
export async function analyzeWorkoutVideo(
  videoBuffer: Buffer,
  mimeType: string,
  exerciseHint?: string | null,
): Promise<WorkoutVideoAnalysis> {
  // Vertex AI doesn't support Gemini's Files API (only the AI Studio surface
  // does). Videos must be either inlined as base64 or referenced via gs://
  // URIs in a GCS bucket. Inline keeps the integration zero-infrastructure
  // and works fine for typical 1-minute phone clips up to ~20MB request
  // size. If user video size grows past that, swap to a GCS bucket.
  const VERTEX_INLINE_LIMIT_MB = 19; // a hair under the ~20MB request ceiling
  const mb = videoBuffer.byteLength / (1024 * 1024);
  if (mb > VERTEX_INLINE_LIMIT_MB) {
    throw new Error(
      `Video is too large for inline upload (${mb.toFixed(1)}MB > ${VERTEX_INLINE_LIMIT_MB}MB). ` +
      `Trim the clip or switch the service layer to GCS-bucket URIs.`,
    );
  }

  const userText = exerciseHint
    ? `Analyze the lifter's form in this video. They told us it's: "${exerciseHint}". Confirm or correct.`
    : `Identify the exercise and analyze the lifter's form in this video.`;

  const res = await client().models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: WORKOUT_VIDEO_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: WORKOUT_VIDEO_SCHEMA,
    },
    contents: [{ role: 'user', parts: [
      { text: userText },
      { inlineData: { mimeType, data: videoBuffer.toString('base64') } },
    ]}],
  });
  return JSON.parse(res.text ?? '{}');
}
