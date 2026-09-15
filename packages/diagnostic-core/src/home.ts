import type { DiagnosticListRow } from './types';
import { COPY } from './copy';
import { liftInfo } from './lifts';
import { verdictHeadline } from './grading';

export type HomeHero =
  | { kind: 'resume'; sessionId: string; title: string; body: string; cta: string }
  | { kind: 'start'; title: string; body: string; cta: string };

/** Home's hero is context-aware (§8): an unfinished conversation takes it over. */
export function homeHero(rows: DiagnosticListRow[]): HomeHero {
  const open = rows
    .filter((r) => r.flow === 'conversation' && r.status === 'in_progress')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (open) {
    return {
      kind: 'resume',
      sessionId: open.id,
      title: COPY.heroResumeTitle(liftInfo(open.lift).short),
      body: COPY.heroResumeBody,
      cta: COPY.heroResume,
    };
  }
  return { kind: 'start', title: COPY.heroStartTitle, body: COPY.heroStartBody, cta: COPY.heroStartCta };
}

export type FirstRunTarget =
  | { kind: 'resume'; sessionId: string }
  | { kind: 'review'; sessionId: string }
  | { kind: 'new' };

/**
 * Where the first-run routing should send a user who hasn't reached a verdict
 * on THIS device (the seen-flag is device-local). The server's list decides:
 *   - an unfinished conversation → resume it. The phone died mid-thread, or
 *     they signed in on a new device; a fresh thread beside the saved one
 *     would strand their answers and, past onboarding, cost a diagnosis.
 *   - otherwise a finished one → open it. Their verdict landed while the app
 *     was closed (phone died during "Reading your numbers"), so they never saw it.
 *   - nothing → a new thread.
 * Wizard sessions are ignored: they predate this flow and aren't resumable here.
 */
export function firstRunTarget(rows: DiagnosticListRow[]): FirstRunTarget {
  const conversations = rows
    .filter((r) => r.flow === 'conversation')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const open = conversations.find((r) => r.status === 'in_progress');
  if (open) return { kind: 'resume', sessionId: open.id };
  const done = conversations.find((r) => r.status === 'complete');
  if (done) return { kind: 'review', sessionId: done.id };
  return { kind: 'new' };
}

/** One history row: lift name + the verdict headline, or "In progress". */
export function historyRow(r: DiagnosticListRow): { title: string; subtitle: string; confidence: number | null } {
  const title = liftInfo(r.lift).name;
  if (r.status === 'in_progress') return { title, subtitle: COPY.inProgress, confidence: null };
  if (r.grade != null && r.limiter) {
    const { headline } = verdictHeadline({ grade: r.grade, lift: r.lift as never, limiter: r.limiter });
    return { title, subtitle: headline, confidence: r.confidence };
  }
  return { title, subtitle: r.limiter?.hypothesisLabel ?? COPY.reportVerdict, confidence: r.confidence };
}
