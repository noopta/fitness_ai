// Conversational lift diagnostic — backend surface (handoff §10).
//
//   GET  /lift-diagnostics                        Home list (both flows)
//   GET  /lift-diagnostics/:id                    resume: session + turn transcript + limit
//   POST /lift-diagnostics/:id/turns              one user action; idempotent on clientTurnId
//   POST /lift-diagnostics/:id/video              multipart clip → 202, async measurement job
//   GET  /lift-diagnostics/:id/video/:turnId      poll the job
//   GET  /lift-diagnostics/:id/report             the graded verdict + fix (both free)
//   POST /lift-diagnostics/:id/share              make public, return link
//   GET  /lift-diagnostics/:id/public             read-only report for the link
//
// The client generates the session id (a UUID) so the very first action — the
// lift chip — is as retryable as every other turn. Turns are the transcript of
// record: clients rebuild the thread by replaying them through the shared
// reducer (packages/diagnostic-core).

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { liftConversationAvailableFor } from '../services/featureFlags.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import posthog from '../services/posthogClient.js';
import { generateWorkoutPlan } from '../services/llmService.js';
import { kgToLb } from '../services/weightUnits.js';
import { formatPlanAsText } from '../services/diagnosticPlan.js';
import { consumeDailyQuota, peekDailyQuota, refundDailyQuota, FEATURE } from '../services/featureUsageService.js';
import {
  KNOWN_FLAGS,
  exerciseName,
  isConversationLift,
  ladderIds,
  type ConversationLift,
} from '../services/liftDiagnostic/policy.js';
import {
  buildVerdict,
  conversationFor,
  flagsFrom,
  gatherInputs,
  presentVerdict,
  toLbs,
  type TurnRow,
  type Verdict,
} from '../services/liftDiagnostic/verdict.js';
import { parseTrimWindow, probeBufferDurationSec, runDiagnosticVideo, trimVideoBuffer } from '../services/liftDiagnostic/video.js';
import { writeThroughWorkingSets } from '../services/liftDiagnostic/writeThrough.js';

const router = Router();
const prisma = new PrismaClient();

/**
 * Rollout gate: the flow is dark unless the flag (or the user's allowlist
 * entry) is on. 404 rather than 403, so the surface doesn't advertise itself.
 * The public share view is exempt — a link someone was given keeps working.
 */
router.use('/lift-diagnostics', (req, res, next) => {
  if (req.method === 'GET' && /^\/[^/]+\/public$/.test(req.path)) return next();
  return requireAuth(req, res, () => {
    if (!liftConversationAvailableFor(req.user!.id, req.user!.email)) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CLIP_SECONDS = 60;
const CLIP_GRACE_SECONDS = 5;
// Shorter than the client's 180s poll timeout, so the server always decides a
// slow job's outcome before the client gives up — the thread the user saw and
// the transcript a resume replays can never disagree.
const VIDEO_STALE_MS = 150 * 1000;
// A claimed turn whose request died with the process (deploy restart mid
// verdict). Longer than the slowest legitimate turn (LONG_TIMEOUT 180s).
const TURN_STALE_MS = 10 * 60 * 1000;
const PENDING = '{"__pending":true}';
const VIDEO_PENDING = JSON.stringify({ video: { status: 'pending' } });
/** In-flight video jobs by session, so a Skip can abandon the analysis. */
const videoJobs = new Map<string, AbortController>();

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

// Unit is normalised rather than enum-gated: an older client sending "lbs"
// must still log its set (see the descriptive-enum incidents in meal logging).
const setSchema = z.object({
  weight: z.number().positive().max(1500),
  sets: z.number().int().min(1).max(20),
  reps: z.number().int().min(1).max(50),
  unit: z.string().max(8).transform((u) => (u.toLowerCase().startsWith('kg') ? 'kg' as const : 'lb' as const)),
});

const exerciseId = z.string().min(1).max(80);

const inputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lift'), lift: z.string().refine(isConversationLift, 'Unknown lift') }),
  z.object({ type: z.literal('main'), set: setSchema }),
  z.object({ type: z.literal('accessory'), exerciseId, set: setSchema }),
  z.object({ type: z.literal('untrained'), exerciseId }),
  z.object({ type: z.literal('skip'), exerciseId }),
  z.object({ type: z.literal('change'), exerciseId }),
  z.object({ type: z.literal('moveOn') }),
  z.object({ type: z.literal('skipVideo') }),
  z.object({
    type: z.literal('answer'),
    question: z.enum(['q0', 'q1', 'q2']),
    optionId: z.string().max(40).optional(),
    text: z.string().trim().min(1).max(1000),
    // Unknown flags are dropped, not rejected — an answer is never lost to a
    // client that knows a flag this server doesn't.
    flags: z.array(z.string().max(60)).max(10).default([]).transform((fs) => fs.filter((f) => KNOWN_FLAGS.has(f))),
  }),
  z.object({ type: z.literal('verdict') }),
  z.object({ type: z.literal('addNumbers') }),
]);

const turnBodySchema = z.object({
  clientTurnId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  input: inputSchema,
});

type TurnInput = z.infer<typeof inputSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

interface OwnedSession {
  id: string;
  userId: string | null;
  selectedLift: string;
  flow: string;
  workoutLogId: string | null;
  isPublic: boolean;
}

const SESSION_SELECT = { id: true, userId: true, selectedLift: true, flow: true, workoutLogId: true, isPublic: true } as const;

async function loadConversation(req: Request): Promise<OwnedSession & { selectedLift: ConversationLift }> {
  const id = req.params.id;
  if (!UUID.test(id)) throw new HttpError(404, 'Diagnostic not found');
  const session = await prisma.session.findUnique({ where: { id }, select: SESSION_SELECT });
  // 404 (not 403) on a foreign session: don't confirm the id exists.
  if (!session || session.userId !== req.user!.id) throw new HttpError(404, 'Diagnostic not found');
  if (session.flow !== 'conversation' || !isConversationLift(session.selectedLift)) {
    throw new HttpError(409, 'This diagnostic uses the previous flow');
  }
  return session as OwnedSession & { selectedLift: ConversationLift };
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function freshTier(userId: string): Promise<string> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
  return row?.tier ?? 'free';
}

async function latestVerdict(sessionId: string): Promise<Verdict | null> {
  const plan = await prisma.generatedPlan.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } });
  return parseJson<{ conversation_verdict?: Verdict }>(plan?.planJson, {}).conversation_verdict ?? null;
}

/**
 * The ordered transcript. `includeInFlight` keeps the turn currently being
 * applied (claimed, result not yet written) — the scorer and write-through
 * must see the set that triggered them; the client-facing views must not.
 */
async function turnRows(
  sessionId: string,
  opts: { includeInFlight?: boolean } = {},
): Promise<(TurnRow & { clientTurnId: string; seq: number; createdAt: Date; updatedAt: Date; id: string })[]> {
  const rows = await prisma.diagnosticTurn.findMany({ where: { sessionId }, orderBy: { seq: 'asc' } });
  return rows
    .filter((r) => opts.includeInFlight || r.resultJson !== PENDING)
    .map((r) => ({
      id: r.id,
      clientTurnId: r.clientTurnId,
      seq: r.seq,
      type: r.type,
      payload: parseJson(r.payloadJson, {}),
      result: parseJson(r.resultJson, {}),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
}

/**
 * Free turns whose request never finished (the process died mid-apply). Left
 * claimed, Retry would 409 forever and a verdict turn would have spent the
 * day's diagnosis for nothing — so they're dropped, and a verdict that never
 * produced a plan gives its credit back.
 */
async function releaseStrandedTurns(sessionId: string, userId: string) {
  const cutoff = new Date(Date.now() - TURN_STALE_MS);
  const stranded = await prisma.diagnosticTurn.findMany({
    where: { sessionId, resultJson: PENDING, updatedAt: { lt: cutoff } },
    select: { id: true, type: true },
  });
  if (!stranded.length) return;
  await prisma.diagnosticTurn.deleteMany({ where: { id: { in: stranded.map((t) => t.id) } } });
  if (stranded.some((t) => t.type === 'verdict') && !(await latestVerdict(sessionId)) && !(await isOnboarding(userId, sessionId))) {
    await refundDailyQuota(userId, await freshTier(userId), FEATURE.LIFT_DIAGNOSTIC).catch(() => {});
  }
}

/** Ladder lifts still without numbers, from the transcript as it stands now. */
function missingNow(lift: ConversationLift, turns: TurnRow[]): string[] {
  const inputs = gatherInputs('', lift, turns);
  return ladderIds(lift).filter((id) => {
    const status = inputs.accessories.get(id)?.status;
    return status !== 'logged' && status !== 'untrained';
  });
}

/**
 * The first diagnosis a user ever gets is their onboarding, and onboarding
 * never counts toward a daily limit (product decision 2026-09-13). It stays
 * onboarding until some session of theirs — this flow or the old wizard —
 * has produced a plan, so exactly one diagnosis is free of the quota.
 */
async function isOnboarding(userId: string, sessionId: string): Promise<boolean> {
  const sessions = await prisma.session.findMany({
    where: { userId },
    select: { id: true, plans: { take: 1, select: { id: true } } },
  });
  return !sessions.some((s) => s.id !== sessionId && s.plans.length > 0);
}

const sessionLocks = new Map<string, Promise<unknown>>();

/**
 * Run plan-writing work for one session one at a time. Two verdict taps from
 * two devices would otherwise both pass the "already have a verdict?" check
 * and both spend a diagnosis; serialized, the second finds the first's.
 * (Single backend process — an in-memory lock is sufficient.)
 */
async function serialized<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  sessionLocks.set(sessionId, tail);
  try {
    return await run;
  } finally {
    if (sessionLocks.get(sessionId) === tail) sessionLocks.delete(sessionId);
  }
}

function sendError(res: Response, err: unknown, label: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.errors });
  console.error(`[lift-diagnostic] ${label}:`, err);
  posthog.captureException?.(err);
  return res.status(500).json({ error: 'Something went wrong' });
}

// ─── Verdict generation ─────────────────────────────────────────────────────

async function generateVerdict(session: OwnedSession & { selectedLift: ConversationLift }, userId: string): Promise<Verdict> {
  const lift = session.selectedLift;
  const turns = await turnRows(session.id, { includeInFlight: true });
  const inputs = gatherInputs(session.id, lift, turns);
  if (!inputs.main) throw new HttpError(409, 'Log a working set first');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trainingAge: true, equipment: true, constraintsText: true, weightKg: true },
  });

  const snapshots = [
    { exerciseId: lift, exerciseName: exerciseName(lift), set: inputs.main },
    ...[...inputs.accessories]
      .filter(([, r]) => r.status === 'logged' && r.set)
      .map(([id, r]) => ({ exerciseId: id, exerciseName: exerciseName(id), set: r.set! })),
  ].map((s) => ({
    exerciseId: s.exerciseId,
    exerciseName: s.exerciseName,
    weight: toLbs(s.set),
    sets: s.set.sets,
    repsSchema: String(s.set.reps),
  }));

  const plan = await generateWorkoutPlan({
    selectedLift: lift,
    trainingAge: user?.trainingAge ?? undefined,
    equipment: user?.equipment ?? undefined,
    constraints: user?.constraintsText ?? undefined,
    bodyweightLbs: user?.weightKg ? kgToLb(user.weightKg) : undefined,
    sessionFlags: flagsFrom(inputs),
    snapshots,
    conversationHistory: conversationFor(inputs),
  });

  const ds = plan.diagnostic_signals;
  const verdict = buildVerdict(
    inputs,
    {
      indices: ds.indices as Record<string, { value: number } | undefined>,
      primary_phase: ds.primary_phase,
      hypothesis_scores: ds.hypothesis_scores,
      efficiency_score: ds.efficiency_score,
      validation_test: plan.validation_test,
    },
    plan,
  );

  let planText = '';
  try {
    planText = formatPlanAsText(plan);
  } catch {
    /* text rendering is a convenience for the legacy chat; never fail the verdict on it */
  }
  await prisma.generatedPlan.create({
    data: { sessionId: session.id, planJson: JSON.stringify({ ...plan, conversation_verdict: verdict }), planText },
  });
  return verdict;
}

async function recordSet(session: OwnedSession & { selectedLift: ConversationLift }, userId: string, exercise: string, set: z.infer<typeof setSchema>) {
  // One snapshot per exercise per session — the latest set wins. This also
  // keeps a retried turn (whose first attempt logged the set, then failed
  // re-scoring) from leaving a duplicate row behind.
  await prisma.exerciseSnapshot.deleteMany({ where: { sessionId: session.id, exerciseId: exercise } });
  await prisma.exerciseSnapshot.create({
    data: { sessionId: session.id, exerciseId: exercise, weight: toLbs(set), sets: set.sets, repsSchema: String(set.reps) },
  });
  try {
    const inputs = gatherInputs(session.id, session.selectedLift, await turnRows(session.id, { includeInFlight: true }));
    await writeThroughWorkingSets({ userId, sessionId: session.id, workoutLogId: session.workoutLogId, lift: session.selectedLift, inputs });
  } catch (err) {
    // The set is in the diagnosis either way; a training-log hiccup must not
    // turn into a "Didn't send" on a set the server already has.
    console.warn('[lift-diagnostic] write-through failed:', err);
  }
}

/** Effects of one turn. Runs after the turn row is claimed, so it sees itself in turnRows(). */
async function applyTurn(
  session: OwnedSession & { selectedLift: ConversationLift },
  userId: string,
  input: TurnInput,
): Promise<Record<string, unknown>> {
  switch (input.type) {
    case 'main':
      await recordSet(session, userId, session.selectedLift, input.set);
      return {};

    case 'accessory':
      return serialized(session.id, async () => {
        const verdict = await latestVerdict(session.id);
        // Only a NEW ratio re-scores; re-sending a lift that already had numbers
        // at the verdict just updates the set. Bounds plan generation per
        // session to the ladder's length.
        const wasMissing = !verdict || verdict.missingLifts.includes(input.exerciseId);
        await recordSet(session, userId, input.exerciseId, input.set);
        // A set after a verdict is a late ratio: re-score the SAME session (§7).
        if (verdict) return { verdict: wasMissing ? await generateVerdict(session, userId) : verdict };
        return {};
      });

    case 'answer': {
      // q2 always closes the interview (a video removes q0, never q2). The
      // daily limit blocks here, with the answer saved (§8).
      if (input.question !== 'q2' || (await latestVerdict(session.id))) return {};
      if (await isOnboarding(userId, session.id)) return {};
      const quota = await peekDailyQuota(userId, await freshTier(userId), FEATURE.LIFT_DIAGNOSTIC);
      return quota.allowed ? {} : { limitReached: true };
    }

    case 'verdict':
      return serialized(session.id, async () => {
        // A second tap (or a replayed client) never spends another diagnosis.
        const existing = await latestVerdict(session.id);
        if (existing) return { verdict: existing };
        // Onboarding diagnoses skip the quota entirely.
        if (await isOnboarding(userId, session.id)) return { verdict: await generateVerdict(session, userId) };
        const tier = await freshTier(userId);
        const quota = await consumeDailyQuota(userId, tier, FEATURE.LIFT_DIAGNOSTIC);
        if (!quota.allowed) return { limitReached: true };
        try {
          return { verdict: await generateVerdict(session, userId) };
        } catch (err) {
          await refundDailyQuota(userId, tier, FEATURE.LIFT_DIAGNOSTIC).catch(() => {});
          throw err;
        }
      });

    case 'skipVideo': {
      // Skipped while the clip was uploading or being analyzed: abandon the
      // job and mark its turn aborted, so a late result can never land in a
      // transcript the user has already moved past.
      videoJobs.get(session.id)?.abort();
      videoJobs.delete(session.id);
      await prisma.diagnosticTurn.updateMany({
        where: { sessionId: session.id, type: 'video', resultJson: VIDEO_PENDING },
        data: { resultJson: JSON.stringify({ video: { status: 'aborted', result: null } }) },
      });
      return {};
    }

    default:
      return {};
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get('/lift-diagnostics', requireAuth, async (req, res) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, selectedLift: true, flow: true, updatedAt: true, plans: { orderBy: { createdAt: 'desc' }, take: 1, select: { planJson: true } } },
    });
    // A thread that re-opened for "Add the missing numbers" and hasn't closed
    // again is in progress, so Home offers Resume rather than the old report.
    const conversationIds = sessions.filter((s) => s.flow === 'conversation').map((s) => s.id);
    const turnTypes = conversationIds.length
      ? await prisma.diagnosticTurn.findMany({
          where: { sessionId: { in: conversationIds } },
          orderBy: { seq: 'asc' },
          select: { sessionId: true, type: true },
        })
      : [];
    const rescoring = new Set<string>();
    for (const t of turnTypes) {
      if (t.type === 'addNumbers') rescoring.add(t.sessionId);
      else if (t.type === 'accessory' || t.type === 'skip' || t.type === 'moveOn') rescoring.delete(t.sessionId);
    }
    const rows = sessions.map((s) => {
      const plan = parseJson<any>(s.plans[0]?.planJson, null);
      const v: Verdict | undefined = plan?.conversation_verdict;
      const legacy = plan?.diagnosis?.[0];
      return {
        id: s.id,
        lift: s.selectedLift,
        flow: s.flow === 'conversation' ? 'conversation' : 'wizard',
        status: plan && !rescoring.has(s.id) ? 'complete' : 'in_progress',
        grade: v?.grade ?? null,
        confidence: v?.confidence ?? (typeof legacy?.confidence === 'number' ? Math.round(legacy.confidence * 100) : null),
        limiter: v?.limiter ?? (legacy ? { phase: 'unknown', hypothesisKey: legacy.limiter ?? null, hypothesisLabel: legacy.limiterName ?? null } : null),
        updatedAt: s.updatedAt.toISOString(),
      };
    });
    res.json({ diagnostics: rows });
  } catch (err) {
    sendError(res, err, 'list');
  }
});

router.get('/lift-diagnostics/:id', requireAuth, async (req, res) => {
  try {
    const session = await loadConversation(req);
    const [turns, verdict, prefs] = await Promise.all([
      turnRows(session.id),
      latestVerdict(session.id),
      prisma.user.findUnique({ where: { id: req.user!.id }, select: { unitPreference: true } }),
    ]);
    let reached = false;
    if (!verdict && !(await isOnboarding(req.user!.id, session.id))) {
      const quota = await peekDailyQuota(req.user!.id, await freshTier(req.user!.id), FEATURE.LIFT_DIAGNOSTIC);
      reached = !quota.allowed;
    }
    const sessionRow = await prisma.session.findUnique({ where: { id: session.id }, select: { createdAt: true } });
    res.json({
      session: { id: session.id, lift: session.selectedLift, flow: session.flow, createdAt: sessionRow?.createdAt },
      turns: turns.map((t) => ({
        clientTurnId: t.clientTurnId,
        seq: t.seq,
        input: { type: t.type, ...t.payload },
        result: t.result,
        createdAt: t.createdAt.toISOString(),
      })),
      limit: { reached },
      unit: prefs?.unitPreference === 'metric' ? 'kg' : 'lb',
    });
  } catch (err) {
    sendError(res, err, 'load');
  }
});

router.post('/lift-diagnostics/:id/turns', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  let claimedId: string | null = null;
  try {
    const { clientTurnId, input } = turnBodySchema.parse(req.body);
    const id = req.params.id;
    if (!UUID.test(id)) throw new HttpError(404, 'Diagnostic not found');

    // The lift chip creates the session under the client's id.
    const exists = await prisma.session.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      if (input.type !== 'lift') throw new HttpError(404, 'Diagnostic not found');
      try {
        await prisma.session.create({ data: { id, userId, selectedLift: input.lift, flow: 'conversation' } });
        posthog.capture({ distinctId: userId, event: 'diagnostic_session_created', properties: { session_id: id, selected_lift: input.lift, flow: 'conversation' } });
      } catch {
        /* a concurrent retry created it — ownership is checked below */
      }
    }
    const session = await loadConversation(req);

    await releaseStrandedTurns(id, userId);

    // Idempotency: a retry of a turn the server already has replays its result.
    const prior = await prisma.diagnosticTurn.findUnique({
      where: { sessionId_clientTurnId: { sessionId: id, clientTurnId } },
    });
    if (prior) {
      if (prior.resultJson === PENDING) throw new HttpError(409, 'That message is still sending');
      return res.json({ result: parseJson(prior.resultJson, {}) });
    }

    const existing = await turnRows(id);
    if (input.type === 'lift' && existing.length > 0) throw new HttpError(409, 'Lift already chosen');
    if (input.type !== 'lift' && existing.length === 0) throw new HttpError(409, 'Pick a lift first');
    if ('exerciseId' in input && !ladderIds(session.selectedLift).includes(input.exerciseId)) {
      throw new HttpError(400, 'That lift is not part of this diagnostic');
    }

    const last = await prisma.diagnosticTurn.findFirst({ where: { sessionId: id }, orderBy: { seq: 'desc' }, select: { seq: true } });
    const { type, ...payload } = input;
    const claimed = await prisma.diagnosticTurn
      .create({
        data: { sessionId: id, clientTurnId, seq: (last?.seq ?? -1) + 1, type, payloadJson: JSON.stringify(payload), resultJson: PENDING },
        select: { id: true },
      })
      .catch((err: any) => {
        // Unique (sessionId, clientTurnId) or (sessionId, seq): a concurrent
        // request claimed it first. The client's Retry resolves either way.
        if (err?.code === 'P2002') throw new HttpError(409, 'That message is still sending');
        throw err;
      });
    claimedId = claimed.id;

    const result = await applyTurn(session, userId, input);
    await prisma.diagnosticTurn.update({ where: { id: claimed.id }, data: { resultJson: JSON.stringify(result) } });
    claimedId = null;
    await prisma.session.update({ where: { id }, data: { updatedAt: new Date() } });

    if (result.verdict) {
      const v = result.verdict as Verdict;
      posthog.capture({
        distinctId: userId,
        event: 'workout_plan_generated',
        properties: { session_id: id, selected_lift: session.selectedLift, flow: 'conversation', grade: v.grade, confidence: v.confidence },
      });
    }
    res.json({ result });
  } catch (err) {
    if (claimedId) await prisma.diagnosticTurn.delete({ where: { id: claimedId } }).catch(() => {});
    sendError(res, err, 'turn');
  }
});

const MAX_MB = parseInt(process.env.DIAGNOSTIC_VIDEO_MAX_MB || process.env.FORM_VIDEO_MAX_MB || '200', 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (file.mimetype?.startsWith('video/') ? cb(null, true) : cb(new Error('Only video uploads are supported'))),
});
const uploadVideo = (req: any, res: any, next: any) =>
  upload.single('video')(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Video is too large. Keep it under ${MAX_MB}MB.` });
    return res.status(400).json({ error: err?.message || 'Invalid video upload' });
  });

function isAdult(dob: Date | null | undefined): boolean {
  if (!dob || !Number.isFinite(dob.getTime())) return false;
  const threshold = new Date();
  threshold.setFullYear(threshold.getFullYear() - 18);
  return dob.getTime() <= threshold.getTime();
}

router.post('/lift-diagnostics/:id/video', requireAuth, aiLimiter, uploadVideo, async (req, res) => {
  const userId = req.user!.id;
  try {
    const session = await loadConversation(req);
    const clientTurnId = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/).parse(req.body?.clientTurnId);

    const prior = await prisma.diagnosticTurn.findUnique({
      where: { sessionId_clientTurnId: { sessionId: session.id, clientTurnId } },
    });
    if (prior) return res.status(202).json({ result: parseJson(prior.resultJson, {}) });

    if (!req.file) throw new HttpError(400, 'Attach a clip as the "video" field');
    const turns = await turnRows(session.id);
    if (!turns.some((t) => t.type === 'main')) throw new HttpError(409, 'Log a working set first');
    if (turns.some((t) => t.type === 'video' && t.result?.video?.status !== 'aborted')) {
      throw new HttpError(409, 'This diagnostic already has a video');
    }

    // Trim window from the in-app trimmer (Android/web; iOS trims natively
    // before upload). Cut first, so every later step sees only the chosen rep.
    let videoBuffer = req.file.buffer;
    const trim = parseTrimWindow(req.body?.trimStart, req.body?.trimEnd, MAX_CLIP_SECONDS + CLIP_GRACE_SECONDS);
    if (trim) {
      const trimmed = await trimVideoBuffer(videoBuffer, req.file.mimetype, trim.startSec, trim.endSec);
      if (trimmed) videoBuffer = trimmed;
    }

    const durationSec = await probeBufferDurationSec(videoBuffer, req.file.mimetype);
    if (durationSec != null && durationSec > MAX_CLIP_SECONDS + CLIP_GRACE_SECONDS) {
      throw new HttpError(400, 'Keep the clip under 60 seconds — one working rep is plenty');
    }

    const clientDuration = Number(req.body?.durationSec);
    const pending = { video: { status: 'pending' } };
    const last = await prisma.diagnosticTurn.findFirst({ where: { sessionId: session.id }, orderBy: { seq: 'desc' }, select: { seq: true } });
    const turn = await prisma.diagnosticTurn
      .create({
      data: {
        sessionId: session.id,
        clientTurnId,
        seq: (last?.seq ?? -1) + 1,
        type: 'video',
        payloadJson: JSON.stringify({ durationSec: Number.isFinite(clientDuration) ? clientDuration : durationSec }),
        resultJson: JSON.stringify(pending),
      },
      select: { id: true },
    })
      .catch((err: any) => {
        if (err?.code === 'P2002') throw new HttpError(409, 'That clip is still uploading');
        throw err;
      });
    await prisma.session.update({ where: { id: session.id }, data: { updatedAt: new Date() } });

    // Stills follow the form-video rules: explicit opt-in AND 18+.
    const wantsFrame = String(req.body?.saveFrames ?? '') === '1';
    const dob = wantsFrame ? (await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } }))?.dateOfBirth : null;
    const mimeType = req.file.mimetype;
    const job = new AbortController();
    videoJobs.get(session.id)?.abort();
    videoJobs.set(session.id, job);

    // Fire-and-forget; MUST be caught — an unhandled rejection can kill the process.
    runDiagnosticVideo({ userId, lift: session.selectedLift, videoBuffer, mimeType, framesAllowed: wantsFrame && isAdult(dob), signal: job.signal })
      .finally(() => {
        if (videoJobs.get(session.id) === job) videoJobs.delete(session.id);
      })
      .then((result) =>
        // Only while still pending: a job that outlived the stale window was
        // already reported failed, and the user has moved on to the interview.
        prisma.diagnosticTurn.updateMany({
          where: { id: turn.id, resultJson: JSON.stringify(pending) },
          data: { resultJson: JSON.stringify({ video: result ? { status: 'complete', result } : { status: 'failed', result: null } }) },
        }),
      )
      .catch((err) => console.error('[lift-diagnostic] video job error:', err));

    posthog.capture({ distinctId: userId, event: 'diagnostic_video_attached', properties: { session_id: session.id, duration_sec: durationSec } });
    res.status(202).json({ result: pending });
  } catch (err) {
    sendError(res, err, 'video');
  }
});

router.get('/lift-diagnostics/:id/video/:clientTurnId', requireAuth, async (req, res) => {
  try {
    const session = await loadConversation(req);
    const turn = await prisma.diagnosticTurn.findUnique({
      where: { sessionId_clientTurnId: { sessionId: session.id, clientTurnId: req.params.clientTurnId } },
    });
    if (!turn || turn.type !== 'video') throw new HttpError(404, 'No video for that turn');
    const result = parseJson<any>(turn.resultJson, {});
    let video = result.video ?? { status: 'failed', result: null };
    // A job that outlived a restart never reports back — fail it so the
    // interview can take over instead of spinning forever.
    if (video.status === 'pending' && Date.now() - turn.updatedAt.getTime() > VIDEO_STALE_MS) {
      video = { status: 'failed', result: null };
      await prisma.diagnosticTurn.updateMany({
        where: { id: turn.id, resultJson: turn.resultJson },
        data: { resultJson: JSON.stringify({ video }) },
      });
    }
    res.json(video);
  } catch (err) {
    sendError(res, err, 'video status');
  }
});

router.get('/lift-diagnostics/:id/report', requireAuth, async (req, res) => {
  try {
    const session = await loadConversation(req);
    const verdict = await latestVerdict(session.id);
    if (!verdict) throw new HttpError(404, 'No verdict yet');
    const current = { ...verdict, missingLifts: missingNow(session.selectedLift, await turnRows(session.id)) };
    res.json({ verdict: current, isPublic: session.isPublic });
  } catch (err) {
    sendError(res, err, 'report');
  }
});

router.post('/lift-diagnostics/:id/share', requireAuth, async (req, res) => {
  try {
    const session = await loadConversation(req);
    if (!(await latestVerdict(session.id))) throw new HttpError(409, 'Nothing to share yet');
    await prisma.session.update({ where: { id: session.id }, data: { isPublic: true } });
    posthog.capture({ distinctId: req.user!.id, event: 'session_shared', properties: { session_id: session.id, flow: 'conversation' } });
    const base = (process.env.FRONTEND_URL || 'https://axiomtraining.io').replace(/\/$/, '');
    res.json({ shareUrl: `${base}/diagnostics/${session.id}` });
  } catch (err) {
    sendError(res, err, 'share');
  }
});

router.get('/lift-diagnostics/:id/public', async (req, res) => {
  try {
    const id = req.params.id;
    if (!UUID.test(id)) throw new HttpError(404, 'Report not found');
    const session = await prisma.session.findUnique({ where: { id }, select: { isPublic: true, userId: true, flow: true } });
    if (!session || !session.isPublic || session.flow !== 'conversation') throw new HttpError(404, 'Report not found');
    const verdict = await latestVerdict(id);
    if (!verdict) throw new HttpError(404, 'Report not found');
    res.json({ verdict: presentVerdict(verdict, { publicView: true }) });
  } catch (err) {
    sendError(res, err, 'public');
  }
});

export default router;
