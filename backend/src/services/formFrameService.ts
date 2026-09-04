/**
 * Reference stills for form analysis — extract the frame a fault happens on
 * and highlight the region the coach is talking about.
 *
 * ── Why frames live in the analysis row ──────────────────────────────────────
 * These are pictures of a user's body, often filmed at home. The obvious home
 * for them is GCS (blobStore is right there), and it is the wrong one: nothing
 * in this codebase deletes a GCS object. `DELETE /auth/account` is thorough
 * about rows and silent about blobs, so every frame would outlive the account
 * it belongs to, and "we delete your data" would quietly stop being true.
 *
 * Storing the JPEGs base64 inside FormAnalysis.analysisJson makes that failure
 * structurally impossible: the row already cascades on user delete, so the
 * frames cannot outlive the user, the analysis, or a per-analysis delete. It
 * also means blobStore's content-addressed dedup — where two users sharing
 * byte-identical images share one object — never gets pointed at body imagery,
 * which is a dedup scheme and an erasure right in direct conflict.
 *
 * Base64-in-JSON is normally the thing to avoid here (it is what made the feed
 * ship 2.88MB pages). The access pattern is what makes it safe in this one
 * spot: `GET /form-analysis` selects explicit columns and never reads
 * analysisJson, so frames travel only on a single-item detail fetch, once,
 * on demand. No duplication across rows, no amplification.
 *
 * The cost ceiling is real but distant — ~100KB per analysis, so ~1GB at
 * 10,000 analyses. Past that, swap `b64` for a storage key and resolve at read
 * time; the frames are behind a JSON field precisely so that stays contained.
 *
 * ── Why the boxes are drawn loosely ──────────────────────────────────────────
 * Calibration (see VIDEO_SAMPLE_FPS in geminiService) puts the model's boxes
 * within ~2% of frame dimensions at 4 fps — about 25px on a 1280px-tall clip.
 * Good, not exact. So we render a rounded corner-bracket rather than a tight
 * rectangle: brackets read as "look in here", which is what the data supports,
 * where a tight box claims a precision we do not have.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FormWeakness } from './geminiService.js';

const execFileAsync = promisify(execFile);

/** Hard cap on stills per analysis. Three arrows is a coaching point; ten is a diagram. */
export const MAX_FRAMES = 3;

/** Rendered width. 540px is retina-adequate on phones at ~25KB a frame. */
const FRAME_WIDTH = 540;

/** JPEG quality (ffmpeg -q:v, 2=best .. 31=worst). 6 is visually clean at this width. */
const FRAME_QUALITY = 6;

/** ffmpeg is killed after this long. A single seek+encode measures ~0.5s. */
const FFMPEG_TIMEOUT_MS = 15_000;

export interface ReferenceFrame {
  /** Index into WorkoutVideoAnalysis.weaknesses that this still illustrates. */
  weaknessIndex: number;
  /** Seconds from clip start the frame was taken at. */
  timestampSec: number;
  /** Base64 JPEG (no data: prefix — the client adds it). */
  b64: string;
  /** Present only when a region was highlighted; mirrors the model's box2d. */
  box2d?: number[];
}

/**
 * True when the value is a usable [ymin, xmin, ymax, xmax] in 0-1000 with
 * positive area. The model returns null for unlocalisable faults by design,
 * and a malformed box should drop the highlight rather than the whole frame.
 */
export function isValidBox(box: unknown): box is number[] {
  if (!Array.isArray(box) || box.length !== 4) return false;
  if (!box.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)) return false;
  const [ymin, xmin, ymax, xmax] = box;
  return ymax > ymin && xmax > xmin;
}

/**
 * Pick which weaknesses get a still: those carrying a usable timestamp, worst
 * first, capped at MAX_FRAMES. Severity ordering matters because the model is
 * asked to anchor up to three faults but not told which three we will render.
 */
export function selectAnchoredWeaknesses(
  weaknesses: FormWeakness[] | undefined,
  durationSec: number | null,
): { weakness: FormWeakness; index: number }[] {
  const rank: Record<string, number> = { major: 0, moderate: 1, minor: 2 };
  return (weaknesses ?? [])
    .map((weakness, index) => ({ weakness, index }))
    .filter(({ weakness }) => {
      const t = weakness.timestampSec;
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return false;
      // A timestamp past the end of the clip is a hallucinated anchor; ffmpeg
      // would silently hand back the last frame, which is worse than nothing.
      if (durationSec != null && t > durationSec) return false;
      return true;
    })
    .sort((a, b) => (rank[a.weakness.severity] ?? 3) - (rank[b.weakness.severity] ?? 3))
    .slice(0, MAX_FRAMES);
}

/** Clip duration in seconds via ffprobe, or null if it can't be read. */
export async function probeDurationSec(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath],
      { timeout: FFMPEG_TIMEOUT_MS },
    );
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * Build the ffmpeg filter chain for one frame: downscale, then draw corner
 * brackets around the region of interest if we have one.
 *
 * Bracket geometry is expressed against the SCALED frame via `iw`/`ih`, so the
 * normalized 0-1000 box maps correctly whatever the source resolution was.
 * Each corner is two short drawbox strokes; a filled drawbox with `t=<n>` would
 * give a full rectangle, which is the look we are deliberately avoiding.
 */
export function buildFilter(box2d: number[] | null): string {
  const filters = [`scale=${FRAME_WIDTH}:-2`];
  if (!box2d) return filters.join(',');

  const [ymin, xmin, ymax, xmax] = box2d;
  const x0 = xmin / 1000, x1 = xmax / 1000;
  const y0 = ymin / 1000, y1 = ymax / 1000;
  // Bracket arms span a quarter of each edge, so the shape scales with the
  // region instead of looking stubby on large boxes and clumsy on small ones.
  const armX = ((x1 - x0) / 4).toFixed(5);
  const armY = ((y1 - y0) / 4).toFixed(5);
  const stroke = 4;
  const color = '#FF3B30@0.95';

  const bar = (x: string, y: string, w: string, h: string) =>
    `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`;

  const X0 = `${x0.toFixed(5)}*iw`, X1 = `${x1.toFixed(5)}*iw`;
  const Y0 = `${y0.toFixed(5)}*ih`, Y1 = `${y1.toFixed(5)}*ih`;
  const AX = `${armX}*iw`, AY = `${armY}*ih`;

  filters.push(
    // top-left
    bar(X0, Y0, AX, `${stroke}`),
    bar(X0, Y0, `${stroke}`, AY),
    // top-right
    bar(`${X1}-${AX}`, Y0, AX, `${stroke}`),
    bar(`${X1}-${stroke}`, Y0, `${stroke}`, AY),
    // bottom-left
    bar(X0, `${Y1}-${stroke}`, AX, `${stroke}`),
    bar(X0, `${Y1}-${AY}`, `${stroke}`, AY),
    // bottom-right
    bar(`${X1}-${AX}`, `${Y1}-${stroke}`, AX, `${stroke}`),
    bar(`${X1}-${stroke}`, `${Y1}-${AY}`, `${stroke}`, AY),
  );
  return filters.join(',');
}

/**
 * Extract one annotated still. Returns base64 JPEG, or null on any ffmpeg
 * failure — a missing still degrades the feature, it must never fail the
 * analysis the user is waiting on.
 */
async function extractOne(
  videoPath: string,
  workDir: string,
  timestampSec: number,
  box2d: number[] | null,
): Promise<string | null> {
  const outPath = path.join(workDir, `${randomBytes(6).toString('hex')}.jpg`);
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-v', 'error',
        // -ss BEFORE -i: ffmpeg seeks by keyframe then decodes forward to the
        // exact timestamp. Orders of magnitude faster than decoding the whole
        // clip, and still frame-accurate in ffmpeg 5+.
        '-ss', timestampSec.toFixed(3),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', buildFilter(box2d),
        '-q:v', String(FRAME_QUALITY),
        '-f', 'image2',
        outPath,
      ],
      { timeout: FFMPEG_TIMEOUT_MS },
    );
    return (await readFile(outPath)).toString('base64');
  } catch (err: any) {
    console.warn(`[form-frames] extract at ${timestampSec}s failed: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Extract reference stills for the anchored weaknesses in an analysis.
 *
 * Best-effort throughout: any failure yields fewer frames (or none), never a
 * thrown error. The caller has a complete, useful analysis in hand already and
 * must not lose it because ffmpeg had a bad day.
 */
export async function extractReferenceFrames(
  videoBuffer: Buffer,
  mimeType: string,
  weaknesses: FormWeakness[] | undefined,
): Promise<ReferenceFrame[]> {
  if (!weaknesses?.some((w) => typeof w.timestampSec === 'number')) return [];

  let workDir: string | null = null;
  try {
    // ffmpeg needs a seekable input; piping to stdin defeats -ss entirely.
    workDir = await mkdtemp(path.join(tmpdir(), 'form-frames-'));
    const ext = (mimeType.split('/')[1] || 'mp4').replace('quicktime', 'mov');
    const videoPath = path.join(workDir, `clip.${ext}`);
    await writeFile(videoPath, videoBuffer);

    const durationSec = await probeDurationSec(videoPath);
    const selected = selectAnchoredWeaknesses(weaknesses, durationSec);
    if (selected.length === 0) return [];

    const frames: ReferenceFrame[] = [];
    // Sequential on purpose: this box is 2 vCPU and shared with prod, and
    // three 0.5s encodes back to back are cheaper than three at once.
    for (const { weakness, index } of selected) {
      const box = isValidBox(weakness.box2d) ? (weakness.box2d as number[]) : null;
      const b64 = await extractOne(videoPath, workDir, weakness.timestampSec!, box);
      if (!b64) continue;
      frames.push({
        weaknessIndex: index,
        timestampSec: weakness.timestampSec!,
        b64,
        ...(box ? { box2d: box } : {}),
      });
    }
    // Restore chronological order — selection ran worst-fault-first.
    frames.sort((a, b) => a.timestampSec - b.timestampSec);
    return frames;
  } catch (err: any) {
    console.warn(`[form-frames] extraction skipped: ${err?.message ?? err}`);
    return [];
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
