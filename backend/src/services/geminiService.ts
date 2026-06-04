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
import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';

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

// ─── GCS-backed video upload (replaces inline-base64) ───────────────────────
//
// Vertex AI's inline-base64 path tops out around ~19MB of request body, which
// is below a single 60s 1080p phone clip. Switching to GCS-backed fileData
// URIs unlocks videos up to several hundred MB and removes the lossy
// transcoding burden from the mobile client.
//
// Storage uses Application Default Credentials, same as the Gemini SDK, so
// no extra auth setup beyond what's already configured. Bucket auto-creates
// on first call if missing. Each upload uses a random GUID name so two
// concurrent users never collide; we delete the object immediately after
// the analysis returns.

const STORAGE_BUCKET = process.env.GCP_FORM_VIDEO_BUCKET ?? `axiom-form-videos-${PROJECT}`;
const STORAGE_LOCATION = process.env.GCP_STORAGE_LOCATION ?? 'us-central1';

let _storage: Storage | null = null;
let _bucketReady = false;
async function getBucket() {
  if (!_storage) _storage = new Storage({ projectId: PROJECT });
  const bucket = _storage.bucket(STORAGE_BUCKET);
  if (!_bucketReady) {
    const [exists] = await bucket.exists();
    if (!exists) {
      // Create with a 1-day lifecycle rule so even an orphan upload gets
      // deleted in 24h. Belt-and-suspenders alongside our explicit delete.
      await bucket.create({
        location: STORAGE_LOCATION,
        uniformBucketLevelAccess: { enabled: true },
        lifecycle: { rule: [{ action: { type: 'Delete' }, condition: { age: 1 } }] },
      });
    }
    _bucketReady = true;
  }
  return bucket;
}

/**
 * Analyze a workout video for form. The buffer is uploaded to GCS, referenced
 * via gs:// URI in the Gemini request, and deleted after the call. We don't
 * keep the user's video around — it's processed and gone in under a minute.
 */
export async function analyzeWorkoutVideo(
  videoBuffer: Buffer,
  mimeType: string,
  exerciseHint?: string | null,
): Promise<WorkoutVideoAnalysis> {
  const bucket = await getBucket();
  const ext = (mimeType.split('/')[1] || 'mp4').replace('quicktime', 'mov');
  const objectName = `form-video/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const file = bucket.file(objectName);

  // Upload, then call Gemini, then delete — try/finally so a failed call
  // still cleans up the object.
  await file.save(videoBuffer, { metadata: { contentType: mimeType }, resumable: false });
  try {
    const userText = exerciseHint
      ? `Analyze the lifter's form in this video. They told us it's: "${exerciseHint}". Confirm or correct.`
      : `Identify the exercise and analyze the lifter's form in this video.`;
    const res = await client().models.generateContent({
      model: MODEL,
      config: {
        systemInstruction: WORKOUT_VIDEO_SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: WORKOUT_VIDEO_SCHEMA,
        // Gemini 3.1 Pro thinks internally before responding; thinking tokens
        // count against maxOutputTokens AND add multi-second latency. Cap the
        // budget so there's room for the full JSON and the call stays quick —
        // form scoring is structured output, it doesn't need deep deliberation.
        // (Same fix applied to the meal-photo analyzer in llmService.)
        thinkingConfig: { thinkingBudget: 1024 },
        maxOutputTokens: 8192,
      },
      contents: [{ role: 'user', parts: [
        { text: userText },
        { fileData: { mimeType, fileUri: `gs://${STORAGE_BUCKET}/${objectName}` } },
      ]}],
    });
    // Despite responseMimeType=application/json, Gemini occasionally wraps the
    // JSON in markdown code fences (```json … ```) or truncates under thinking
    // pressure. Strip fences and parse defensively so a recoverable formatting
    // quirk doesn't surface to the user as "couldn't analyze your video".
    const raw = res.text?.trim();
    if (!raw) throw new Error('Gemini returned an empty response for the workout video.');
    const text = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(text) as WorkoutVideoAnalysis;
    } catch (err: any) {
      const tail = text.length > 300 ? '…' + text.slice(-300) : text;
      console.error('[form-video] JSON parse failed, response tail:', tail);
      throw new Error(`Workout video response was malformed: ${err?.message ?? 'unknown'}`);
    }
  } finally {
    // Best-effort cleanup. The 1-day lifecycle rule on the bucket is the
    // safety net if this delete races a process crash.
    file.delete({ ignoreNotFound: true }).catch(() => {});
  }
}
