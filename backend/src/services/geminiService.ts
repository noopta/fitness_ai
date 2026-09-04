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

// gemini-3.1-pro-preview lost project access ~Jun 10 (preview allowlist drop).
// 2.5-pro is GA and works on the project's Vertex region. Swap back when 3.1
// Model Garden access is restored under inquiries@axiomtraining.io.
const MODEL = 'gemini-2.5-pro';
const PROJECT = process.env.GCP_PROJECT_NUMBER ?? '656267185967';
const LOCATION = process.env.GCP_LOCATION ?? 'global';

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  _client = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return _client;
}

// ─── Safety ───────────────────────────────────────────────────────────────────
//
// These calls previously specified no safetySettings at all, so Vertex's
// defaults applied silently. Two consequences worth fixing:
//
//   1. A blocked response surfaced to the user as a generic "couldn't analyze
//      that video" 502, indistinguishable from a real failure — so nobody knew
//      whether the model had refused or the service was broken.
//   2. Form videos are footage of a person, often filmed at home. Explicit
//      thresholds are the difference between "we rely on a default we never
//      chose" and "we decided what this endpoint accepts".
//
// BLOCK_MEDIUM_AND_ABOVE on sexually explicit and harassment; dangerous-content
// is left more permissive because legitimate training talk (failure sets, cutting
// weight, injury descriptions) trips it constantly at a lower threshold.
export const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
] as any;

/** Raised when the model refuses on safety grounds, so routes can 400 (not 502). */
export class ContentBlockedError extends Error {
  readonly isContentBlocked = true;
  constructor(reason: string) {
    super(reason);
    this.name = 'ContentBlockedError';
  }
}

/**
 * Convert a safety block into a typed error. Vertex signals this via
 * promptFeedback.blockReason (input rejected) or a SAFETY finishReason
 * (output stopped), and in both cases `res.text` is empty — which is why this
 * used to read as a parse failure.
 */
export function assertNotBlocked(res: any): void {
  const blockReason = res?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ContentBlockedError(
      'That content was rejected by our safety checks. Please upload training content only.',
    );
  }
  const finish = res?.candidates?.[0]?.finishReason;
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
    throw new ContentBlockedError(
      'That content was rejected by our safety checks. Please upload training content only.',
    );
  }
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
      safetySettings: SAFETY_SETTINGS,
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
      safetySettings: SAFETY_SETTINGS,
    },
    contents: `Estimate macros for: "${description}"`,
  });
  return JSON.parse(res.text ?? '{}');
}

// ─── Workout video → form analysis ───────────────────────────────────────────

/**
 * A single fault, optionally anchored to the moment and place in the video
 * where it happens. `timestampSec` + `box2d` are what let us extract a
 * reference still (see formFrameService) so the feedback can point at the
 * frame it's talking about rather than describing it in the abstract.
 *
 * Both anchors are nullable and independent: the model routinely spots a
 * fault it can name but can't localise ("bracing is inconsistent across the
 * set"), and forcing a coordinate there would just invite it to invent one.
 */
export interface FormWeakness {
  issue: string;
  severity: 'minor' | 'moderate' | 'major';
  cue: string;
  /** Seconds from the start of the clip. Null when the fault isn't tied to one moment. */
  timestampSec?: number | null;
  /**
   * A short noun phrase naming what to highlight ("the lifter's shoes", "the
   * lower back and hips"). NOT coordinates — see locateInFrame for why the
   * model is asked what to look for here and where to find it separately.
   */
  focusTarget?: string | null;
}

export interface WorkoutVideoAnalysis {
  exercise: string;                       // e.g. "Back squat"
  formScore: number;                       // 1-10, holistic
  repCount: number | null;
  strengths: string[];                     // 2-4 short bullets
  weaknesses: FormWeakness[];
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
          timestampSec: {
            type: Type.NUMBER,
            nullable: true,
            description:
              'Seconds from the start of the video at the single clearest moment this fault is visible. Null if the fault is not tied to one moment.',
          },
          focusTarget: {
            type: Type.STRING,
            nullable: true,
            description:
              "Short noun phrase naming what a viewer should look at in that frame — e.g. \"the lifter's shoes\", \"the lower back and hips\", \"the bar and hands\". Not coordinates. Null if the fault has no single location.",
          },
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

const WORKOUT_VIDEO_SYSTEM = `You are an elite strength & conditioning coach analyzing a lifter's video. Be direct, specific, and evidence-based. Focus on the BIGGEST single fix the lifter can make first. When you spot a weakness, give a concrete coaching cue ("push knees out", "brace before unrack", "drive hips forward through the bar") — not vague advice. Drill recommendations should target the actual weakness, not generic warm-ups. Flag anything that looks like an immediate injury risk (lumbar rounding under load, valgus knee collapse, dangerous unrack, etc.). If the video is too dark, too short, or doesn't show a recognizable exercise, return exercise="unknown" and explain in summary.

ANCHORING FAULTS TO THE VIDEO
For each weakness, when you can genuinely see it at one identifiable moment, set timestampSec to that moment and focusTarget to a short noun phrase naming what a viewer should look at. These become a still frame shown to the lifter with that region highlighted, so accuracy matters more than coverage:

- Anchor only what you actually observed in a frame. If you did not see the fault at a specific instant, leave both fields null. A wrong anchor is far worse than no anchor — it points the lifter at the wrong part of their body.
- Pick the single clearest instant, not the first or an average.
- focusTarget names a thing, not coordinates: "the lifter's shoes", "the lower back and hips", "the knee and shin", "the bar and hands". Name the whole relevant region rather than a pinpoint.
- Anchor at most the three most important faults. Leave the rest null.`;

// ─── Locating a fault inside one extracted frame ─────────────────────────────
//
// Asking the video pass for coordinates does not work, and it fails in the
// worst possible way: confidently and plausibly.
//
// Measured against a real production analysis (a deficit deadlift, 2026-09-04)
// where the fault was "wearing cushioned running shoes for a heavy pull". The
// lifter's shoes sit at y 667-729 in the extracted frame:
//
//   video pass                 y 867-939   — ~20% of frame height too low,
//                                            landing on empty floor
//   image pass on that frame   y 678-728   \
//                              y 674-729    > three runs, all within ~1%
//                              y 675-734   /
//
// The same video pass put a LARGE region (the torso, for a hip-rise fault)
// roughly in the right place, which is what makes this so easy to miss: a big
// box covers its own error, and only small targets expose it.
//
// So the question is split. The video pass — which is genuinely reliable about
// time (10/10 exact timestamps in calibration) — says WHEN and names WHAT to
// look at. This function takes the frame we actually extracted and asks WHERE,
// in image mode, where grounding is properly calibrated. The coordinates then
// refer to the exact pixels we are about to draw on, rather than to whatever
// internal representation the video path was reasoning over.

const LOCATE_SCHEMA = {
  type: Type.OBJECT,
  required: ['found'],
  properties: {
    found: { type: Type.BOOLEAN, description: 'False if the target is not clearly visible.' },
    box2d: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.NUMBER },
      description: '[ymin, xmin, ymax, xmax] normalized 0-1000.',
    },
  },
};

/**
 * Find `target` in a single frame. Returns the box in 0-1000 normalized
 * coordinates, or null when the model cannot see it — null means we render the
 * still with no highlight, which is the right outcome: the frame is still the
 * right moment, and no marker beats a marker in the wrong place.
 *
 * Never throws. A failure here must cost the highlight, not the analysis.
 */
export async function locateInFrame(
  jpeg: Buffer,
  target: string,
): Promise<number[] | null> {
  try {
    const res = await client().models.generateContent({
      model: MODEL,
      config: {
        responseMimeType: 'application/json',
        responseSchema: LOCATE_SCHEMA,
        safetySettings: SAFETY_SETTINGS,
        // Pure perception, so the budget is the minimum the model accepts
        // rather than zero — 2.5-pro rejects thinkingBudget:0 outright with
        // INVALID_ARGUMENT. Kept low because this call runs up to three times
        // per analysis and has nothing to deliberate about.
        thinkingConfig: { thinkingBudget: 128 },
        maxOutputTokens: 512,
      },
      contents: [{ role: 'user', parts: [
        {
          text:
            `In this photo of someone lifting, give the bounding box of: ${target}. ` +
            'Return [ymin, xmin, ymax, xmax] normalized 0-1000. ' +
            'If that is not clearly visible in this photo, set found=false rather than guessing.',
        },
        { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
      ]}],
    });
    assertNotBlocked(res);
    const raw = res.text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(
      raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
    );
    if (!parsed?.found) return null;
    return Array.isArray(parsed.box2d) ? parsed.box2d : null;
  } catch (err: any) {
    console.warn(`[form-frames] locate "${target}" failed: ${err?.message ?? err}`);
    return null;
  }
}

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

/**
 * Frames per second Gemini samples the video at. This is NOT a cosmetic
 * quality knob — it is the difference between analysis and confabulation.
 *
 * Vertex defaults to 1 fps. Measured against a synthetic clip with ten known
 * events (a coloured square jumping twice per second, ground truth known
 * exactly), asking the model to report each event's time, colour and box:
 *
 *   fps=1  10/10 timestamps right, 0/10 colours right, positions scrambled
 *   fps=2  10/10 timestamps, 10/10 colours, boxes within ~9% of frame
 *   fps=4  10/10 timestamps, 10/10 colours, boxes within ~2% of frame
 *
 * The 1 fps row is the important one. Given five sampled frames and asked
 * about ten events, the model did not decline — it produced ten confident,
 * evenly-spaced, entirely invented ones. Applied to a lift that means a
 * highlight drawn over the wrong part of the lifter's body, delivered with
 * the same confidence as a correct one.
 *
 * 4 fps costs ~1,030 video tokens per second of clip (~62k for the 60s
 * maximum), which is a few cents and well worth not being wrong.
 */
const VIDEO_SAMPLE_FPS = Number(process.env.FORM_VIDEO_SAMPLE_FPS ?? 4);

let _storage: Storage | null = null;
let _bucketReady = false;
async function getBucket() {
  if (!_storage) _storage = new Storage({ projectId: PROJECT });
  const bucket = _storage.bucket(STORAGE_BUCKET);
  if (!_bucketReady) {
    // Best-effort bootstrap. In production the bucket already exists and the
    // runtime identity (post-WIF) holds only roles/storage.objectUser — which
    // grants object ops (create/get/delete) but NOT storage.buckets.get/create.
    // So exists()/create() throw a 403 here; that's expected and must NOT fail
    // the upload, because the actual save/get/delete below work fine with
    // objectUser. Swallow it and proceed. Only envs whose creds include
    // bucket-admin (e.g. local dev) will actually auto-create a missing bucket.
    try {
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
    } catch (err: any) {
      console.warn('[form-video] bucket bootstrap skipped (expected with objectUser-only creds):', err?.message ?? err);
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
        safetySettings: SAFETY_SETTINGS,
        // Gemini 3.1 Pro thinks internally before responding; thinking tokens
        // count against maxOutputTokens AND add multi-second latency. Cap the
        // budget so there's room for the full JSON and the call stays quick —
        // form scoring is structured output, it doesn't need deep deliberation.
        // (Same fix applied to the meal-photo analyzer in llmService.)
        //
        // Raised 1024 -> 2048 when timestamp/box anchoring was added: locating
        // a fault in space and time is the part of this task that actually
        // needs deliberation, and 2048 is what the calibration probes ran at.
        thinkingConfig: { thinkingBudget: 2048 },
        maxOutputTokens: 8192,
      },
      contents: [{ role: 'user', parts: [
        { text: userText },
        {
          fileData: { mimeType, fileUri: `gs://${STORAGE_BUCKET}/${objectName}` },
          videoMetadata: { fps: VIDEO_SAMPLE_FPS },
        },
      ]}],
    });
    // Despite responseMimeType=application/json, Gemini occasionally wraps the
    // JSON in markdown code fences (```json … ```) or truncates under thinking
    // pressure. Strip fences and parse defensively so a recoverable formatting
    // quirk doesn't surface to the user as "couldn't analyze your video".
    // A safety refusal also yields an empty res.text, so distinguish it here —
    // otherwise a blocked upload reports as "couldn't analyze your video".
    assertNotBlocked(res);
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
