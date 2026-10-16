// Per-itemType validation for POST /social/share payloads (Oct 2026 audit M2).
//
// The payload used to be JSON.stringify-ed verbatim into SharedItem.payload and
// served inline to every viewer, so any extra key (or a 9 MB string in one) went
// straight into everyone's feed, and a client-chosen `imageKey` was signed by
// the image route. Each post type now has an allow-list of keys with bounded
// values; unknown top-level keys are rejected, and server-owned keys
// (imageKey/imageUrl/hasImage/imageKeySig) are removed before parsing.
//
// Key sets are deliberately generous — they cover every shape the mobile app,
// the web app and the coach agent send today (see composeBody in
// packages/agent-ui-core, WorkoutLogModal, ShareWorkoutSheet, social-feed.tsx
// and agent/toolkits/social.ts draft_post) — so tightening this doesn't break a
// shipped client.

import { z } from 'zod';

export const MAX_SHARE_PAYLOAD_BYTES = 64 * 1024;
export const MAX_VIDEO_URL_LEN = 2048;
export const MAX_IMAGE_B64_LEN = 2_800_000;

/** Keys only the server may set. Stripped from client input before validation. */
export const SERVER_OWNED_PAYLOAD_KEYS = ['imageKey', 'imageUrl', 'imageKeySig', 'hasImage'] as const;

const str = (max: number) => z.string().max(max);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const optStr = (max: number) => str(max).nullish();
const optNum = (min: number, max: number) => num(min, max).nullish();

/** http(s) only, parseable, ≤ 2048 chars. javascript:, data:, file: etc. rejected. */
export const httpUrl = z.string().max(MAX_VIDEO_URL_LEN).refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}, { message: 'must be an http(s) URL' });

const setEntry = z.object({
  reps: z.union([num(0, 10000), str(40)]).nullish(),
  weightKg: optNum(0, 2000),
  weight: optNum(0, 5000),
  unit: optStr(10),
  rpe: optNum(0, 10),
  done: z.boolean().nullish(),
}).strip();

// Exercise entries are nested display data; unknown nested keys are dropped
// (strip) rather than failing the post.
const exercise = z.object({
  name: optStr(120),
  sets: z.union([num(0, 1000), str(40), z.array(setEntry).max(100)]).nullish(),
  reps: z.union([num(0, 10000), str(40)]).nullish(),
  weightKg: optNum(0, 2000),
  weight: optNum(0, 5000),
  weightLbs: optNum(0, 5000),
  unit: optStr(10),
  rpe: optNum(0, 10),
  intensity: optStr(40),
  notes: optStr(500),
  durationMin: optNum(0, 1440),
}).strip();

const common = {
  text: optStr(5000),
  title: optStr(200),
  description: optStr(2000),
  name: optStr(200),
  kind: optStr(40),
  date: optStr(40),
  imageBase64: str(MAX_IMAGE_B64_LEN).nullish(),
  imageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).nullish(),
  videoUrl: httpUrl.nullish(),
};

const workoutKeys = {
  exercises: z.array(exercise).max(60).nullish(),
  durationMin: optNum(0, 1440),
  duration: optNum(0, 1440),
  focus: optStr(80),
  volumeKg: optNum(0, 10_000_000),
};

const macroKeys = {
  calories: optNum(0, 20000),
  proteinG: optNum(0, 2000),
  carbsG: optNum(0, 4000),
  fatG: optNum(0, 2000),
  fiberG: optNum(0, 500),
  servings: optNum(0, 100),
};

const recipeKeys = {
  ...macroKeys,
  ingredients: z.array(z.union([str(200), z.object({ name: optStr(200), amount: optStr(60) }).strip()])).max(80).nullish(),
  steps: z.array(str(1000)).max(50).nullish(),
};

const prKeys = {
  lift: optStr(80),
  exercise: optStr(120),
  weightKg: optNum(0, 2000),
  reps: optNum(0, 1000),
  e1rmKg: optNum(0, 2000),
  previousKg: optNum(0, 2000),
};

const streakKeys = { days: optNum(0, 100000), count: optNum(0, 100000), weeks: optNum(0, 10000) };

const programKeys = {
  weeks: optNum(0, 520),
  daysPerWeek: optNum(0, 14),
  goal: optStr(200),
  phase: optStr(120),
};

const formKeys = {
  exercise: optStr(120),
  score: optNum(0, 100),
  summary: optStr(2000),
  analysisId: optStr(100),
};

const strengthKeys = {
  lifts: z.array(z.object({ name: optStr(120), e1rmKg: optNum(0, 2000), level: optStr(40) }).strip()).max(30).nullish(),
  level: optStr(40),
  score: optNum(0, 100000),
};

const articleKeys = {
  url: httpUrl.nullish(),
  source: optStr(120),
  summary: optStr(2000),
  feedItemId: optStr(100),
};

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  text: z.object({ ...common }).strict(),
  media: z.object({ ...common }).strict(),
  workout: z.object({ ...common, ...workoutKeys }).strict(),
  meal: z.object({ ...common, ...macroKeys }).strict(),
  recipe: z.object({ ...common, ...recipeKeys }).strict(),
  article: z.object({ ...common, ...articleKeys }).strict(),
  pr: z.object({ ...common, ...prKeys }).strict(),
  streak: z.object({ ...common, ...streakKeys }).strict(),
  program: z.object({ ...common, ...programKeys }).strict(),
  form_analysis: z.object({ ...common, ...formKeys }).strict(),
  strength_profile: z.object({ ...common, ...strengthKeys }).strict(),
  // A repost carries only a pointer; attribution and the original's content are
  // copied server-side from the post it points at. The descriptive keys the
  // shipped mobile client also sends are accepted and then ignored.
  repost: z.object({
    originalPostId: z.string().min(1).max(100),
    originalSharerId: z.any().optional(),
    originalSharerName: z.any().optional(),
    originalSharerUsername: z.any().optional(),
    originalItemType: z.any().optional(),
    originalPayload: z.any().optional(),
    originalCaption: z.any().optional(),
    text: optStr(5000),
  }).strict(),
};

export const SHARE_ITEM_TYPES = new Set(Object.keys(SCHEMAS));

export type SharePayloadResult =
  | { ok: true; payload: Record<string, any> }
  | { ok: false; error: string };

/**
 * Validate a client share payload for `itemType`. Server-owned keys are
 * removed first (never trusted, never an error), then the per-type schema runs.
 * Null/undefined values are dropped from the result.
 */
export function parseSharePayload(itemType: string, raw: unknown): SharePayloadResult {
  const schema = SCHEMAS[itemType];
  if (!schema) return { ok: false, error: 'Unsupported post type' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'payload must be an object' };
  const input: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const k of SERVER_OWNED_PAYLOAD_KEYS) delete input[k];
  if (input.imageBase64 != null && typeof input.imageBase64 !== 'string') {
    return { ok: false, error: 'imageBase64 must be a string' };
  }
  if (typeof input.imageBase64 === 'string' && input.imageBase64.length > MAX_IMAGE_B64_LEN) {
    return { ok: false, error: 'Image exceeds the 2MB size limit.' };
  }
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path?.length ? issue.path.join('.') : '';
    const msg = issue?.code === 'unrecognized_keys'
      ? `Unsupported payload field(s): ${(issue as any).keys?.join(', ')}`
      : `Invalid payload${where ? ` field ${where}` : ''}: ${issue?.message ?? 'invalid'}`;
    return { ok: false, error: msg };
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(r.data as Record<string, unknown>)) if (v !== null && v !== undefined) out[k] = v;
  return { ok: true, payload: out };
}

/** Serialized size of the payload with any inline image removed. */
export function payloadBytesWithoutImage(payload: Record<string, any>): number {
  const { imageBase64: _a, ...rest } = payload;
  return Buffer.byteLength(JSON.stringify(rest), 'utf8');
}
