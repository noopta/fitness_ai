// Red-flag follow-up (Oct 2026). Onboarding flags symptoms a program
// shouldn't load around — pain or numbness down a limb, no clearance yet for
// an injury, a heart or blood-pressure condition — and offers three routes:
// see a clinician first (no program), "I've been cleared", or a gentle plan
// meanwhile. Until now the gentle route was the end of it: nobody asked which
// limb, whether the pain starts in the back or the neck, or about the signs
// that mean urgent care (20 Oct 2026: a new user on the gentle route).
//
// Stored on coachProfile.safety; every choice the user makes is also kept as
// a dated acknowledgement (coachProfile.safetyAcks) with the Terms version it
// was made under — their record and ours.

import { CURRENT_TERMS_VERSION } from './termsVersion.js';

export type SafetyStatus = 'clinician' | 'gentle' | 'cleared' | 'urgent';

export interface SafetyScreen {
  limb?: 'leg' | 'arm' | 'both' | 'none' | null;
  side?: 'left' | 'right' | 'both' | null;
  origin?: 'lower back' | 'neck' | 'other' | 'unsure' | null;
  numbness?: boolean | null;
  weakness?: boolean | null;
  emergencySigns?: boolean | null;
  notes?: string | null;
  at: string;
}

export interface Safety {
  /** The onboarding answers that raised the flag, verbatim. */
  flags: string[];
  status: SafetyStatus;
  since: string;
  screen?: SafetyScreen | null;
  clearedAt?: string | null;
  clearedBy?: string | null;
  lastCheckAt?: string | null;
}

export interface SafetyAck { kind: string; text: string; at: string; termsVersion: string; detail?: string }

/** What the user agrees to when they continue past a red flag (shown on the red-flag screen, kept verbatim). */
export const ACK_TEXT: Record<'gentle' | 'cleared', string> = {
  gentle: 'Start a gentle plan meanwhile — Training before a clinician has checked this is your decision, at your own risk. I’ll keep it gentle and ask a few follow-ups first. Terms §4.',
  cleared: 'It’s been checked — I’m cleared — I rely on what you tell me and can’t verify a clearance. Terms §4.',
};

/** The answers on the onboarding health questions that count as red flags. */
const RED_FLAG_ANSWERS: Record<string, string[]> = {
  hurt: ['Pain down a leg or arm', 'Pain down a leg', 'Pain down an arm'],
  leg: ['Yes'],
  cleared: ['Not yet'],
  meds: ['Blood pressure or heart'],
};

/** Pure: which answers raised a flag ("Pain down a leg", "Blood pressure or heart"). */
export function flaggedAnswers(answers: Record<string, string>): string[] {
  return Object.entries(RED_FLAG_ANSWERS)
    .filter(([k, vals]) => vals.includes(answers[k]))
    .map(([k]) => (k === 'leg' ? 'Numbness or pain down a leg' : k === 'cleared' ? 'Injury not yet cleared by a clinician' : answers[k]));
}

/** Pure: the safety record and acknowledgement onboarding writes. */
export function safetyFromOnboarding(answers: Record<string, string>, now = new Date()): { safety: Safety; acks: SafetyAck[] } | null {
  const route = answers.redFlagRoute as SafetyStatus | undefined;
  const flags = flaggedAnswers(answers);
  if (!route || !flags.length) return null;
  const at = now.toISOString();
  const status: SafetyStatus = route === 'cleared' ? 'cleared' : route === 'clinician' ? 'clinician' : 'gentle';
  const acks: SafetyAck[] = route === 'gentle' || route === 'cleared'
    ? [{ kind: `red_flag_${route}`, text: ACK_TEXT[route], at, termsVersion: CURRENT_TERMS_VERSION, detail: flags.join('; ') }]
    : [{ kind: 'red_flag_clinician', text: 'Chose to see a clinician before a program is built.', at, termsVersion: CURRENT_TERMS_VERSION, detail: flags.join('; ') }];
  return { safety: { flags, status, since: at, ...(status === 'cleared' ? { clearedAt: at, clearedBy: 'self-reported at sign-up' } : {}) }, acks };
}

const DAY = 86_400_000;
export const CLEARANCE_CHECK_DAYS = 14;

/** Pure: is a "have you been cleared yet?" check due? */
export function clearanceCheckDue(s: Safety | null | undefined, now = Date.now()): boolean {
  if (!s || s.status !== 'gentle') return false;
  const last = Date.parse(s.lastCheckAt ?? s.since);
  return Number.isFinite(last) && now - last >= CLEARANCE_CHECK_DAYS * DAY;
}

const limbOf = (flags: string[]) => (flags.some((f) => /\bleg\b/i.test(f)) && flags.some((f) => /\barm\b/i.test(f)) ? 'leg or arm' : flags.some((f) => /\barm\b/i.test(f)) ? 'arm' : flags.some((f) => /\bleg\b/i.test(f)) ? 'leg' : null);

/** Pure: Anakin's first message for an unscreened flag. Null when nothing to ask. */
export function followUpText(s: Safety | null | undefined): string | null {
  if (!s || s.screen || !(s.status === 'gentle' || s.status === 'cleared')) return null;
  const limb = limbOf(s.flags);
  const what = limb ? `the pain down your ${limb}` : s.flags.join(' and ').toLowerCase();
  const limbQs = limb
    ? `\n1. ${limb === 'leg or arm' ? 'Leg or arm — and which side' : 'Which side'}? Does it start in your ${limb === 'arm' ? 'neck' : limb === 'leg' ? 'lower back' : 'lower back or neck'}?\n2. Any numbness, tingling or weakness with it?`
    : '';
  // Warmer opening (Oct 29 2026): a new user's first message was the list of
  // red-flag questions, cold, and they never answered. Same questions and the
  // same urgent-care line — framed with why we ask, and that they can start
  // gently today instead of waiting.
  const start = s.status === 'cleared'
    ? 'You said a clinician has cleared you — tell me anything they said to avoid and I’ll build around it.'
    : 'You don’t have to wait to get moving: walking, mobility and light work that doesn’t bring it on are all fine while we sort this out. Until a doctor or physio clears it, your plan stays gentle — I’m a coach, not a clinician.';
  return `Welcome — glad you’re here. You mentioned ${what} when you signed up, so before I build your plan I want to make sure we train around it safely. A few quick questions (short answers are fine):${limbQs}\n${limbQs ? '3' : '1'}. Any of these: changes in bladder or bowel control, numbness in the groin or inner thighs, weakness that's getting worse, chest pain or fainting, or pain that started after a fall or accident? If yes — please get seen at urgent care or the ER today, not a workout.\n\n${start}`;
}

/** Pure: the every-two-weeks clearance check. */
export function clearanceCheckText(s: Safety): string {
  const limb = limbOf(s.flags);
  return `Checking in on ${limb ? `the pain down your ${limb}` : 'what you flagged at sign-up'} — has a doctor or physio cleared you yet? If yes, tell me and I’ll move you to your full plan. If it’s changed or got worse, tell me that too — and if you notice any numbness that’s spreading, weakness, or bladder or bowel changes, get seen today.`;
}

/** Pure: hard training rules for what the screen found — the program respects these until cleared. */
export function trainingRules(s: Safety): string[] {
  const sc = s.screen;
  const rules: string[] = [];
  if (s.status === 'urgent') return ['URGENT: they reported a sign that needs medical care today. No training advice or loading until they say a clinician has seen them. Tell them to go to urgent care or the ER now.'];
  if (s.status === 'cleared') return sc?.notes ? [`Cleared by a clinician; follow what they said: ${sc.notes}`] : [];
  const back = sc?.origin === 'lower back' || (sc?.limb === 'leg' && sc?.origin !== 'neck');
  const neck = sc?.origin === 'neck' || (sc?.limb === 'arm' && sc?.origin !== 'lower back');
  if (back) rules.push('Lower-back nerve symptoms: no loaded spinal flexion or heavy axial loading — no barbell back squat, conventional deadlift, good mornings, deep leg press that rounds the low back, sit-ups or loaded twists. Prefer supported, neutral-spine work (chest-supported rows, split squats to a box, hip thrusts/bridges if pain-free, machines with back support) and walking.');
  if (neck) rules.push('Neck/arm nerve symptoms: no overhead pressing, heavy shrugs or carries, upright rows, behind-the-neck work or anything that loads the head forward. Prefer supported upper-body work at chest height and below, light and pain-free.');
  if (!back && !neck) rules.push('Not screened yet: keep every session light, supported and pain-free; no heavy spinal or overhead loading until the follow-up questions are answered.');
  if (sc?.numbness || sc?.weakness) rules.push('Numbness or weakness reported: keep loads light (RPE ≤ 6), stop any exercise that brings symptoms down the limb, and urge them to get it checked soon.');
  rules.push('Any exercise that sends pain or tingling down the limb, or makes it spread, is stopped and swapped — never pushed through.');
  return rules;
}

/** Pure: the context line Anakin gets every turn while a flag is open. */
export function safetyContextLine(s: Safety | null | undefined, now = Date.now()): string | null {
  if (!s) return null;
  const flags = s.flags.join('; ');
  if (s.status === 'urgent') return `SAFETY — URGENT: they reported a sign that needs medical care (${flags}). Don't give training advice or load anything; ask whether they've been seen. ${trainingRules(s)[0]}`;
  if (s.status === 'clinician') return `SAFETY: red flag at sign-up (${flags}); they chose to see a clinician before training. Don't build or push a program until they say they've been cleared — then record it with record_safety_screen.`;
  const parts = [`SAFETY: red flag at sign-up (${flags}); ${s.status === 'gentle' ? `gentle plan since ${s.since.slice(0, 10)}, not yet cleared by a clinician` : `they say a clinician cleared them${s.clearedAt ? ` (${s.clearedAt.slice(0, 10)})` : ''}`}.`];
  if (!s.screen) parts.push('FOLLOW-UP NOT DONE: before any training advice, ask which limb/side, whether it starts in the back or neck, numbness/weakness, and the urgent-care signs (bladder/bowel change, groin numbness, worsening weakness, chest pain/fainting, after a fall) — and record whatever they’ve answered with record_safety_screen AS SOON AS they answer any of it (partial is fine; call it again as more comes in). "No" to the urgent-care list counts as emergencySigns: false.');
  else parts.push(`Screen: ${[sc(s.screen)].join('')}.`);
  if (clearanceCheckDue(s, now)) parts.push('CLEARANCE CHECK DUE: ask whether a clinician has cleared them; record the answer with record_safety_screen.');
  const rules = trainingRules(s);
  if (rules.length) parts.push(`Rules until cleared: ${rules.join(' ')}`);
  return parts.join(' ');
}

const sc = (x: SafetyScreen) => [x.limb && x.limb !== 'none' ? `${x.side ? `${x.side} ` : ''}${x.limb}` : null, x.origin ? `from the ${x.origin}` : null, x.numbness ? 'numbness' : null, x.weakness ? 'weakness' : null, x.notes].filter(Boolean).join(', ') || 'answered';

/** Pure: a specific injury line for the program ("Radiating pain down the left leg from the lower back, numbness"). */
export function injuryLine(s: Safety): string {
  const x = s.screen;
  if (!x || !x.limb || x.limb === 'none') return s.flags.join('; ');
  return `Radiating pain down the ${x.side && x.side !== 'both' ? `${x.side} ` : ''}${x.limb === 'both' ? 'leg and arm' : x.limb}${x.origin && x.origin !== 'unsure' ? ` from the ${x.origin}` : ''}${x.numbness ? ', numbness' : ''}${x.weakness ? ', weakness' : ''} — ${s.status === 'cleared' ? 'cleared by a clinician' : 'not yet cleared by a clinician'}`;
}
