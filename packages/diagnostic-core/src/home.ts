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
