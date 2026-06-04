// Workout-form video analysis (async / polling).
//
// POST /api/form-analysis/video — upload a lift video (multipart, "video"
//   field, ≤200MB). Creates a FormAnalysis row with status='pending',
//   kicks off the Gemini call in the background, and returns 202 with the
//   row id immediately. The client polls GET /:id to render terminal state.
//   Free tier capped at FEATURE.FORM_VIDEO daily quota; pro unmetered.
// GET  /api/form-analysis        — history (newest first).
// GET  /api/form-analysis/:id    — status + analysis when complete.
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
import { analyzeWorkoutVideo } from '../services/geminiService.js';
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

router.post('/form-analysis/video', requireAuth, uploadVideo, async (req, res) => {
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

  // Create the pending row IMMEDIATELY so the client has an id to poll. The
  // actual analysis runs in the background promise below.
  const pending = await prisma.formAnalysis.create({
    data: {
      userId,
      status: 'pending',
      exercise: 'pending',
      exerciseHint,
      analysisJson: '{}',
    },
    select: { id: true, createdAt: true },
  });

  // Snapshot the buffer + mime — req.file goes out of scope as soon as the
  // response is sent, so the background task needs its own references.
  const videoBuffer = req.file.buffer;
  const mimeType = req.file.mimetype;

  // Fire-and-forget. The route returns 202 below; the analysis writes its
  // terminal state to the row when it's done (success or failure). Any
  // error here MUST be caught — an uncaught rejection on a fire-and-forget
  // promise kills the Node process under most uncaughtException handlers.
  (async () => {
    try {
      const analysis = await analyzeWorkoutVideo(videoBuffer, mimeType, exerciseHint);
      await prisma.formAnalysis.update({
        where: { id: pending.id },
        data: {
          status: 'complete',
          exercise: analysis.exercise || 'unknown',
          formScore: Number.isFinite(analysis.formScore) ? analysis.formScore : null,
          repCount: typeof analysis.repCount === 'number' ? analysis.repCount : null,
          analysisJson: JSON.stringify(analysis),
          errorMessage: null,
        },
      });
    } catch (err: any) {
      console.error('Form video analysis (async) error:', err);
      // Refund the quota — the user shouldn't lose their daily credit to a
      // failure they didn't cause.
      await refundDailyQuota(userId, tier, FEATURE.FORM_VIDEO).catch(() => {});
      await prisma.formAnalysis.update({
        where: { id: pending.id },
        data: {
          status: 'failed',
          exercise: 'unknown',
          errorMessage: (err?.message ?? 'Analysis failed').slice(0, 500),
        },
      }).catch(() => {});
    }
  })();

  // 202 Accepted: created the row, processing happens in the background,
  // poll GET /api/form-analysis/:id to track status.
  return res.status(202).json({
    id: pending.id,
    createdAt: pending.createdAt,
    status: 'pending',
    usage: {
      feature: FEATURE.FORM_VIDEO,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      resetAt: quota.resetAt,
    },
  });
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
