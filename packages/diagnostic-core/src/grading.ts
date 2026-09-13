import type { Verdict } from './types';
import { COPY } from './copy';
import { liftInfo, phaseCopy } from './lifts';

/**
 * The prototype's stand-in scorer (§7). The server applies it; it lives here
 * too so both sides agree on the shape: more evidence raises confidence,
 * video is worth about one ratio, and the ceiling stays below 100.
 */
export function computeConfidence(ratiosLogged: number, hasVideo: boolean, answersGiven: number): number {
  return Math.min(84, 46 + 12 * ratiosLogged + 11 * (hasVideo ? 1 : 0) + 3 * answersGiven);
}

export function gradeFor(ratiosLogged: number): 0 | 1 | 2 {
  return ratiosLogged >= 2 ? 2 : ratiosLogged === 1 ? 1 : 0;
}

function limiterNames(v: Pick<Verdict, 'lift' | 'limiter'>): { label: string; short: string } {
  const phase = phaseCopy(v.lift, v.limiter.phase);
  if (phase) return phase;
  const label = v.limiter.hypothesisLabel ?? `${liftInfo(v.lift).name} limiter`;
  return { label, short: label.toLowerCase() };
}

/**
 * The three visibly different verdicts:
 *   2+ ratios → "Lockout strength."            eyebrow Verdict
 *   1 ratio   → "Likely lockout strength."     eyebrow Verdict
 *   0 ratios  → "Probably lockout — untested." eyebrow Closest read
 */
export function verdictHeadline(v: Pick<Verdict, 'grade' | 'lift' | 'limiter'>): { eyebrow: string; headline: string } {
  const { label, short } = limiterNames(v);
  if (v.grade === 2) return { eyebrow: COPY.reportVerdict, headline: `${label}.` };
  if (v.grade === 1) return { eyebrow: COPY.reportVerdict, headline: `Likely ${lowerFirst(label)}.` };
  return { eyebrow: COPY.reportClosestRead, headline: `Probably ${short} — untested.` };
}

/** Which report sections render for a grade. Charts are suppressed below 2. */
export function reportSections(v: Pick<Verdict, 'grade'>) {
  return {
    charts: v.grade === 2,
    notEnoughLiftsNote: v.grade < 2,
    validationTest: v.grade < 2,
    sharpen: v.grade < 2,
  };
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
