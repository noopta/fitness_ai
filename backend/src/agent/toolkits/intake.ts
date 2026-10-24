// Program intake in chat, one question at a time (Oct 2026).
//
// Why: with the direct-entry paywall a new user lands in the app with an empty
// intake. A new Pro user's first minutes were three "you don't have a program"
// replies and one message asking for the whole intake at once. Now they can
// answer here — one card per question, tap an option or type — or take the
// intake interview screen. Each card saves its answer (profile.intake_answer)
// and posts it back as the user's message, so the next question follows.
//
// The health question is part of the walk, not optional: the interview screen
// screens for red flags before building, and the chat path must too.

import { registerToolkit } from '../registry.js';
import { defineOp, getOp } from '../ops.js';
import './profile.js'; // defines profile.set_fields, which intake answers write through
import { tool, schema, prisma } from './kit.js';
import { readProfile, parseBlob, mergeBlobKeys } from '../profile/coachProfile.js';
import type { CardDraft } from '../cards/types.js';

export interface IntakeStep {
  key: 'goal' | 'trainingAge' | 'daysPerWeek' | 'sessionMinutes' | 'equipment' | 'injuries' | 'health';
  q: string;
  options: string[];
  typeInstead?: boolean;
  /** Posted back as the user's message; {answer} is what they picked or typed. */
  say: string;
  why: string;
}

export const CHAT_INTAKE: IntakeStep[] = [
  { key: 'goal', q: 'What are you training for?', options: ['Build muscle', 'Get stronger', 'Lose fat', 'Athletic performance'], typeInstead: true, say: 'My goal: {answer}.', why: 'Type it if it’s specific, like “bench 225 by March”.' },
  { key: 'trainingAge', q: 'How long have you been lifting?', options: ['Under 6 months', '6–12 months', '1–3 years', '3+ years'], say: 'Lifting experience: {answer}.', why: 'It sets how hard the first weeks start.' },
  { key: 'daysPerWeek', q: 'How many days a week can you lift?', options: ['2', '3', '4', '5', '6'], say: '{answer} days a week.', why: 'The split is built around it.' },
  { key: 'sessionMinutes', q: 'How long can a session be?', options: ['30 min', '45 min', '60 min', '90 min'], say: 'Sessions of {answer}.', why: 'It decides how many lifts fit in a day.' },
  { key: 'equipment', q: 'Where do you train?', options: ['Full gym', 'Dumbbells only', 'Home — barbell'], say: 'Equipment: {answer}.', why: 'Every lift has to be one you can do there.' },
  { key: 'injuries', q: 'Anything to work around?', options: ['Nothing to work around'], typeInstead: true, say: 'To work around: {answer}.', why: 'An injury, pain, or a lift you can’t do. Type it.' },
  { key: 'health', q: 'Has a doctor told you to limit exercise, or do you get chest pain, dizziness or fainting when active?', options: ['No', 'Yes'], say: 'Health check: {answer}.', why: 'If yes, you should get cleared first, and the plan starts gentle.' },
];

const NONE = /^(no|none|nothing|nope|n\/a)\b|nothing to work around/i;

/** Pure: the first step still unanswered, given what the profile holds. */
export function nextStep(values: Record<string, unknown>, injuriesKnown: boolean, chat: Record<string, unknown>, parqAnswered: boolean): IntakeStep | null {
  for (const s of CHAT_INTAKE) {
    if (s.key === 'injuries') { if (!injuriesKnown && !chat.injuries) return s; continue; }
    if (s.key === 'health') { if (!parqAnswered && !chat.health) return s; continue; }
    const v = values[s.key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return s;
  }
  return null;
}

/** Pure: an answer as the profile field wants it ("45 min" → 45). */
export function fieldValue(key: IntakeStep['key'], answer: string): string | number {
  if (key === 'daysPerWeek' || key === 'sessionMinutes') {
    const n = Number((answer.match(/\d+/) ?? [''])[0]);
    if (!Number.isFinite(n) || !n) throw new Error(key === 'daysPerWeek' ? 'Pick how many days, 2 to 7.' : 'Pick a session length in minutes.');
    return n;
  }
  return answer.trim();
}

async function intakeState(userId: string) {
  const [{ values, blob, injuries }, u] = await Promise.all([
    readProfile(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { constraintsText: true } }),
  ]);
  const chat = (blob.chatIntake ?? {}) as Record<string, unknown>;
  const parq = values.parq;
  const parqAnswered = Array.isArray(parq) ? parq.length > 0 : !!parq;
  const injuriesKnown = injuries.length > 0 || !!(u?.constraintsText ?? '').trim();
  return { values, blob, chat, parqAnswered, injuriesKnown };
}

defineOp({
  name: 'profile.intake_answer',
  run: async (userId, args) => {
    const key = String(args.key) as IntakeStep['key'];
    const answer = String(args.value ?? '').trim();
    if (!CHAT_INTAKE.some((s) => s.key === key)) throw new Error('Unknown intake question.');
    // Injuries and health are recorded as answered here; a reported injury is
    // saved properly by the agent with update_injuries from the posted message.
    if (key === 'injuries' || key === 'health') {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
      const chat = { ...((parseBlob(u?.coachProfile).chatIntake ?? {}) as Record<string, unknown>) };
      chat[key] = key === 'health' ? (/^y/i.test(answer) ? 'flag' : 'clear') : (NONE.test(answer) ? 'none' : 'reported');
      await mergeBlobKeys(userId, { chatIntake: chat });
      return { inverse: null, summary: key === 'health' ? 'Health check answered' : 'Noted what to work around' };
    }
    return getOp('profile.set_fields')!.run(userId, { changes: { [key]: fieldValue(key, answer) } });
  },
});

export const INTAKE_TOOLS = [
  tool({
    name: 'next_intake_question', kind: 'read', fn: 'PRO-19',
    description: 'Build their program in chat, one question at a time: puts up the next unanswered intake question as a card (tap an option or type). Call it when they choose to answer here, and again after each answer arrives. When it returns complete, build with propose_new_program (confirmed=true, their answers in notes) — unless healthFlag is true.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Checked', text: 'Your intake' }),
    execute: async (_i, userId) => {
      const st = await intakeState(userId);
      const step = nextStep(st.values, st.injuriesKnown, st.chat, st.parqAnswered);
      const n = CHAT_INTAKE.length;
      if (!step) {
        const healthFlag = st.chat.health === 'flag';
        const saveInjury = st.chat.injuries === 'reported' && !st.injuriesKnown;
        return {
          complete: true, healthFlag,
          known: { goal: st.values.goal, experience: st.values.trainingAge, daysPerWeek: st.values.daysPerWeek, sessionMinutes: st.values.sessionMinutes, equipment: st.values.equipment, workAround: st.chat.injuries ?? 'on file' },
          instruction: healthFlag
            ? 'They answered yes to the health question. Do not build a training program now. Say plainly that a doctor or physio should clear them first, and that the intake interview can set up a gentle start in the meantime — the card opens it.'
            : `${saveInjury ? 'Save what they said to work around with update_injuries, then ' : ''}Build now with propose_new_program, confirmed=true, their answers in notes. Don’t ask anything else first.`,
        };
      }
      const i = CHAT_INTAKE.indexOf(step);
      // A reported injury is only marked answered by the card; it still has to be saved properly.
      const saveInjury = st.chat.injuries === 'reported' && !st.injuriesKnown;
      return { asking: step.key, step: i + 1, of: n, question: step.q, instruction: `${saveInjury ? 'First save what they said to work around with update_injuries. ' : ''}The card asks it — say nothing else, or at most a few words. Wait for the answer.` };
    },
    card: (_i, r: any): CardDraft | null => {
      if (r.complete) {
        return r.healthFlag ? {
          fn: 'PRO-19', pattern: 'glance', rule: 'show', meta: { label: 'Before your program' },
          note: 'A doctor or physio can clear you, usually in one visit. The interview sets up a gentle start until then.',
          actions: [{ id: 'interview', label: 'Open the intake interview', kind: 'primary', client: { action: 'open_page', args: { page: 'intake' } } }],
        } : null;
      }
      const step = CHAT_INTAKE.find((s) => s.key === r.asking)!;
      return {
        fn: 'PRO-19', pattern: 'ask', rule: 'show', meta: { label: `Your program · ${r.step} of ${r.of}` },
        ask: { q: step.q, options: step.options, typeInstead: !!step.typeInstead },
        why: step.why,
        pending: { answer: { op: 'profile.intake_answer', args: { key: step.key }, valueKey: 'value', asMessage: step.say } },
      };
    },
  }),
];

/** The two ways to build a program, offered when the intake is mostly empty. */
export function buildChoiceCard(): CardDraft {
  return {
    fn: 'PRG-04', pattern: 'glance', rule: 'show', meta: { label: 'Build your program' },
    note: 'Seven quick questions. Answer them here one at a time, or in the intake interview.',
    actions: [
      { id: 'chat', label: 'Answer here, one at a time', kind: 'primary', client: { action: 'send_message', args: { text: 'Let’s build it here, one question at a time.' } } },
      { id: 'interview', label: 'Open the intake interview', kind: 'secondary', client: { action: 'open_page', args: { page: 'intake' } } },
    ],
  };
}

registerToolkit(INTAKE_TOOLS);
