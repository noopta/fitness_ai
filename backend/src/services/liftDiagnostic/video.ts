// The diagnostic's optional video (handoff §6): one working rep, side-on,
// measured for sticking point, elbow flare and bar drift.
//
// Reuses the form-video plumbing end to end — one GCS upload, the CSAM /
// minor screening pass run concurrently (nothing is shown until it comes back
// clean), the 18+ + opt-in rule for keeping a still — and adds a small,
// structured measurement pass. Failure of any kind resolves to `null`, which
// the client turns into the full three-question interview. Never a dead end.

import { Type } from '@google/genai';
import { client, assertNotBlocked, SAFETY_SETTINGS, uploadFormVideo } from '../geminiService.js';
import { screenFormVideo, recordScreenVerdict } from '../formVideoScreeningService.js';
import { extractStillAt, probeDurationSec } from '../formFrameService.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LIFT_NAMES, LIFT_PHASES, liftFamily, type ConversationLift } from './policy.js';
import type { VideoResult } from './verdict.js';

/**
 * Deliberately NOT the Form Analysis report (2.5-pro, nine fields, ~18-25s).
 * This pass answers three numbers and a phase, so it runs the quick-model
 * setup the onboarding hook measured at ~6s: flash, thinking off, a tiny
 * output. Latency is driven by output + thinking tokens, not clip length or
 * fps (see geminiService QUICK_MODEL / QUICK_SAMPLE_FPS notes).
 */
const MODEL = process.env.DIAGNOSTIC_VIDEO_MODEL ?? 'gemini-2.5-flash';
/**
 * 4 fps stays: a stall measured in tenths of a second needs it, and at 1 fps
 * Vertex confabulates *when* things happen (geminiService VIDEO_SAMPLE_FPS).
 * fps costs input tokens, not wall-clock.
 */
const FPS = Number(process.env.DIAGNOSTIC_VIDEO_FPS ?? 4);

interface Measurement {
  liftVisible: boolean;
  stickingPhase: string | null;
  stickingPointSec: number | null;
  stickingTimestampSec: number | null;
  elbowFlareDeg: number | null;
  barDriftCm: number | null;
}

function schemaFor(lift: ConversationLift) {
  return {
    type: Type.OBJECT,
    required: ['liftVisible', 'stickingPhase', 'stickingPointSec', 'stickingTimestampSec', 'elbowFlareDeg', 'barDriftCm'],
    properties: {
      liftVisible: { type: Type.BOOLEAN, description: `True only if a full working rep of ${LIFT_NAMES[lift]} is clearly visible.` },
      stickingPhase: {
        type: Type.STRING,
        nullable: true,
        enum: LIFT_PHASES[lift],
        description: 'Movement phase where bar speed is slowest on the hardest rep. Null if no clear slow-down.',
      },
      stickingPointSec: { type: Type.NUMBER, nullable: true, description: 'Seconds the bar spends near-stalled at that point.' },
      stickingTimestampSec: { type: Type.NUMBER, nullable: true, description: 'Seconds from clip start at the slowest moment.' },
      elbowFlareDeg: {
        type: Type.NUMBER,
        nullable: true,
        description: 'Pressing lifts only: how many degrees the elbows open away from the torso between the bottom and the sticking point. Null for non-pressing lifts or if not visible side-on.',
      },
      barDriftCm: { type: Type.NUMBER, nullable: true, description: 'Horizontal deviation of the bar from its starting line at the sticking point, in centimetres, estimated from the plate diameter (45 cm). Null if not measurable.' },
    },
  };
}

const SYSTEM = `Quick measurement pass for a strength diagnostic — numbers only, no coaching. Watch the hardest rep. Return: the phase id where the bar is slowest, how long it stalls, when, and (if visible side-on) elbow flare and horizontal bar drift using a 45 cm plate as scale.
Null any value you cannot clearly see; never estimate. Do not comment on the lifter's body, appearance or health.`;

export async function measureDiagnosticVideo(
  fileUri: string,
  mimeType: string,
  lift: ConversationLift,
): Promise<Measurement> {
  const res = await client().models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: schemaFor(lift),
      safetySettings: SAFETY_SETTINGS,
      // Thinking off: ~8s of latency for a job that's six fields of structured output.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 512,
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: `Lift: ${LIFT_NAMES[lift]}. Phases in order: ${LIFT_PHASES[lift].join(', ')}.` },
          { fileData: { mimeType, fileUri }, videoMetadata: { fps: FPS } },
        ],
      },
    ],
  });
  assertNotBlocked(res);
  const raw = (res.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(raw) as Measurement;
}

/** Validate a model measurement into a VideoResult, or null when it's not usable. */
export function toVideoResult(m: Measurement, lift: ConversationLift, frameB64: string | null): VideoResult | null {
  if (!m || !m.liftVisible) return null;
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
  const phase = typeof m.stickingPhase === 'string' && LIFT_PHASES[lift].includes(m.stickingPhase) ? m.stickingPhase : null;
  const result: VideoResult = {
    stickingPhase: phase,
    stickingPointSec: num(m.stickingPointSec, 10),
    elbowFlareDeg: liftFamily(lift) === 'press' ? num(m.elbowFlareDeg, 90) : null,
    barDriftCm: num(m.barDriftCm, 60),
    frameUrl: frameB64 ? `data:image/jpeg;base64,${frameB64}` : null,
  };
  const measuredSomething =
    result.stickingPhase || result.stickingPointSec != null || result.elbowFlareDeg != null || result.barDriftCm != null;
  return measuredSomething ? result : null;
}

/**
 * Full pipeline for one clip. Resolves to a VideoResult, or null for "fall
 * back to the interview" (unreadable clip, screening refusal, model error).
 */
export async function runDiagnosticVideo(opts: {
  userId: string;
  lift: ConversationLift;
  videoBuffer: Buffer;
  mimeType: string;
  framesAllowed: boolean;
}): Promise<VideoResult | null> {
  let upload: { fileUri: string; cleanup: () => void } | null = null;
  let preserve = false;
  try {
    upload = await uploadFormVideo(opts.videoBuffer, opts.mimeType);
    // allSettled, and screening acted on first: a safety block makes the
    // measurement call THROW — exactly the clip whose screening verdict must
    // still be recorded (and, for a quarantine, preserved).
    const [screened, measured] = await Promise.allSettled([
      screenFormVideo(upload.fileUri, opts.mimeType),
      measureDiagnosticVideo(upload.fileUri, opts.mimeType, opts.lift),
    ]);
    if (screened.status === 'rejected') throw screened.reason;
    const screen = screened.value;
    if (screen.action !== 'allow') {
      preserve = screen.action === 'quarantine';
      await recordScreenVerdict({
        userId: opts.userId,
        surface: 'lift_diagnostic_video',
        verdict: screen,
        preservedObject: preserve ? upload.fileUri : null,
      });
      return null;
    }
    if (measured.status === 'rejected') throw measured.reason;
    const measurement = measured.value;
    const frame =
      opts.framesAllowed && measurement?.liftVisible && typeof measurement.stickingTimestampSec === 'number'
        ? await extractStillAt(opts.videoBuffer, opts.mimeType, measurement.stickingTimestampSec)
        : null;
    return toVideoResult(measurement, opts.lift, frame);
  } catch (err: any) {
    console.warn(`[lift-diagnostic] video pass failed, falling back to interview: ${err?.message ?? err}`);
    return null;
  } finally {
    if (preserve) console.error(`[lift-diagnostic] object preserved for review, cleanup skipped: ${upload?.fileUri}`);
    else upload?.cleanup();
  }
}

/** Clip length from the bytes themselves, so the 60s cap isn't client-trust. Null if unreadable. */
export async function probeBufferDurationSec(videoBuffer: Buffer, mimeType: string): Promise<number | null> {
  let workDir: string | null = null;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), 'diag-probe-'));
    const ext = (mimeType.split('/')[1] || 'mp4').replace('quicktime', 'mov');
    const videoPath = path.join(workDir, `clip.${ext}`);
    await writeFile(videoPath, videoBuffer);
    return await probeDurationSec(videoPath);
  } catch {
    return null;
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
