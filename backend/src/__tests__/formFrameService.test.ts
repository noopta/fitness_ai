// Reference-still extraction. The pure helpers (box validation, anchor
// selection, filter construction) are tested directly; extraction itself runs
// real ffmpeg against a generated clip, because the parts most likely to break
// — argument order, the -ss-before--i seek, filter syntax — are exactly the
// parts a mocked ffmpeg would assert nothing about.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isValidBox,
  selectAnchoredWeaknesses,
  buildFilter,
  probeDurationSec,
  extractReferenceFrames,
  MAX_FRAMES,
} from '../services/formFrameService.js';
import type { FormWeakness } from '../services/geminiService.js';

const execFileAsync = promisify(execFile);

const weakness = (over: Partial<FormWeakness> = {}): FormWeakness => ({
  issue: 'Lumbar rounds at the bottom',
  severity: 'major',
  cue: 'Brace harder before you descend',
  ...over,
});

// ─── ffmpeg availability ─────────────────────────────────────────────────────
// Extraction is best-effort in production; a box without ffmpeg should skip
// these rather than report a failure the code deliberately tolerates.
let hasFfmpeg = false;
let workDir = '';
let clipPath = '';
const CLIP_SECONDS = 4;

beforeAll(async () => {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 });
    await execFileAsync('ffprobe', ['-version'], { timeout: 10_000 });
    hasFfmpeg = true;
  } catch {
    return;
  }
  workDir = await mkdtemp(path.join(tmpdir(), 'form-frame-test-'));
  clipPath = path.join(workDir, 'clip.mp4');
  await execFileAsync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=white:s=360x640:d=${CLIP_SECONDS}:r=24`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    clipPath,
  ], { timeout: 30_000 });
}, 60_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe('isValidBox', () => {
  it('accepts a well-formed 0-1000 box', () => {
    expect(isValidBox([100, 200, 400, 500])).toBe(true);
  });

  it('rejects wrong shapes and non-numbers', () => {
    expect(isValidBox(null)).toBe(false);
    expect(isValidBox([1, 2, 3])).toBe(false);
    expect(isValidBox([1, 2, 3, 4, 5])).toBe(false);
    expect(isValidBox(['1', 2, 3, 4])).toBe(false);
    expect(isValidBox([NaN, 2, 3, 4])).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isValidBox([-1, 0, 100, 100])).toBe(false);
    expect(isValidBox([0, 0, 1001, 100])).toBe(false);
  });

  it('rejects a degenerate or inverted box', () => {
    expect(isValidBox([500, 100, 500, 400])).toBe(false); // zero height
    expect(isValidBox([500, 100, 200, 400])).toBe(false); // ymax < ymin
    expect(isValidBox([100, 400, 400, 200])).toBe(false); // xmax < xmin
  });
});

describe('selectAnchoredWeaknesses', () => {
  it('skips weaknesses with no timestamp', () => {
    const picked = selectAnchoredWeaknesses(
      [weakness(), weakness({ timestampSec: 1.5 })],
      10,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].index).toBe(1);
  });

  it('orders by severity so the worst faults get the stills', () => {
    const picked = selectAnchoredWeaknesses(
      [
        weakness({ severity: 'minor', timestampSec: 1 }),
        weakness({ severity: 'major', timestampSec: 2 }),
        weakness({ severity: 'moderate', timestampSec: 3 }),
      ],
      10,
    );
    expect(picked.map((p) => p.weakness.severity)).toEqual(['major', 'moderate', 'minor']);
  });

  it(`caps at ${MAX_FRAMES} stills`, () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      weakness({ severity: 'major', timestampSec: i }));
    expect(selectAnchoredWeaknesses(many, 30)).toHaveLength(MAX_FRAMES);
  });

  it('drops a timestamp past the end of the clip', () => {
    // ffmpeg would hand back the final frame for an out-of-range seek, which
    // is a confidently wrong picture rather than a missing one.
    const picked = selectAnchoredWeaknesses([weakness({ timestampSec: 99 })], 10);
    expect(picked).toHaveLength(0);
  });

  it('keeps timestamps when the duration is unknown', () => {
    expect(selectAnchoredWeaknesses([weakness({ timestampSec: 99 })], null)).toHaveLength(1);
  });

  it('drops negative and non-finite timestamps', () => {
    const picked = selectAnchoredWeaknesses(
      [weakness({ timestampSec: -1 }), weakness({ timestampSec: NaN }), weakness({ timestampSec: 2 })],
      10,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].weakness.timestampSec).toBe(2);
  });

  it('tolerates undefined input', () => {
    expect(selectAnchoredWeaknesses(undefined, 10)).toEqual([]);
  });
});

describe('buildFilter', () => {
  it('scales only when there is no box to draw', () => {
    expect(buildFilter(null)).toBe('scale=540:-2');
  });

  it('draws eight bracket strokes, four corners of two', () => {
    const filter = buildFilter([100, 200, 500, 600]);
    expect(filter.startsWith('scale=540:-2,')).toBe(true);
    expect(filter.match(/drawbox=/g)).toHaveLength(8);
  });

  it('expresses geometry relative to the scaled frame, not source pixels', () => {
    // Coordinates must ride on iw/ih or the box lands wrong for any clip whose
    // resolution differs from the one the numbers were computed against.
    const filter = buildFilter([100, 200, 500, 600]);
    expect(filter).toContain('*iw');
    expect(filter).toContain('*ih');
    expect(filter).not.toMatch(/x=\d+:/);
  });
});

describe.runIf(() => hasFfmpeg)('probeDurationSec', () => {
  it('reads the clip duration', async () => {
    const seconds = await probeDurationSec(clipPath);
    expect(seconds).toBeGreaterThan(CLIP_SECONDS - 0.5);
    expect(seconds).toBeLessThan(CLIP_SECONDS + 0.5);
  });

  it('returns null for a file that is not a video', async () => {
    const bogus = path.join(workDir, 'nope.mp4');
    await execFileAsync('sh', ['-c', `echo not-a-video > ${bogus}`]);
    expect(await probeDurationSec(bogus)).toBeNull();
  });
});

describe('extractReferenceFrames', () => {
  it('returns nothing when no weakness carries a timestamp', async () => {
    const frames = await extractReferenceFrames(Buffer.from('x'), 'video/mp4', [weakness()]);
    expect(frames).toEqual([]);
  });

  it('returns nothing rather than throwing on an unreadable clip', async () => {
    // The analysis is already complete and useful by this point; a bad clip
    // must cost the pictures and nothing else.
    const frames = await extractReferenceFrames(
      Buffer.from('definitely not a video'),
      'video/mp4',
      [weakness({ timestampSec: 1 })],
    );
    expect(frames).toEqual([]);
  });
});

describe.runIf(() => hasFfmpeg)('extractReferenceFrames (real ffmpeg)', () => {
  it('extracts a decodable JPEG at the requested moment', async () => {
    const video = await readFile(clipPath);
    const frames = await extractReferenceFrames(video, 'video/mp4', [
      weakness({ timestampSec: 2, box2d: [200, 150, 700, 800] }),
    ]);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ weaknessIndex: 0, timestampSec: 2, box2d: [200, 150, 700, 800] });

    const bytes = Buffer.from(frames[0].b64, 'base64');
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG SOI
    expect(bytes.length).toBeGreaterThan(500);

    // Rendered at the configured width, not the source's 360px.
    const probe = path.join(workDir, 'out.jpg');
    await execFileAsync('sh', ['-c',
      `printf %s '${frames[0].b64}' | base64 -d > ${probe}`]);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width', '-of', 'csv=p=0', probe,
    ]);
    expect(parseInt(stdout.trim(), 10)).toBe(540);
  }, 30_000);

  it('extracts without a highlight when the box is malformed', async () => {
    const video = await readFile(clipPath);
    const frames = await extractReferenceFrames(video, 'video/mp4', [
      weakness({ timestampSec: 1, box2d: [9, 9, 9] }),
    ]);
    expect(frames).toHaveLength(1);
    expect(frames[0].box2d).toBeUndefined();
  }, 30_000);

  it('returns stills in chronological order after severity-ranked selection', async () => {
    const video = await readFile(clipPath);
    const frames = await extractReferenceFrames(video, 'video/mp4', [
      weakness({ severity: 'minor', timestampSec: 3 }),
      weakness({ severity: 'major', timestampSec: 1 }),
      weakness({ severity: 'moderate', timestampSec: 2 }),
    ]);
    expect(frames.map((f) => f.timestampSec)).toEqual([1, 2, 3]);
    // Index still points back at the weakness each still illustrates.
    expect(frames.map((f) => f.weaknessIndex)).toEqual([1, 2, 0]);
  }, 45_000);

  it('honours the cap when more faults are anchored than we render', async () => {
    const video = await readFile(clipPath);
    const frames = await extractReferenceFrames(
      video,
      'video/mp4',
      Array.from({ length: 6 }, (_, i) => weakness({ severity: 'major', timestampSec: i * 0.5 })),
    );
    expect(frames).toHaveLength(MAX_FRAMES);
  }, 60_000);
});
