// Program onboarding — goal → working → gaps → ask → plan.
//
// One continuous surface with five states (Program Onboarding.dc.html, 3a).
// Content (the ledger, the gaps, the questions, the plan) comes from the
// backend; this reducer only owns the sequencing and the receipt each answer
// posts. It also carries the full-intake extension (Remaining Flows 1a–1d):
// pre-filled rows, health Asks, red-flag routing and consent.

import type { ReceiptVerb } from './receipts';

export interface LedgerLine { verb: ReceiptVerb; text: string }

export interface Question {
  key: string;
  short: string;
  label: string;
  why: string;
  /** What the answer adjusts — becomes "Adjusted — <adjust> — from “<answer>”". */
  adjust: string;
  options: string[];
  /** Options that route to the red-flag screen (e.g. "Pain down my leg"). */
  redFlag?: string[];
}

export interface Phase { name: string; weeks: number; focus: string }

export interface Prefilled { key: string; label: string; value: string; source: string }

export interface ConsentSource { key: string; label: string; sub: string; on: boolean }

export interface OnboardingState {
  screen: 'goal' | 'working' | 'gaps' | 'ask' | 'prefilled' | 'health' | 'redflag' | 'consent' | 'plan' | 'save' | 'paywall';
  goal: string;
  ledger: LedgerLine[];
  sources: number;
  questions: Question[];
  qi: number;
  answers: Record<string, string>;
  /** The receipt shown at the foot after an answer. */
  last: LedgerLine | null;
  prefilled: Prefilled[];
  health: Question[];
  hi: number;
  redFlag: { question: Question; answer: string } | null;
  consent: ConsentSource[];
  phases: Phase[];
  nutrition: string | null;
  planId: string | null;
  error: string | null;
}

export const initialOnboarding = (): OnboardingState => ({
  screen: 'goal', goal: '', ledger: [], sources: 0, questions: [], qi: 0, answers: {}, last: null,
  prefilled: [], health: [], hi: 0, redFlag: null, consent: [], phases: [], nutrition: null, planId: null, error: null,
});

export type OnboardingAction =
  | { type: 'type_goal'; goal: string }
  | { type: 'start' }
  | { type: 'ledger'; line: LedgerLine }
  | { type: 'gaps'; sources: number; questions: Question[]; prefilled?: Prefilled[]; health?: Question[]; consent?: ConsentSource[] }
  | { type: 'begin_ask' }
  | { type: 'answer'; answer: string }
  | { type: 'prefilled_ok' }
  | { type: 'edit_prefilled'; key: string; value: string }
  | { type: 'health_answer'; answer: string }
  | { type: 'redflag_choice'; choice: 'clinician' | 'cleared' | 'gentle' }
  | { type: 'toggle_consent'; key: string }
  | { type: 'agree' }
  | { type: 'plan'; phases: Phase[]; nutrition: string | null; planId: string | null }
  | { type: 'fail'; error: string }
  | { type: 'to_save' }
  | { type: 'to_paywall' }
  | { type: 'restart' };

export function onboardingReducer(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'type_goal': return s.screen === 'goal' ? { ...s, goal: a.goal } : s;
    case 'start': return s.goal.trim() ? { ...s, screen: 'working', ledger: [], error: null } : s;
    case 'ledger': return { ...s, ledger: [...s.ledger, a.line] };
    case 'gaps': return {
      ...s, screen: 'gaps', sources: a.sources, questions: a.questions, qi: 0,
      prefilled: a.prefilled ?? [], health: a.health ?? [], hi: 0, consent: a.consent ?? s.consent,
    };
    case 'begin_ask': return { ...s, screen: s.questions.length ? 'ask' : nextAfterAsk(s), qi: 0, last: null };
    case 'answer': {
      const q = s.questions[s.qi];
      if (!q) return s;
      const answers = { ...s.answers, [q.key]: a.answer };
      const last: LedgerLine = { verb: 'Adjusted', text: `${q.adjust} — from “${a.answer}”` };
      if (q.redFlag?.includes(a.answer)) return { ...s, answers, last, redFlag: { question: q, answer: a.answer }, screen: 'redflag' };
      const next = s.qi + 1;
      if (next >= s.questions.length) return { ...s, answers, last, screen: nextAfterAsk(s) };
      return { ...s, answers, last, qi: next };
    }
    case 'prefilled_ok': return { ...s, screen: s.health.length ? 'health' : s.consent.length ? 'consent' : 'plan', hi: 0, last: null };
    case 'edit_prefilled': return { ...s, prefilled: s.prefilled.map((p) => (p.key === a.key ? { ...p, value: a.value, source: 'You, just now' } : p)) };
    case 'health_answer': {
      const q = s.health[s.hi];
      if (!q) return s;
      const answers = { ...s.answers, [q.key]: a.answer };
      const last: LedgerLine = { verb: 'Adjusted', text: `${q.adjust} — from “${a.answer}”` };
      if (q.redFlag?.includes(a.answer)) return { ...s, answers, last, redFlag: { question: q, answer: a.answer }, screen: 'redflag' };
      const next = s.hi + 1;
      if (next >= s.health.length) return { ...s, answers, last, screen: s.consent.length ? 'consent' : 'plan' };
      return { ...s, answers, last, hi: next };
    }
    case 'redflag_choice': {
      // 'clinician' keeps programming paused (screen stays); 'cleared' and
      // 'gentle' continue, with the flag kept on the answers for the backend.
      if (a.choice === 'clinician') return { ...s, answers: { ...s.answers, redFlagRoute: 'clinician' } };
      const answers = { ...s.answers, redFlagRoute: a.choice };
      const inHealth = s.health.length && s.redFlag && s.health.includes(s.redFlag.question);
      if (inHealth) {
        const next = s.hi + 1;
        return next >= s.health.length ? { ...s, answers, redFlag: null, screen: s.consent.length ? 'consent' : 'plan' } : { ...s, answers, redFlag: null, hi: next, screen: 'health' };
      }
      const next = s.qi + 1;
      return next >= s.questions.length ? { ...s, answers, redFlag: null, screen: nextAfterAsk(s) } : { ...s, answers, redFlag: null, qi: next, screen: 'ask' };
    }
    case 'toggle_consent': return { ...s, consent: s.consent.map((c) => (c.key === a.key ? { ...c, on: !c.on } : c)) };
    case 'agree': return { ...s, screen: 'plan' };
    case 'plan': return { ...s, screen: 'plan', phases: a.phases, nutrition: a.nutrition, planId: a.planId, error: null };
    case 'fail': return { ...s, error: a.error };
    case 'to_save': return { ...s, screen: 'save' };
    case 'to_paywall': return { ...s, screen: 'paywall' };
    case 'restart': return initialOnboarding();
    default: return s;
  }
}

function nextAfterAsk(s: OnboardingState): OnboardingState['screen'] {
  if (s.prefilled.length) return 'prefilled';
  if (s.health.length) return 'health';
  if (s.consent.length) return 'consent';
  return 'plan';
}

/** Dots at the top-right: one per question, current and past in crimson. */
export function askDots(s: OnboardingState): boolean[] {
  const qs = s.screen === 'health' ? s.health : s.questions;
  const i = s.screen === 'health' ? s.hi : s.qi;
  return qs.map((_, k) => k <= i);
}

/** Keyword hint for the agent when it can't infer a program type. */
export function goalHint(goal: string): 'strength' | 'pain' | 'rehab' | 'general' {
  const t = goal.toLowerCase();
  if (/back|spine|lumbar|pain|hurt/.test(t)) return 'pain';
  if (/achill|tendon|rupture|rehab|surgery|acl|return/.test(t)) return 'rehab';
  if (/deadlift|squat|bench|press|lb|kg|\d{3}/.test(t)) return 'strength';
  return 'general';
}
