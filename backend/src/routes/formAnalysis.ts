// Workout-form video analysis.
//
// POST /api/form-analysis/video — upload a ≤60s lift video (multipart, field
//   "video"), Gemini 3.1 Pro analyzes form, we persist the critique and return
//   it. Free tier is capped at FREE_FORM_VIDEO_DAILY_LIMIT/day (default 1);
//   pro/enterprise are unmetered.
// GET  /api/form-analysis        — list the caller's past analyses (newest first).
// GET  /api/form-analysis/:id    — fetch one stored analysis with full detail.
//
// Unlike the rest of the app (base64-in-JSON), video uses multipart/form-data:
// a 60s phone clip is tens of MB, well past the global 10mb express.json cap,
// and base64-inflating it by 33% into a JSON string is wasteful. multer keeps
// the body off the JSON parser and hands us a Buffer we stream straight to
// Gemini's Files API.

import { Router } from 'express';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { analyzeWorkoutVideo } from '../services/geminiService.js';
import {
  consumeDailyQuota,
  refundDailyQuota,
  peekDailyQuota,
  FEATURE,
} from '../services/featureUsageService.js';

const router = Router();
const prisma = new PrismaClient();

// Default 19MB matches Vertex AI's inline-base64 request size ceiling — if we
// accept larger uploads we'd just fail downstream when the geminiService
// rejects. A typical 60s phone clip at 720p sits well under this. To support
// longer/higher-res videos, switch geminiService.analyzeWorkoutVideo to GCS.
const MAX_MB = parseInt(process.env.FORM_VIDEO_MAX_MB || '19', 10);
const UPGRADE_URL = 'https://buy.stripe.com/28E9AU15CaIJgYQ5zD0Ba00';

// In-memory storage: the buffer goes straight to Gemini and is never written
// to disk. Size-capped so a malicious upload can't exhaust memory.
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
      return res.status(413).json({ error: `Video is too large. Keep it under ${MAX_MB}MB (≈60 seconds).` });
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

  try {
    const analysis = await analyzeWorkoutVideo(req.file.buffer, req.file.mimetype, exerciseHint);

    const saved = await prisma.formAnalysis.create({
      data: {
        userId,
        exercise: analysis.exercise || 'unknown',
        formScore: Number.isFinite(analysis.formScore) ? analysis.formScore : null,
        repCount: typeof analysis.repCount === 'number' ? analysis.repCount : null,
        exerciseHint,
        analysisJson: JSON.stringify(analysis),
      },
      select: { id: true, createdAt: true },
    });

    return res.json({
      id: saved.id,
      createdAt: saved.createdAt,
      analysis,
      usage: { feature: FEATURE.FORM_VIDEO, used: quota.used, limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt },
    });
  } catch (err: any) {
    // The analysis failed — give the free user their credit back.
    await refundDailyQuota(userId, tier, FEATURE.FORM_VIDEO);
    console.error('Form video analysis error:', err);
    return res.status(502).json({ error: 'Could not analyze that video. Make sure it clearly shows the full lift, then try again.' });
  }
});

router.get('/form-analysis', requireAuth, async (req, res) => {
  try {
    const rows = await prisma.formAnalysis.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, exercise: true, formScore: true, repCount: true, createdAt: true },
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

export default router;
