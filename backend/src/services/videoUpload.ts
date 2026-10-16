// Shared plumbing for the video upload routes (form analysis + lift
// diagnostics). Oct 2026 audit M8/H2: uploads were multer.memoryStorage() with
// a 200 MB cap and ran BEFORE any quota check, so an over-quota free user could
// still push 12 × 200 MB/min into the heap, and background jobs held those
// buffers for minutes.
//
// Now:
//   - the body streams to a private mkdtemp directory (diskStorage), never the
//     heap, and the directory is removed as soon as the handler is done with it;
//   - the default cap is 100 MB (FORM_VIDEO_MAX_MB still overrides);
//   - at most VIDEO_JOB_CONCURRENCY (default 2) video jobs hold a clip in
//     memory at once per process; callers acquire a slot before reading the
//     file and release it when the job (sync or background) finishes.
//
// Quota/tier/eligibility checks belong in a middleware placed BEFORE
// `upload.middleware` so a rejected request is answered before its body is read.

import multer from 'multer';
import { mkdtemp, readFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const VIDEO_TMP_PREFIX = 'axiom-vidup-';

export function videoMaxMb(...envNames: string[]): number {
  for (const name of [...envNames, 'FORM_VIDEO_MAX_MB']) {
    const n = parseInt(process.env[name] ?? '', 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 100;
}

/** Directory the current request's upload was written to (set by diskStorage). */
const TMP_DIR = Symbol('videoTmpDir');

export interface VideoUpload {
  maxMb: number;
  /** Express middleware: parses one `field` file to disk; 413/400 on bad input. */
  middleware: (req: any, res: any, next: any) => void;
}

export function createVideoUpload(field: string, maxMb: number): VideoUpload {
  const storage = multer.diskStorage({
    destination: (req: any, _file, cb) => {
      mkdtemp(path.join(tmpdir(), VIDEO_TMP_PREFIX))
        .then((dir) => { req[TMP_DIR] = dir; cb(null, dir); })
        .catch((err) => cb(err as Error, ''));
    },
    filename: (_req, _file, cb) => cb(null, 'upload.bin'),
  });
  const upload = multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype?.startsWith('video/')) return cb(null, true);
      cb(new Error('Only video uploads are supported'));
    },
  });
  const middleware = (req: any, res: any, next: any) =>
    upload.single(field)(req, res, (err: any) => {
      if (!err) return next();
      void cleanupVideoUpload(req);
      if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Video is too large. Keep it under ${maxMb}MB.` });
      return res.status(400).json({ error: err?.message || 'Invalid video upload' });
    });
  return { maxMb, middleware };
}

/** Read the uploaded clip into memory (call after acquiring a job slot). */
export async function readUploadedVideo(req: any): Promise<Buffer | null> {
  const p = req?.file?.path;
  if (!p) return req?.file?.buffer ?? null;
  return readFile(p);
}

/** Remove the request's temp directory. Safe to call more than once. */
export async function cleanupVideoUpload(req: any): Promise<void> {
  const dir = req?.[TMP_DIR];
  if (!dir) return;
  req[TMP_DIR] = undefined;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Remove orphaned upload dirs (process died between upload and cleanup).
 * Exported for a boot hook / cron; not wired automatically.
 */
export async function sweepStaleVideoTmpDirs(maxAgeMs = 60 * 60 * 1000): Promise<number> {
  let removed = 0;
  const base = tmpdir();
  const names = await readdir(base).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(VIDEO_TMP_PREFIX)) continue;
    const full = path.join(base, name);
    const st = await stat(full).catch(() => null);
    if (st && Date.now() - st.mtimeMs > maxAgeMs) {
      await rm(full, { recursive: true, force: true }).catch(() => {});
      removed++;
    }
  }
  return removed;
}

// ─── Concurrency ────────────────────────────────────────────────────────────

export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(readonly max: number) {}

  get inUse(): number { return this.active; }

  /** Resolves to a release fn, or null if no slot frees up within `timeoutMs`. */
  acquire(timeoutMs = 0): Promise<(() => void) | null> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    if (timeoutMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const grant = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.active++;
        resolve(this.releaser());
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.waiters = this.waiters.filter((w) => w !== grant);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(grant);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

const concurrency = (() => {
  const n = parseInt(process.env.VIDEO_JOB_CONCURRENCY ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
})();

/** One per process, shared by every video route. */
export const videoJobSlots = new Semaphore(concurrency);

/** How long a request waits for a free slot before answering 503. */
export const VIDEO_SLOT_WAIT_MS = 20_000;
export const VIDEO_BUSY_MESSAGE = 'Video analysis is busy right now. Try again in a minute.';
