// Ingest screening for form-analysis video.
//
// Why this exists: until now the only control on the video path was Gemini's
// SAFETY_SETTINGS, which gate the model's *response*. A blocked response still
// means we received the file, wrote it to GCS and processed it — and it gives
// us no record, no escalation and no decision about retention. That was
// tolerable while form analysis was a buried feature with 23 lifetime uses by
// 4 users. It is not tolerable once the onboarding hook makes video upload the
// front door for every new signup, including accounts we have never seen
// before and cannot yet trust.
//
// Two things this is designed around:
//
//  1. LATENCY. The onboarding hook's whole premise is ~8s. So screening runs
//     CONCURRENTLY with the analysis and gates whether the result is
//     *released*, rather than sitting in front of the analysis as a serial
//     step. Screening is a tiny-output call and lands well inside the
//     analysis window, so in the common case it costs nothing.
//
//  2. RETENTION CONFLICT. Our pipeline deletes the video the moment analysis
//     finishes, which is excellent privacy engineering and exactly the wrong
//     move for apparent CSAM: once a US provider is aware, 18 U.S.C. §2258A
//     requires preservation and reporting, and deleting destroys the evidence
//     that report depends on. So a 'quarantine' verdict SUPPRESSES the delete
//     and hands the object path to a human. Every other verdict deletes as
//     normal.
//
// This is a detection-and-escalation layer, not an adjudication one. It never
// decides anything is illegal — it decides what a human must look at, and
// makes sure the material is still there when they do.

import { Type } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { client, assertNotBlocked } from './geminiService.js';
import { alertContentQuarantine } from './errorAlertService.js';

const prisma = new PrismaClient();

const SCREEN_MODEL = process.env.FORM_VIDEO_SCREEN_MODEL ?? 'gemini-2.5-flash';

/**
 * Deliberately stricter than the analysis path's SAFETY_SETTINGS, which set
 * DANGEROUS_CONTENT to BLOCK_ONLY_HIGH because ordinary training talk trips
 * the lower thresholds. Nothing here generates coaching text, so there is no
 * reason to be permissive — and a safety block on THIS call is itself a
 * signal we act on (see the catch below).
 */
const SCREEN_SAFETY = [
  // MEDIUM, not LOW, and the difference matters. At BLOCK_LOW_AND_ABOVE an
  // ordinary shirtless man deadlifting can trip SEXUALLY_EXPLICIT — which
  // under the old logic quarantined him: his onboarding blocked AND his video
  // retained, the exact opposite of what he consented to. At MEDIUM ordinary
  // gym footage passes, which means a block here is now a signal worth acting
  // on rather than noise worth suppressing.
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
] as any;

const SCREEN_SCHEMA = {
  type: Type.OBJECT,
  required: ['isExerciseVideo', 'apparentMinor', 'sexualOrUndressed', 'otherPeopleVisible', 'concern'],
  properties: {
    isExerciseVideo: { type: Type.BOOLEAN, description: 'True if this shows someone exercising or attempting to.' },
    apparentMinor: { type: Type.BOOLEAN, description: 'True if the main subject appears to be under 18.' },
    sexualOrUndressed: { type: Type.BOOLEAN, description: 'True if the subject is undressed beyond normal gym attire, or the framing is sexualised.' },
    otherPeopleVisible: { type: Type.BOOLEAN, description: 'True if people other than the lifter are clearly identifiable.' },
    concern: {
      type: Type.STRING,
      enum: ['none', 'not_exercise', 'minor_present', 'sexual_content', 'minor_and_sexual', 'other'],
      description: 'The single most serious concern present.',
    },
    note: { type: Type.STRING, nullable: true, description: 'One short factual sentence. No speculation.' },
  },
};

const SCREEN_SYSTEM = `You are a content-safety classifier for a weightlifting app. Users upload short clips of themselves lifting so a coach model can critique their technique.

Your only job is to describe what is factually visible, so the app can decide whether a human needs to review it. You are not judging technique and not writing feedback.

Assess, strictly and literally:
- Is this actually someone exercising?
- Does the main subject plainly appear to be under 18?
- Is the subject undressed beyond ordinary gym clothing, or is the framing sexualised rather than athletic? Note that normal gym attire (shorts, sports bras, singlets, bare arms, bare torso in a gym setting) is NOT undressed and NOT sexual.
- Are other identifiable people visible besides the lifter?

Be conservative in both directions: do not label an ordinary adult gym clip as concerning, and do not wave through something that plainly is. If genuinely uncertain about apparent age, answer true for apparentMinor — a human will look.`;

export type ScreenAction = 'allow' | 'reject' | 'quarantine';

export interface ScreenVerdict {
  action: ScreenAction;
  /** Machine-readable reason, stored on the ContentFlag. */
  concern: string;
  /**
   * Which safety categories Vertex blocked on, when it blocked. Recorded so a
   * reviewer opening a quarantine knows what tripped rather than having to
   * infer it from a video they may not want to open blind.
   */
  blockedCategories?: string[];
  /** User-facing message. Deliberately non-accusatory for 'reject'. */
  userMessage?: string;
  raw?: unknown;
}

/**
 * Screen one already-uploaded clip. Takes the gs:// URI so it shares the
 * single upload the analysis passes already use.
 *
 * Fails CLOSED on an unexpected error: if we cannot tell what is in a video,
 * a brand-new untrusted user does not get a result. The cost of a false
 * reject is one retry on an onboarding screen; the cost of a false allow is
 * the thing this module exists to prevent.
 */
/**
 * Which categories Vertex actually blocked on. assertNotBlocked throws a bare
 * ContentBlockedError without the category, and we need it for the review
 * record, so read the ratings off the response directly.
 */
function blockedCategories(res: any): string[] {
  const out = new Set<string>();
  for (const r of res?.promptFeedback?.safetyRatings ?? []) if (r?.blocked) out.add(r.category);
  for (const r of res?.candidates?.[0]?.safetyRatings ?? []) if (r?.blocked) out.add(r.category);
  const reason = res?.promptFeedback?.blockReason;
  if (!out.size && reason) out.add(String(reason));
  return [...out];
}

export async function screenFormVideo(
  fileUri: string,
  mimeType: string,
): Promise<ScreenVerdict> {
  try {
    const res = await client().models.generateContent({
      model: SCREEN_MODEL,
      config: {
        systemInstruction: SCREEN_SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: SCREEN_SCHEMA,
        safetySettings: SCREEN_SAFETY,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 512,
      },
      // Deliberately NOT setting mediaResolution: MEDIA_RESOLUTION_LOW.
      // Measured (n=3, 8s clip): default 7.4s / 2176 input tokens, LOW 5.3s /
      // 640 tokens — so LOW is both faster and ~70% cheaper. We take neither.
      // The one judgement this call exists to make is whether a person might
      // be under 18, and that is the last place to trade away visual detail
      // for two seconds. 7.4s already fits inside the ~8s analysis window it
      // runs concurrently with, so the latency buys us nothing anyway.
      contents: [{ role: 'user', parts: [
        { text: 'Classify this clip.' },
        // 1 fps: this asks "what is in this video", not "when did X happen",
        // so the frame density the analysis passes need is wasted cost here.
        { fileData: { mimeType, fileUri }, videoMetadata: { fps: 1 } },
      ]}],
    });

    const blocked = blockedCategories(res);
    try {
      assertNotBlocked(res);
    } catch (err: any) {
      if (err?.isContentBlocked) {
        return {
          action: 'quarantine',
          concern: 'classifier_safety_block',
          blockedCategories: blocked,
          userMessage: 'We could not process this video. If you believe this is a mistake, contact support.',
        };
      }
      throw err;
    }
    const raw = res.text?.trim();
    if (!raw) return failClosed('empty_screen_response');
    const v = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

    // The one case that must never be auto-deleted or auto-served.
    if (v.apparentMinor && v.sexualOrUndressed) {
      return {
        action: 'quarantine',
        concern: 'minor_and_sexual',
        userMessage: 'We could not process this video. If you believe this is a mistake, contact support.',
        raw: v,
      };
    }
    // An apparent minor in ordinary gym clothing is not a safety incident, but
    // the onboarding hook is 18+ (see the route's age gate) so it should not be
    // here. Reject without quarantine — no preservation obligation attaches.
    if (v.apparentMinor) {
      return {
        action: 'reject',
        concern: 'minor_present',
        userMessage: 'We could not process this video. Form analysis is available to users 18 and over.',
        raw: v,
      };
    }
    if (v.sexualOrUndressed) {
      return {
        action: 'reject',
        concern: 'sexual_content',
        userMessage: 'That clip does not look like a lift. Try filming a set from the side in normal gym clothing.',
        raw: v,
      };
    }
    if (!v.isExerciseVideo) {
      return {
        action: 'reject',
        concern: 'not_exercise',
        userMessage: "That clip doesn't show a lift we can analyze. Try filming a set from the side.",
        raw: v,
      };
    }
    return { action: 'allow', concern: 'none', raw: v };
  } catch (err: any) {
    // A safety block on the CLASSIFIER is a strong signal now that the sexual
    // threshold sits at MEDIUM: ordinary gym footage no longer trips it, so a
    // block means something genuinely tripped Google's filters. Quarantine,
    // because we cannot rule out the case requiring preservation and we no
    // longer have a model opinion to rule it in.
    if (err?.isContentBlocked) {
      return {
        action: 'quarantine',
        concern: 'classifier_safety_block',
        userMessage: 'We could not process this video. If you believe this is a mistake, contact support.',
      };
    }
    console.error('[form-screen] screening failed:', err?.message ?? err);
    return failClosed('screen_error');
  }
}

function failClosed(concern: string): ScreenVerdict {
  return {
    action: 'reject',
    concern,
    userMessage: "We couldn't check that clip just now. Please try again.",
  };
}

/**
 * Record the decision. Uses ContentFlag because it is already the model for
 * retained abuse signal — it has no FK to User precisely so that the record
 * survives account deletion (an abuse history a user can erase by deleting
 * and re-registering is not an abuse history).
 *
 * Field convention for this surface, since ContentFlag was built for text:
 *   surface    'form_video_onboarding' | 'form_video'
 *   excerpt    the preserved gs:// object path on quarantine, else ''.
 *              This is an evidence POINTER, not content — the object itself
 *              stays in GCS precisely so a human can act on it.
 *   categories JSON of the classifier verdict
 *   topScore   1 for quarantine, 0.5 reject, 0 allow — coarse, but it keeps
 *              the existing blocked/topScore review queries meaningful.
 */
export async function recordScreenVerdict(opts: {
  userId: string;
  surface: string;
  verdict: ScreenVerdict;
  preservedObject?: string | null;
}): Promise<void> {
  const { userId, surface, verdict, preservedObject } = opts;
  if (verdict.action === 'allow') return; // don't log a flag for every clean upload
  let flagId = 'unrecorded';
  try {
    const flag = await prisma.contentFlag.create({
      data: {
        userId,
        surface,
        excerpt: verdict.action === 'quarantine' ? (preservedObject ?? '') : '',
        blocked: true,
        categories: JSON.stringify({
          concern: verdict.concern,
          action: verdict.action,
          blockedCategories: verdict.blockedCategories ?? [],
          raw: verdict.raw ?? null,
        }),
        topScore: verdict.action === 'quarantine' ? 1 : 0.5,
      },
      select: { id: true },
    });
    flagId = flag.id;
  } catch (err) {
    console.error('[form-screen] failed to record verdict:', err);
  }

  if (verdict.action === 'quarantine') {
    // Durable local trace, with the object path — this stays on our own box.
    console.error(
      `[form-screen] QUARANTINE user=${userId} concern=${verdict.concern} object=${preservedObject ?? 'none'} — ` +
      `video preserved for review, NOT deleted. Review and, if confirmed, report to NCMEC within the statutory window.`,
    );
    // Out-of-band page. Deliberately carries neither the object path nor any
    // description of what was seen — see alertContentQuarantine.
    await alertContentQuarantine({ flagId, concern: verdict.concern }).catch((e) =>
      console.error('[form-screen] quarantine alert failed to send:', e),
    );
  }
}
