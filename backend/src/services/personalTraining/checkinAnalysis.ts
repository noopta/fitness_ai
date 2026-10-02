// What the analysis reads in a submitted check-in. Pure — no database, no
// model — so its summary can always show what it was based on, and so the
// demo seed can run real answers through the same code.

import { painMention } from './signals.js';
import type { CheckInQuestion, CheckInSignal, Evidence } from './types.js';

export const DEFAULT_QUESTIONS: CheckInQuestion[] = [
  { id: 'energy', text: 'How was your energy this week?', type: 'scale', signal: 'energy' },
  { id: 'sleep', text: 'How well did you sleep?', type: 'scale', signal: 'sleep' },
  { id: 'stress', text: 'How stressed have you felt?', type: 'scale', signal: 'stress' },
  { id: 'pain', text: 'Any pain or niggles?', type: 'text', signal: 'pain' },
  { id: 'notes', text: 'Anything else you want me to know?', type: 'text' },
];

export interface Analysis {
  classification: 'flag' | 'look' | 'routine';
  summary: string;
  signals: CheckInSignal[];
  evidence: Evidence;
  pain: string | null;
}

export function analyse(
  questions: CheckInQuestion[], answers: Record<string, string | number>, sessions: { logged: number; target: number }, checkInId: string,
): Analysis {
  const signals: CheckInSignal[] = [];
  const reasons: string[] = [];
  const note = (label: string, tone: CheckInSignal['tone'], reason?: string) => {
    signals.push({ label, tone });
    if (reason && tone !== 'green') reasons.push(reason);
  };

  for (const q of questions) {
    const v = Number(answers[q.id]);
    if (q.type !== 'scale' || !Number.isFinite(v)) continue;
    if (q.signal === 'energy') note(`Energy ${v}/5`, v <= 2 ? 'red' : v === 3 ? 'amber' : 'green', `Rated energy ${v} out of 5`);
    if (q.signal === 'sleep') note(`Sleep ${v}/5`, v <= 2 ? 'red' : v === 3 ? 'amber' : 'green', `Rated sleep ${v} out of 5`);
    if (q.signal === 'stress') note(`Stress ${v}/5`, v >= 4 ? 'red' : v === 3 ? 'amber' : 'green', `Rated stress ${v} out of 5`);
  }

  const { logged, target } = sessions;
  note(
    `${logged} of ${target} sessions`,
    logged >= target ? 'green' : logged * 2 >= target ? 'amber' : 'red',
    `Logged ${logged} of ${target} planned sessions in the last 7 days`,
  );

  const texts = questions.filter((q) => q.type === 'text').map((q) => String(answers[q.id] ?? ''));
  const pain = texts.map((t) => painMention(t)).find(Boolean) ?? null;
  if (pain) {
    signals.push({ label: 'Pain mentioned', tone: 'red' });
    reasons.push(`Wrote "${pain.length > 100 ? `${pain.slice(0, 99)}…` : pain}"`);
  } else if (questions.some((q) => q.signal === 'pain')) {
    signals.push({ label: 'No pain reported', tone: 'green' });
  }

  const reds = signals.filter((s) => s.tone === 'red').length;
  const ambers = signals.filter((s) => s.tone === 'amber').length;
  const classification = pain || reds >= 2 ? 'flag' : reds === 1 || ambers >= 2 ? 'look' : 'routine';

  const notable = signals.filter((s) => s.tone === 'red' || s.tone === 'amber').map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1));
  const summary = classification === 'routine'
    ? `Steady week: ${signals.filter((s) => s.tone === 'green').map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1)).join(', ')}.`
    : `${notable.join(', ').replace(/^./, (ch) => ch.toUpperCase())}.${pain ? ` They wrote: "${pain}"` : ''}`;

  return {
    classification,
    summary,
    signals,
    // A routine check-in still says what it was judged on.
    evidence: {
      reasons: reasons.length ? reasons : [`Logged ${logged} of ${target} planned sessions and reported nothing outside the normal range`],
      sources: [{ kind: 'checkin', id: checkInId, label: 'This check-in' }, { kind: 'session', id: 'last-7-days', label: 'Sessions logged in the last 7 days' }],
    },
    pain,
  };
}
