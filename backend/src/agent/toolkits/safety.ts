// Red-flag follow-up (Oct 2026, services/safetyScreen.ts): Anakin records what
// the user says about a flagged symptom — which limb, where it starts,
// numbness or weakness, the urgent-care signs, a clinician's clearance — and
// gets back the training rules that hold until they're cleared. Each answer
// that changes the status is kept as a dated acknowledgement.

import { registerToolkit } from '../registry.js';
import { defineOp, executeOp } from '../ops.js';
import { tool, schema, str, prisma } from './kit.js';
import { mergeBlobKeys, parseBlob } from '../profile/coachProfile.js';
import { trainingRules, injuryLine, type Safety, type SafetyScreen, type SafetyAck } from '../../services/safetyScreen.js';
import { CURRENT_TERMS_VERSION } from '../../services/termsVersion.js';
import type { CardDraft } from '../cards/types.js';

const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const pick = <T extends string>(v: unknown, opts: readonly T[]): T | null => (opts.includes(String(v ?? '').toLowerCase() as T) ? (String(v).toLowerCase() as T) : null);
const ONBOARDING_INJURY = /^(pain down a leg or arm|pain down a leg|pain down an arm)$/i;

/** Pure: the next safety record from what they said. Urgent signs win; a clearance ends the gentle plan. */
export function nextSafety(prev: Safety | null, input: Record<string, unknown>, now = new Date()): { safety: Safety; ack: SafetyAck | null } {
  const at = now.toISOString();
  const base: Safety = prev ?? { flags: [str(input.symptom) || 'Reported in chat'], status: 'gentle', since: at };
  const screen: SafetyScreen = {
    ...(base.screen ?? {}),
    ...(pick(input.limb, ['leg', 'arm', 'both', 'none'] as const) ? { limb: pick(input.limb, ['leg', 'arm', 'both', 'none'] as const) } : {}),
    ...(pick(input.side, ['left', 'right', 'both'] as const) ? { side: pick(input.side, ['left', 'right', 'both'] as const) } : {}),
    ...(pick(input.origin, ['lower back', 'neck', 'other', 'unsure'] as const) ? { origin: pick(input.origin, ['lower back', 'neck', 'other', 'unsure'] as const) } : {}),
    ...(bool(input.numbness) != null ? { numbness: bool(input.numbness) } : {}),
    ...(bool(input.weakness) != null ? { weakness: bool(input.weakness) } : {}),
    ...(bool(input.emergencySigns) != null ? { emergencySigns: bool(input.emergencySigns) } : {}),
    ...(str(input.notes) ? { notes: str(input.notes).slice(0, 400) } : {}),
    at,
  };
  let status = base.status;
  let ack: SafetyAck | null = null;
  if (screen.emergencySigns) {
    status = 'urgent';
    ack = { kind: 'urgent_signs', text: 'Reported a sign that needs urgent care; told to get seen today, no training until a clinician has seen them.', at, termsVersion: CURRENT_TERMS_VERSION };
  } else if (input.cleared === true) {
    status = 'cleared';
    ack = { kind: 'clearance', text: `Told Anakin a clinician cleared them${str(input.clearedBy) ? ` (${str(input.clearedBy)})` : ''}. Anakin relies on this and can’t verify it (Terms §4).`, at, termsVersion: CURRENT_TERMS_VERSION, ...(str(input.notes) ? { detail: str(input.notes).slice(0, 400) } : {}) };
  } else if (base.status === 'urgent' && input.seenByClinician === true) {
    status = 'gentle';
  }
  const checked = input.cleared === false || input.cleared === true;
  return {
    safety: { ...base, status, screen, ...(status === 'cleared' ? { clearedAt: at, clearedBy: str(input.clearedBy) || 'self-reported' } : {}), ...(checked ? { lastCheckAt: at } : {}) },
    ack,
  };
}

defineOp({
  name: 'safety.record',
  run: async (userId, args) => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true, constraintsText: true } });
    const cp = parseBlob(u?.coachProfile);
    const prev = { safety: cp.safety ?? null, safetyAcks: cp.safetyAcks ?? null, injuries: cp.injuries ?? null, constraintsText: u?.constraintsText ?? null };
    const { safety, ack } = nextSafety(cp.safety ?? null, args.input as Record<string, unknown>);
    // The vague sign-up answer becomes the specific one, in both places injuries live.
    const specific = injuryLine(safety);
    const replace = (v: unknown) => (typeof v === 'string' && (ONBOARDING_INJURY.test(v.trim()) || !v.trim()) ? specific : typeof v === 'string' && !v.includes(specific) ? `${v}; ${specific}` : v ?? specific);
    await mergeBlobKeys(userId, { safety, safetyAcks: [...(Array.isArray(cp.safetyAcks) ? cp.safetyAcks : []), ...(ack ? [ack] : [])], injuries: replace(cp.injuries) });
    await prisma.user.update({ where: { id: userId }, data: { constraintsText: String(replace(u?.constraintsText)).slice(0, 1000) } });
    return { result: { status: safety.status, rules: trainingRules(safety), injury: specific }, inverse: { op: 'safety.restore', args: prev }, summary: `Safety · ${safety.status}` };
  },
});
defineOp({
  name: 'safety.restore',
  run: async (userId, args) => {
    await mergeBlobKeys(userId, { safety: args.safety ?? null, safetyAcks: args.safetyAcks ?? null, injuries: args.injuries ?? null });
    await prisma.user.update({ where: { id: userId }, data: { constraintsText: (args.constraintsText as string | null) ?? null } });
    return { inverse: null, summary: 'Safety record restored' };
  },
});

export const SAFETY_TOOLS = [
  tool({
    name: 'record_safety_screen', kind: 'set', core: true, fn: 'SAF-01',
    description: 'Record what the user tells you about a red-flag symptom (the SAFETY line in context): limb (leg|arm|both|none), side (left|right|both), origin (lower back|neck|other|unsure), numbness, weakness, emergencySigns (true if ANY: bladder/bowel change, groin or inner-thigh numbness, worsening weakness, chest pain/fainting, after a fall or accident), cleared (true only when they say a doctor or physio cleared them; false when asked and not yet), clearedBy, seenByClinician, notes (what the clinician said to avoid, anything else). Only what they actually said — leave the rest out. Returns the training rules that hold until cleared: follow them, and check their current program against them (swap anything that breaks them with the program tools).',
    input_schema: schema({
      limb: { type: 'string', enum: ['leg', 'arm', 'both', 'none'] }, side: { type: 'string', enum: ['left', 'right', 'both'] },
      origin: { type: 'string', enum: ['lower back', 'neck', 'other', 'unsure'] },
      numbness: { type: 'boolean' }, weakness: { type: 'boolean' }, emergencySigns: { type: 'boolean' },
      cleared: { type: 'boolean' }, clearedBy: { type: 'string' }, seenByClinician: { type: 'boolean' },
      symptom: { type: 'string', description: 'Only when no red flag is on file: what they reported.' }, notes: { type: 'string' },
    }),
    receipt: () => ({ verb: 'Saved', text: 'Safety check' }),
    execute: async (input, userId) => {
      const change = await executeOp(userId, 'safety.record', { input });
      const r: any = change.result;
      return {
        status: r.status, rules: r.rules, injuryOnFile: r.injury,
        tellUser: r.status === 'urgent'
          ? 'Tell them plainly to get seen at urgent care or the ER today — not a workout — and that training waits until a clinician has seen them.'
          : r.status === 'cleared'
            ? 'Acknowledge the clearance; ask what the clinician said to avoid if they haven’t said; offer to move them to their full plan (propose_new_program at their normal days) — nothing changes until they tap.'
            : 'Keep it gentle: say in one line what you’ll avoid and why, check their program against the rules and propose swaps for anything that breaks them, and remind them to get it checked.',
        _change: change,
      };
    },
    card: (_i, r): CardDraft => ({
      fn: 'SAF-01', pattern: 'setting', rule: 'change_undo', meta: { label: r.status === 'urgent' ? 'Get seen today' : r.status === 'cleared' ? 'Cleared to train' : 'Safety check' },
      rows: [{ key: 'On file', value: String(r.injuryOnFile).slice(0, 120) }, ...(r.status === 'urgent' ? [{ key: 'Next', value: 'Urgent care or the ER today' }] : [])],
      note: r.status === 'urgent' ? 'Training waits until a clinician has seen you.' : r.status === 'cleared' ? 'Your plan can go back to normal — I’ll still respect anything they said to avoid.' : 'Your plan stays gentle and avoids what could aggravate it until a clinician clears you.',
    }),
  }),
];

registerToolkit(SAFETY_TOOLS);
