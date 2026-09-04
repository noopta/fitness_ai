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
import { analyzeWorkoutVideo } from '../services/geminiService.js';
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
