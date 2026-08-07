// Content moderation for user-generated text and images.
//
// Before this, the app had no moderation of any kind: DMs, post captions,
// comments, usernames, avatars, feed photos, meal photos and form videos were
// all written straight to the DB and fanned out to other users (and to push
// notifications) unexamined.
//
// Backed by OpenAI's `omni-moderation-latest`, which scores text and images in
// a single call, is free, and returns in ~50 ms. The `openai` client is already
// a dependency for coach chat, so this adds no new packages.
//
// ── Two deliberate product decisions ────────────────────────────────────────
//
// 1. SELF-HARM IS FLAGGED, NEVER BLOCKED.
//    This is a fitness and nutrition app. Users talk to the coach about food
//    restriction, body image, and weight in ways a general-purpose classifier
//    reads as self-harm — and some of those users genuinely are struggling.
//    Silently refusing their message is the worst available outcome: it removes
//    the one place they reached out. So self-harm categories set
//    `needsSupport`, the write proceeds, and the caller is expected to surface
//    crisis resources alongside the normal response.
//
// 2. FAIL-OPEN ON INFRASTRUCTURE ERROR.
//    If OpenAI is unreachable we allow the write and record `failOpen: true`.
//    A moderation outage taking down all posting is a worse failure mode than
//    a short window of unmoderated content, and the ContentFlag audit trail
//    lets those windows be swept retroactively. Set MODERATION_FAIL_CLOSED=true
//    to invert this.

import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Master switch. Off by default so a deploy without an API key is inert. */
const ENABLED = process.env.MODERATION_ENABLED !== 'false';
const FAIL_CLOSED = process.env.MODERATION_FAIL_CLOSED === 'true';

let _client: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/** Categories that block the write outright. */
const BLOCKING_CATEGORIES = [
  'sexual',
  'sexual/minors',
  'harassment/threatening',
  'hate',
  'hate/threatening',
  'violence/graphic',
  'illicit/violent',
] as const;

/** Categories that flag for support rather than blocking. See note (1) above. */
const SUPPORT_CATEGORIES = ['self-harm', 'self-harm/intent', 'self-harm/instructions'] as const;

/**
 * Sexual content is the category most likely to produce a false positive on a
 * fitness app — physique photos, "glutes", body-composition talk. A higher
 * threshold than the classifier's own boolean flag keeps ordinary gym content
 * through while still catching actual nudity. `sexual/minors` is exempt: that
 * one blocks on any signal at all.
 */
const SEXUAL_SCORE_THRESHOLD = Number(process.env.MODERATION_SEXUAL_THRESHOLD ?? 0.72);

export type ModerationSurface =
  | 'dm'
  | 'comment'
  | 'post_caption'
  | 'post_image'
  | 'avatar'
  | 'username'
  | 'display_name'
  | 'coach_message'
  | 'group_message'
  | 'meal_photo'
  | 'form_video_frame'
  | 'profile_text';

export interface ModerationResult {
  /** False when the content must be rejected. */
  allowed: boolean;
  /** Category that triggered a block, if any. */
  blockedCategory: string | null;
  /** True when self-harm signals were present — surface crisis resources. */
  needsSupport: boolean;
  /** All categories the classifier flagged, for the audit trail. */
  flaggedCategories: string[];
  /** Highest score across flagged categories. */
  topScore: number;
  /** True when the check could not run and we defaulted to allowing. */
  failOpen: boolean;
  /** Client-facing rejection message. Null when allowed. */
  message: string | null;
}

const ALLOW: ModerationResult = {
  allowed: true,
  blockedCategory: null,
  needsSupport: false,
  flaggedCategories: [],
  topScore: 0,
  failOpen: false,
  message: null,
};

function rejectionMessage(category: string): string {
  if (category.startsWith('sexual')) {
    return 'That content looks sexually explicit, which isn\'t allowed on Axiom. Please share training content only.';
  }
  if (category.startsWith('hate') || category.startsWith('harassment')) {
    return 'That content looks abusive or hateful. Please keep it respectful — this is a training community.';
  }
  if (category.startsWith('violence') || category.startsWith('illicit')) {
    return 'That content violates our community guidelines and wasn\'t posted.';
  }
  return 'That content violates our community guidelines and wasn\'t posted.';
}

/**
 * Evaluate a classifier response into our decision shape.
 * Exported for unit testing without an API round-trip.
 */
export function evaluateModeration(result: {
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}): ModerationResult {
  const { categories, category_scores } = result;

  const flaggedCategories = Object.keys(categories).filter((c) => categories[c]);
  const topScore = flaggedCategories.reduce((max, c) => Math.max(max, category_scores[c] ?? 0), 0);
  const needsSupport = SUPPORT_CATEGORIES.some((c) => categories[c]);

  let blockedCategory: string | null = null;
  for (const category of BLOCKING_CATEGORIES) {
    if (!categories[category]) continue;
    // Apply the higher bar to general sexual content only — never to
    // sexual/minors, which blocks on any positive signal.
    if (category === 'sexual' && (category_scores[category] ?? 0) < SEXUAL_SCORE_THRESHOLD) continue;
    blockedCategory = category;
    break;
  }

  return {
    allowed: blockedCategory === null,
    blockedCategory,
    needsSupport,
    flaggedCategories,
    topScore,
    failOpen: false,
    message: blockedCategory ? rejectionMessage(blockedCategory) : null,
  };
}

async function run(
  input: Array<Record<string, unknown>>,
  surface: ModerationSurface,
  userId: string | null,
  excerpt: string,
): Promise<ModerationResult> {
  if (!ENABLED) return ALLOW;

  const openai = client();
  if (!openai) {
    // No key configured. Treated as an infrastructure error, not a pass.
    return FAIL_CLOSED
      ? { ...ALLOW, allowed: false, failOpen: true, message: 'Content checks are unavailable right now. Please try again shortly.' }
      : { ...ALLOW, failOpen: true };
  }

  let evaluated: ModerationResult;
  try {
    const response = await openai.moderations.create({
      model: 'omni-moderation-latest',
      input: input as any,
    });
    const first = response.results?.[0];
    if (!first) throw new Error('empty moderation response');
    evaluated = evaluateModeration({
      categories: first.categories as unknown as Record<string, boolean>,
      category_scores: first.category_scores as unknown as Record<string, number>,
    });
  } catch (err: any) {
    console.error(`[moderation] check failed (surface=${surface}):`, err?.message ?? err);
    return FAIL_CLOSED
      ? { ...ALLOW, allowed: false, failOpen: true, message: 'Content checks are unavailable right now. Please try again shortly.' }
      : { ...ALLOW, failOpen: true };
  }

  // Record anything the classifier flagged, whether or not we blocked it. The
  // near-miss rows are what let us tune SEXUAL_SCORE_THRESHOLD against real
  // traffic instead of guessing, and they're the evidence trail for a
  // repeat-offender suspension.
  if (evaluated.flaggedCategories.length > 0) {
    recordFlag({
      userId,
      surface,
      excerpt,
      blocked: !evaluated.allowed,
      categories: evaluated.flaggedCategories,
      topScore: evaluated.topScore,
    }).catch(() => {});
  }

  return evaluated;
}

/** Moderate a block of user text. */
export async function moderateText(
  text: string,
  surface: ModerationSurface,
  userId: string | null = null,
): Promise<ModerationResult> {
  const trimmed = text?.trim();
  if (!trimmed) return ALLOW;
  return run([{ type: 'text', text: trimmed.slice(0, 4000) }], surface, userId, trimmed.slice(0, 500));
}

/**
 * Moderate an image supplied as raw base64 (no data: prefix) or a full data URI.
 * Images are the reason this service exists — an explicit avatar renders beside
 * every post, comment and DM the user touches.
 */
export async function moderateImageBase64(
  base64: string,
  mimeType: string,
  surface: ModerationSurface,
  userId: string | null = null,
): Promise<ModerationResult> {
  if (!base64) return ALLOW;
  const dataUri = base64.startsWith('data:') ? base64 : `data:${mimeType};base64,${base64}`;
  return run(
    [{ type: 'image_url', image_url: { url: dataUri } }],
    surface,
    userId,
    `<image ${mimeType} ${Math.round(base64.length / 1024)}KB>`,
  );
}

/** Moderate text and an image together in one call (e.g. a captioned post). */
export async function moderatePost(
  caption: string | null,
  imageBase64: string | null,
  mimeType: string | null,
  surface: ModerationSurface,
  userId: string | null = null,
): Promise<ModerationResult> {
  const input: Array<Record<string, unknown>> = [];
  if (caption?.trim()) input.push({ type: 'text', text: caption.trim().slice(0, 4000) });
  if (imageBase64) {
    const dataUri = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:${mimeType ?? 'image/jpeg'};base64,${imageBase64}`;
    input.push({ type: 'image_url', image_url: { url: dataUri } });
  }
  if (input.length === 0) return ALLOW;
  return run(input, surface, userId, caption?.slice(0, 500) ?? '<image>');
}

// ─── Reserved / impersonating names ──────────────────────────────────────────
//
// The classifier catches slurs; it does not catch a user calling themselves
// "AxiomSupport" and DMing people for their password. This list is the
// impersonation half, and it's intentionally small — a broad wordlist produces
// false positives on real names far more often than it stops a troll.

const RESERVED_NAME_PATTERNS: RegExp[] = [
  /^(axiom|liftoff|anakin)([_-]?(team|staff|support|help|admin|official|hq|bot))?$/i,
  /^(admin|administrator|root|support|help|staff|moderator|mod|official|system|security)$/i,
  /(support|admin|official|staff)[_-]?(team|axiom|liftoff)$/i,
];

/**
 * Check a username or display name for impersonation. Returns an error string
 * or null. Run alongside `moderateText` — this covers what the classifier
 * structurally can't.
 */
export function checkReservedName(name: string): string | null {
  const cleaned = name.trim();
  if (!cleaned) return null;
  // Normalise leetspeak so "adm1n" and "4xiom_support" don't walk past.
  const normalised = cleaned
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't');

  for (const pattern of RESERVED_NAME_PATTERNS) {
    if (pattern.test(normalised)) {
      return 'That name is reserved. Please choose a different one.';
    }
  }
  return null;
}

// ─── Audit trail ─────────────────────────────────────────────────────────────

/**
 * Persist a flag. Degrades to a log line when the ContentFlag table doesn't
 * exist yet — this service must never be the reason a deploy that hasn't run
 * `prisma db push` starts rejecting writes.
 */
async function recordFlag(input: {
  userId: string | null;
  surface: ModerationSurface;
  excerpt: string;
  blocked: boolean;
  categories: string[];
  topScore: number;
}): Promise<void> {
  const { userId, surface, excerpt, blocked, categories, topScore } = input;
  console.warn(
    `[moderation] ${blocked ? 'BLOCKED' : 'flagged'} surface=${surface} user=${userId ?? 'anon'} ` +
      `categories=${categories.join(',')} score=${topScore.toFixed(3)}`,
  );
  try {
    await (prisma as any).contentFlag?.create({
      data: {
        userId,
        surface,
        excerpt: excerpt.slice(0, 1000),
        blocked,
        categories: categories.join(','),
        topScore,
      },
    });
  } catch {
    // Table not migrated yet, or a write race. The console line above is the
    // fallback record.
  }
}

/**
 * Count a user's blocked writes in a trailing window — the input to a
 * strike/suspension policy. Returns 0 when the table isn't present.
 */
export async function recentBlockCount(userId: string, windowDays = 30): Promise<number> {
  try {
    const since = new Date(Date.now() - windowDays * 86400_000);
    return await (prisma as any).contentFlag.count({
      where: { userId, blocked: true, createdAt: { gte: since } },
    });
  } catch {
    return 0;
  }
}
