// A chat turn that runs on its own (founder feedback, Oct 2026). The turn keeps
// going server-side when the phone leaves the screen or the connection drops;
// this records it so the app can come back to it: what was asked, the steps
// so far, whether it's done. One turn per user at a time — a second send while
// one is running would start the same expensive work twice (overlapping
// program generations made the founder's attempt time out).
//
// Tools report progress with agentProgress() (no turn → no-op); the stream
// route forwards each step to the phone as a receipt line.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface Step { id: string; verb: string; text: string }
export interface Run {
  userId: string;
  message: string;
  startedAt: number;
  finishedAt: number | null;
  steps: Step[];
  /** Expensive-tool budget for this turn (program generations). */
  programGenerations: number;
  emit?: (s: Step) => void;
}

const RUN_MAX_MS = 8 * 60 * 1000;
const KEEP_DONE_MS = 10 * 60 * 1000;
const runs = new Map<string, Run>();
const als = new AsyncLocalStorage<Run>();

const live = (r: Run | undefined, now = Date.now()) => !!r && r.finishedAt == null && now - r.startedAt < RUN_MAX_MS;

/** Start a turn, or null when one is already running for this user. */
export function startRun(userId: string, message: string, emit?: (s: Step) => void, now = Date.now()): Run | null {
  if (live(runs.get(userId), now)) return null;
  const run: Run = { userId, message, startedAt: now, finishedAt: null, steps: [], programGenerations: 0, emit };
  runs.set(userId, run);
  return run;
}

export function finishRun(run: Run, now = Date.now()) {
  run.finishedAt = now;
  run.emit = undefined;
  setTimeout(() => { if (runs.get(run.userId) === run) runs.delete(run.userId); }, KEEP_DONE_MS).unref?.();
}

/** Run `fn` inside the turn so tools can report progress and read its budget. */
export const inRun = <T>(run: Run, fn: () => Promise<T>) => als.run(run, fn);
export const currentRun = () => als.getStore() ?? null;

/** Record a step (a tool's receipt, or progress inside a long tool). Same id = updated in place. */
export function noteStep(run: Run, step: Step) {
  const i = run.steps.findIndex((s) => s.id === step.id);
  if (i >= 0) run.steps[i] = step; else run.steps.push(step);
  if (run.steps.length > 30) run.steps.splice(0, run.steps.length - 30);
}

/** A long tool says what it's doing ("Writing your 12-week program"). No turn → nothing happens. */
export function agentProgress(id: string, verb: string, text: string) {
  const run = als.getStore();
  if (!run) return;
  const step = { id: `p:${id}`, verb, text };
  noteStep(run, step);
  try { run.emit?.(step); } catch { /* the phone left; the turn goes on */ }
}

/** What the app shows when it comes back: running (with steps so far), recently done, or nothing. */
export function turnStatus(userId: string, now = Date.now()): { running: boolean; message: string | null; startedAt: string | null; steps: Step[]; finishedAt: string | null } {
  const r = runs.get(userId);
  if (!r) return { running: false, message: null, startedAt: null, steps: [], finishedAt: null };
  return { running: live(r, now), message: r.message, startedAt: new Date(r.startedAt).toISOString(), steps: r.steps.slice(-8), finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null };
}

/** Test seam. */
export function resetRunsForTests() { runs.clear(); }
