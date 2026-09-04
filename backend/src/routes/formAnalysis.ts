// Workout-form video analysis (async / polling).
//
// POST /api/form-analysis/video — upload a lift video (multipart, "video"
//   field, ≤200MB). Creates a FormAnalysis row with status='pending',
//   kicks off the Gemini call in the background, and returns 202 with the
//   row id immediately. The client polls GET /:id to render terminal state.
//   Free tier capped at FEATURE.FORM_VIDEO daily quota; pro unmetered.
// GET  /api/form-analysis        — history (newest first).
// GET  /api/form-analysis/:id    — status + analysis when complete.
// DELETE /api/form-analysis/:id  — remove one analysis and its stills.
//
// ── Reference stills ────────────────────────────────────────────────────────
// When the model anchors a fault to a moment and a region, we cut that frame
// out of the clip, bracket the region, and store it with the analysis so the
// feedback can point at what it means. See formFrameService for why the JPEGs
// live in the row rather than in object storage.
//
// Stills are strictly opt-in per upload (`saveFrames=1`), because they are
// retained imagery of the user's body and the rest of this pipeline retains
// nothing. Two consequences follow, both deliberate:
//   - The installed build never sends the field, so it never gets stills and
//     its behaviour is unchanged.
//   - Consent is re-affirmed on every upload and recorded on the row itself,
//     rather than being a profile flag set once and forgotten.
// Under-18 accounts never get stills regardless of the flag.
//
// The async pattern was added after live testing surfaced 60-90s sync
// round-trips that timed out RN's default 60s fetch (and would also kill
// the UX even at extended timeouts — users staring at a spinner). Polling
// lets the upload return in seconds and the analysis-complete state arrive
// when it's ready, with the UI free to navigate away or background.
//
// Uploads use multipart/form-data. multer keeps the body off the JSON
// parser and hands us a Buffer that the gemini service streams to GCS.

import { Router } from 'express';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { screenFormVideo, recordScreenVerdict } from '../services/formVideoScreeningService.js';
import {
  analyzeWorkoutVideo,
  uploadFormVideo,
  analyzeFormVideoQuick,
  analyzeFormVideoFull,
} from '../services/geminiService.js';
import { extractReferenceFrames } from '../services/formFrameService.js';
import { sendPushToUser } from '../services/notificationService.js';
import {
  consumeDailyQuota,
  refundDailyQuota,
  FEATURE,
} from '../services/featureUsageService.js';

const router = Router();
const prisma = new PrismaClient();

// 200MB default — covers a 60s clip even at 4K. geminiService uploads the
// video to GCS (no inline-base64 ceiling anymore), so the real constraint
// is now nginx's body-size limit + how long the user is willing to wait
// for the upload over their connection. Env-overridable.
const MAX_MB = parseInt(process.env.FORM_VIDEO_MAX_MB || '200', 10);
const UPGRADE_URL = 'https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00';

// In-memory storage: the buffer is handed to geminiService which streams it
// to GCS, never to local disk. Size-capped so a malicious upload can't
// exhaust memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('video/')) return cb(null, true);
    cb(new Error('Only video uploads are supported'));
  },
});

// Retaining stills of a minor's body is a materially different proposition to
// retaining an adult's, and the app's floor is 13. Under-18 accounts get the
// full written analysis and no imagery. An unknown date of birth is treated as
// under-18: the safe default when we cannot tell is the one that stores less.
const FRAME_MIN_AGE_YEARS = 18;

/** Minimum age for the onboarding video hook. See the gate in the route. */
const ONBOARDING_MIN_AGE_YEARS = 18;

/**
 * Kill switch for the onboarding hook, default OFF.
 *
 * The code ships dark. The DPIA addendum lists three conditions that are not
 * engineering work and were not met at deploy time — a named owner for
 * quarantine alerts, a written NCMEC procedure, and a privacy policy that
 * describes this processing — and none of them are things a deploy can
 * satisfy. Shipping the route disabled means the mobile build can go out,
 * the backend can be verified in place, and the feature turns on with one
 * env var once those are signed off, rather than a second risky deploy.
 *
 * Disabled returns 403 `not_enabled`, which the client already treats the
 * same way as the age gate: skip quietly to the intake. So with the flag off
 * the app behaves exactly as it did before the hook existed.
 */
const ONBOARDING_HOOK_ENABLED = process.env.ONBOARDING_FORM_HOOK_ENABLED === '1';

function isAtLeast(dateOfBirth: Date | null | undefined, years: number): boolean {
  if (!dateOfBirth) return false;
  const time = dateOfBirth.getTime();
  if (!Number.isFinite(time)) return false;
  const threshold = new Date();
  threshold.setFullYear(threshold.getFullYear() - years);
  return time <= threshold.getTime();
}

/**
 * Whether this upload may keep reference stills: the client asked for them AND
 * the account is old enough. Never throws — if the age lookup fails we fall
 * through to "no stills" rather than failing an analysis over it.
 */
async function mayStoreFrames(userId: string, requested: boolean): Promise<boolean> {
  if (!requested) return false;
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { dateOfBirth: true },
    });
    return isAtLeast(row?.dateOfBirth, FRAME_MIN_AGE_YEARS);
  } catch (err) {
    console.warn('[form-analysis] age check failed, withholding stills:', err);
    return false;
  }
}

// Wrap multer so its errors become clean JSON (it throws MulterError, e.g.
// LIMIT_FILE_SIZE, which would otherwise hit the generic 500 handler).
const uploadVideo = (req: any, res: any, next: any) =>
  upload.single('video')(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Video is too large. Keep it under ${MAX_MB}MB.` });
    }
    return res.status(400).json({ error: err?.message || 'Invalid video upload' });
  });

router.post('/form-analysis/video', requireAuth, aiLimiter, uploadVideo, async (req, res) => {
  const userId = req.user!.id;
  const tier = req.user!.tier;

  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded. Attach a clip as the "video" field.' });
  }

  const exerciseHint =
    typeof req.body?.exerciseHint === 'string' && req.body.exerciseHint.trim()
      ? req.body.exerciseHint.trim().slice(0, 120)
      : null;

  // Reserve the daily credit up-front (atomic) so concurrent requests can't
  // both slip through. Refunded below if the analysis itself fails.
  const quota = await consumeDailyQuota(userId, tier, FEATURE.FORM_VIDEO);
  if (!quota.allowed) {
    return res.status(429).json({
      error: 'Free tier includes 1 form-video analysis per day. Upgrade to Pro for unlimited form checks.',
      feature: FEATURE.FORM_VIDEO,
      limit: quota.limit,
      resetAt: quota.resetAt,
      upgradeUrl: `${UPGRADE_URL}?client_reference_id=${userId}`,
    });
  }

  // Backward-compatible mode select. Installed (synchronous) clients POST and
  // wait for the analysis inline (legacy 200 contract). The new mobile build
  // sends `X-Form-Analysis-Async: 1` to opt into the async flow: get a row id
  // back immediately (202) and poll GET /:id, free to background the app.
  const wantAsync = req.header('x-form-analysis-async') === '1';

  const usage = {
    feature: FEATURE.FORM_VIDEO,
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining,
    resetAt: quota.resetAt,
  };

  // Create the row up-front as 'pending'. Both modes persist to FormAnalysis;
  // async clients poll this id, sync clients get the row id back in the result.
  const pending = await prisma.formAnalysis.create({
    data: { userId, status: 'pending', exercise: 'pending', exerciseHint, analysisJson: '{}' },
    select: { id: true, createdAt: true },
  });

  // Snapshot the buffer + mime — req.file goes out of scope once we respond,
  // so the (possibly background) analysis needs its own references.
  const videoBuffer = req.file.buffer;
  const mimeType = req.file.mimetype;

  // Opt-in, so anything other than an explicit '1' means no stills.
  const framesRequested = String(req.body?.saveFrames ?? '') === '1';
  const framesAllowed = await mayStoreFrames(userId, framesRequested);

  // Shared work: run the analysis, write the row's terminal state, optionally
  // push. Returns the analysis on success; on failure it marks the row failed,
  // refunds the credit, then rethrows so the sync caller can 502.
  const finalize = async (notify: boolean) => {
    try {
      const analysis = await analyzeWorkoutVideo(videoBuffer, mimeType, exerciseHint);

      // Reference stills, if the user asked for them. Best-effort by design:
      // extractReferenceFrames swallows its own failures and returns [], so a
      // bad clip or a missing ffmpeg costs the pictures, never the analysis.
      // `framesConsent` is persisted alongside so the row records the choice
      // that produced it, not just the result.
      const referenceFrames = framesAllowed
        ? await extractReferenceFrames(videoBuffer, mimeType, analysis.weaknesses)
        : [];
      const stored = { ...analysis, framesConsent: framesAllowed, referenceFrames };

      await prisma.formAnalysis.update({
        where: { id: pending.id },
        data: {
          status: 'complete',
          exercise: analysis.exercise || 'unknown',
          formScore: Number.isFinite(analysis.formScore) ? analysis.formScore : null,
          repCount: typeof analysis.repCount === 'number' ? analysis.repCount : null,
          analysisJson: JSON.stringify(stored),
          errorMessage: null,
        },
      });
      if (notify) {
        const exerciseLabel = analysis.exercise && analysis.exercise !== 'unknown' ? analysis.exercise : 'Your';
        const scoreSuffix = Number.isFinite(analysis.formScore) ? ` — form score ${analysis.formScore}/10` : '';
        await sendPushToUser(
          userId,
          'Form analysis ready 🎥',
          `${exerciseLabel} form check is done${scoreSuffix}. Tap to see your breakdown.`,
          { screen: 'form-analysis', id: pending.id },
        ).catch(() => {});
      }
      return stored;
    } catch (err: any) {
      console.error('Form video analysis error:', err);
      // Refund the credit — the user shouldn't lose it to a failure they didn't cause.
      await refundDailyQuota(userId, tier, FEATURE.FORM_VIDEO).catch(() => {});
      await prisma.formAnalysis.update({
        where: { id: pending.id },
        data: { status: 'failed', exercise: 'unknown', errorMessage: (err?.message ?? 'Analysis failed').slice(0, 500) },
      }).catch(() => {});
      if (notify) {
        await sendPushToUser(
          userId,
          "Form analysis didn't finish",
          "We couldn't analyze that clip. Tap to try again — your daily credit was refunded.",
          { screen: 'form-analysis', id: pending.id },
        ).catch(() => {});
      }
      throw err;
    }
  };

  if (wantAsync) {
    // Fire-and-forget; notify on completion. MUST be caught — an uncaught
    // rejection on a fire-and-forget promise can kill the process.
    finalize(true).catch(() => {});
    return res.status(202).json({ id: pending.id, createdAt: pending.createdAt, status: 'pending', usage });
  }

  // Synchronous (default): await and return the analysis inline — the legacy
  // 200 contract installed clients depend on. No push (the client is waiting).
  try {
    const analysis = await finalize(false);
    return res.json({ id: pending.id, createdAt: pending.createdAt, analysis, usage });
  } catch (err: any) {
    // A safety refusal is the user's problem to fix, not ours — tell them what
    // happened instead of the generic "couldn't analyze" that used to cover it.
    if (err?.isContentBlocked) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(502).json({ error: 'Could not analyze that video. Make sure it clearly shows the full lift, then try again.' });
  }
});

// ─── Onboarding hook ────────────────────────────────────────────────────────
//
// POST /api/form-analysis/onboarding — the first-run "taste of Axiom" pass.
//
// Differs from the main route in three deliberate ways:
//
//  1. It does NOT consume the free daily quota. The whole point is that a
//     brand-new user's first clip is free and, critically, RETRYABLE — the
//     most likely first-clip outcome is a bad angle or a dark gym, and
//     spending their one daily credit on that would turn the aha moment into
//     a 429 paywall. Abuse exposure is bounded instead by (a) eligibility
//     below and (b) aiLimiter, and the pass costs well under a cent.
//
//  2. It runs the quick model (~6s) so the user is looking at feedback before
//     they lose interest, then upgrades the same row to the full report in
//     the background off the SAME GCS upload.
//
//  3. Eligibility is "this user has never run an analysis", which needs no
//     schema column — the FormAnalysis row count IS the flag. A second call
//     404s back to the metered route rather than handing out free passes.
router.post('/form-analysis/onboarding', requireAuth, aiLimiter, uploadVideo, async (req, res) => {
  const userId = req.user!.id;

  if (!ONBOARDING_HOOK_ENABLED) {
    return res.status(403).json({
      error: 'The onboarding form check is not available.',
      reason: 'not_enabled',
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No video uploaded. Attach a clip as the "video" field.' });
  }

  // ── Age gate. The onboarding hook is 18+ ────────────────────────────────
  //
  // Not the app's 13+ minimum. Three reasons, in order of weight:
  //  - It is the same line already drawn for retained stills, and it is not
  //    coherent to refuse to STORE imagery of a 15-year-old while making
  //    filming themselves the first thing we ask them to do.
  //  - The UK Age Appropriate Design Code treats a flow designed to maximise
  //    data provision as a prohibited nudge when children can reach it.
  //  - It removes the largest part of the CSAM surface at the door, which is
  //    worth more than any downstream classifier.
  //
  // Unknown DOB fails closed. A user with no date of birth on file is not
  // assumed adult — they skip the hook and go straight to intake, which is a
  // strictly better outcome than guessing.
  const dobRow = await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } });
  if (!isAtLeast(dobRow?.dateOfBirth, ONBOARDING_MIN_AGE_YEARS)) {
    return res.status(403).json({
      error: 'The onboarding form check is available to users 18 and over.',
      reason: 'age_restricted',
    });
  }

  // The eligibility gate. Note this is a count, not a boolean flag: it is
  // self-healing (deleting your analyses makes you eligible again, which is
  // fine — you also deleted your history) and needs no migration.
  const priorAnalyses = await prisma.formAnalysis.count({ where: { userId } });
  if (priorAnalyses > 0) {
    return res.status(409).json({
      error: 'The onboarding analysis is only available on your first clip.',
      useInstead: '/api/form-analysis/video',
    });
  }

  const exerciseHint =
    typeof req.body?.exerciseHint === 'string' && req.body.exerciseHint.trim()
      ? req.body.exerciseHint.trim().slice(0, 120)
      : null;

  // Stills are opt-in here exactly as on the main route: the stills DPIA's
  // basis is Art. 9(2)(a) explicit consent, and a default-on toggle in a
  // first-run flow is not explicit consent. The age half of mayStoreFrames is
  // already satisfied — this route 403s anyone under 18 above — but we call it
  // anyway rather than duplicating the rule in a second place.
  const framesRequested = String(req.body?.saveFrames ?? '') === '1';
  const framesAllowed = await mayStoreFrames(userId, framesRequested);

  const pending = await prisma.formAnalysis.create({
    data: { userId, status: 'pending', exercise: 'pending', exerciseHint, analysisJson: '{}' },
    select: { id: true, createdAt: true },
  });

  // req.file goes out of scope once we respond; the background work needs
  // its own references.
  const videoBuffer = req.file.buffer;
  const mimeType = req.file.mimetype;

  // Two passes, one upload. The user waits only for the first.
  const runBothPasses = async () => {
    const t0 = Date.now();
    let upload: { fileUri: string; cleanup: () => void } | null = null;
    // Set by a quarantine verdict. When true the GCS object is deliberately
    // NOT deleted in the finally — see formVideoScreeningService for why
    // preservation beats privacy in exactly this one case.
    let preserveObject = false;
    try {
      upload = await uploadFormVideo(videoBuffer, mimeType);
      const uploadMs = Date.now() - t0;

      // Screening runs CONCURRENTLY with the analysis, not in front of it.
      // It is a tiny-output call and lands well inside the analysis window,
      // so in the common case it adds no wall-clock at all — but nothing is
      // written to the row or shown to the user until it comes back clean.
      const tQuick = Date.now();
      const [screen, quick] = await Promise.all([
        screenFormVideo(upload.fileUri, mimeType),
        analyzeFormVideoQuick(upload.fileUri, mimeType, exerciseHint),
      ]);
      const quickMs = Date.now() - tQuick;

      if (screen.action !== 'allow') {
        preserveObject = screen.action === 'quarantine';
        await recordScreenVerdict({
          userId,
          surface: 'form_video_onboarding',
          verdict: screen,
          preservedObject: preserveObject ? upload.fileUri : null,
        });
        // The analysis is discarded unread. Storing coaching feedback derived
        // from a clip we just refused would defeat the point of refusing it.
        await prisma.formAnalysis.update({
          where: { id: pending.id },
          data: {
            status: 'failed',
            exercise: 'unknown',
            errorMessage: screen.userMessage ?? 'This video could not be processed.',
          },
        });
        console.log(`[form-analysis] onboarding screened out ${pending.id}: ${screen.concern} (${screen.action})`);
        return;
      }

      // One still, from the quick pass's own anchor. It has to come from THIS
      // pass rather than the full one: the full report lands ~20s later, and a
      // picture that arrives after the user has moved on is not the feature.
      // Best-effort by design — extractReferenceFrames swallows its own
      // failures and returns [], so a missing ffmpeg or an unanchored fault
      // costs the picture and never the analysis.
      const quickFrames = framesAllowed
        ? await extractReferenceFrames(videoBuffer, mimeType, [{
            issue: quick.headline,
            severity: 'major',
            cue: quick.cue,
            timestampSec: quick.timestampSec ?? null,
            focusTarget: quick.focusTarget ?? null,
          }])
        : [];

      await prisma.formAnalysis.update({
        where: { id: pending.id },
        data: {
          status: 'complete',
          exercise: quick.exercise || 'unknown',
          formScore: Number.isFinite(quick.formScore) ? quick.formScore : null,
          repCount: typeof quick.repCount === 'number' ? quick.repCount : null,
          // `mode` is what tells the client which shape it is holding. It
          // lives inside the JSON rather than in a column so this whole
          // feature ships without a migration (and therefore OTA-able).
          analysisJson: JSON.stringify({
            ...quick, mode: 'quick',
            framesConsent: framesAllowed,
            referenceFrames: quickFrames,
          }),
          errorMessage: null,
        },
      });
      console.log(`[form-analysis] onboarding quick pass ${pending.id}: gcs=${uploadMs}ms quick=${quickMs}ms`);

      // ── Second pass. The user already has their result; from here on every
      // failure is silent. Never downgrade a delivered 'complete' row to
      // 'failed' because the bonus report didn't land.
      try {
        const tFull = Date.now();
        const full = await analyzeFormVideoFull(upload.fileUri, mimeType, quick.exercise || exerciseHint);
        await prisma.formAnalysis.update({
          where: { id: pending.id },
          data: {
            exercise: full.exercise || quick.exercise || 'unknown',
            formScore: Number.isFinite(full.formScore) ? full.formScore : null,
            repCount: typeof full.repCount === 'number' ? full.repCount : null,
            analysisJson: JSON.stringify({
              ...full,
              mode: 'full',
              framesConsent: framesAllowed,
              referenceFrames: framesAllowed
                ? await extractReferenceFrames(videoBuffer, mimeType, full.weaknesses)
                : [],
              // Keep the line the user actually read on screen, so the full
              // report can open with it instead of contradicting it.
              onboardingHeadline: quick.headline,
              onboardingCue: quick.cue,
            }),
          },
        });
        console.log(`[form-analysis] onboarding full pass ${pending.id}: ${Date.now() - tFull}ms`);
      } catch (err) {
        console.warn(`[form-analysis] onboarding full pass failed for ${pending.id} (quick result stands):`, err);
      }
    } catch (err: any) {
      console.error('[form-analysis] onboarding analysis error:', err);
      await prisma.formAnalysis
        .update({
          where: { id: pending.id },
          data: {
            status: 'failed',
            exercise: 'unknown',
            errorMessage: err?.message?.slice(0, 300) ?? 'Analysis failed',
          },
        })
        .catch(() => {});
    } finally {
      // Quarantined objects are left in place on purpose. The bucket's 1-day
      // lifecycle rule would still reap them, so acting on a quarantine alert
      // is time-bound — that window is the reason the log line is an error.
      if (preserveObject) {
        console.error(`[form-analysis] object preserved for review, cleanup skipped: ${upload?.fileUri}`);
      } else {
        upload?.cleanup();
      }
    }
  };

  // Fire and forget — the client polls GET /:id. No push notification here:
  // unlike the main route the user is staring at the screen, and a push for
  // something already on screen reads as a bug.
  runBothPasses().catch(() => {});

  return res.status(202).json({ id: pending.id, createdAt: pending.createdAt, status: 'pending' });
});

router.get('/form-analysis', requireAuth, async (req, res) => {
  try {
    const rows = await prisma.formAnalysis.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, status: true, exercise: true, formScore: true, repCount: true, createdAt: true,
      },
    });
    res.json({ analyses: rows });
  } catch (err) {
    console.error('Form analysis list error:', err);
    res.status(500).json({ error: 'Failed to load form analyses' });
  }
});

router.get('/form-analysis/:id', requireAuth, async (req, res) => {
  try {
    const row = await prisma.formAnalysis.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!row) return res.status(404).json({ error: 'Analysis not found' });
    let analysis: unknown = {};
    try { analysis = JSON.parse(row.analysisJson); } catch { /* corrupt row → empty */ }
    res.json({
      id: row.id,
      status: row.status,
      errorMessage: row.errorMessage,
      exercise: row.exercise,
      formScore: row.formScore,
      repCount: row.repCount,
      exerciseHint: row.exerciseHint,
      createdAt: row.createdAt,
      analysis,
    });
  } catch (err) {
    console.error('Form analysis fetch error:', err);
    res.status(500).json({ error: 'Failed to load analysis' });
  }
});

/**
 * Delete one analysis, and with it any reference stills — they live inside
 * analysisJson, so removing the row removes the imagery in the same statement
 * with nothing left to orphan.
 *
 * This exists because the feature now retains pictures of the user. "Delete
 * your whole account" was the only erasure path before, which is not a real
 * choice to offer someone who wants one clip gone.
 *
 * deleteMany, not delete, so the userId predicate is part of the write: a
 * findFirst-then-delete pair would be racy and would leak row existence
 * through the 404. Zero rows deleted is reported as not found either way.
 */
router.delete('/form-analysis/:id', requireAuth, async (req, res) => {
  try {
    const { count } = await prisma.formAnalysis.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (count === 0) return res.status(404).json({ error: 'Analysis not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Form analysis delete error:', err);
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

// ─── Pending-row sweep ──────────────────────────────────────────────────────
//
// If the backend crashes / restarts mid-analysis, the in-flight promise dies
// and the FormAnalysis row stays 'pending' forever — UI would poll it
// indefinitely. This sweep marks any row that's been pending for >10 minutes
// as failed so the client sees a terminal state and can retry. 10 min is
// generous — even the slowest end-to-end (large clip + slow Vertex thinking)
// shouldn't exceed 3-4 min, so 10 is safely past the realistic ceiling.
const STALE_PENDING_MIN = 10;

export async function sweepStalePendingFormAnalyses(): Promise<{ marked: number }> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MIN * 60_000);
  const result = await prisma.formAnalysis.updateMany({
    where: { status: 'pending', updatedAt: { lt: cutoff } },
    data: {
      status: 'failed',
      exercise: 'unknown',
      errorMessage: 'Analysis didn\'t complete in time. The server may have restarted — try again.',
    },
  });
  if (result.count > 0) {
    console.log(`[form-analysis] swept ${result.count} stale pending row(s) (>${STALE_PENDING_MIN}m old)`);
  }
  return { marked: result.count };
}

export default router;
