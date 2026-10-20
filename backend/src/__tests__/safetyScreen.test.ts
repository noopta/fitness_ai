// Red-flag follow-up (20 Oct 2026): a new user picked "Pain down a leg or arm",
// chose the gentle plan, and nobody asked which limb, where it starts, or about
// urgent-care signs.
import { describe, it, expect } from 'vitest';
import { flaggedAnswers, safetyFromOnboarding, followUpText, clearanceCheckDue, safetyContextLine, trainingRules, injuryLine, ACK_TEXT, type Safety } from '../services/safetyScreen.js';
import { nextSafety } from '../agent/toolkits/safety.js';
import { safetyNotice } from '../agent/notices.js';
import { CURRENT_TERMS_VERSION } from '../services/termsVersion.js';

const NOW = new Date('2026-10-20T18:00:00Z');
const gentle: Safety = { flags: ['Pain down a leg or arm'], status: 'gentle', since: NOW.toISOString() };

describe('onboarding red flags', () => {
  it('finds the flagged answers and records the choice with the Terms version', () => {
    expect(flaggedAnswers({ hurt: 'Pain down a leg', meds: 'Blood pressure or heart' })).toEqual(['Pain down a leg', 'Blood pressure or heart']);
    const r = safetyFromOnboarding({ hurt: 'Pain down a leg', redFlagRoute: 'gentle' }, NOW)!;
    expect(r.safety).toMatchObject({ status: 'gentle', flags: ['Pain down a leg'] });
    expect(r.acks[0]).toMatchObject({ kind: 'red_flag_gentle', text: ACK_TEXT.gentle, termsVersion: CURRENT_TERMS_VERSION });
    expect(safetyFromOnboarding({ hurt: 'No', redFlagRoute: 'gentle' })).toBeNull();
  });
});

describe('follow-up and clearance check', () => {
  it('asks which limb, where it starts, numbness and the urgent-care signs', () => {
    const t = followUpText(gentle)!;
    expect(t).toMatch(/Leg or arm — and which side/);
    expect(t).toMatch(/bladder or bowel/);
    expect(t).toMatch(/urgent care or the ER today/);
    expect(followUpText({ ...gentle, screen: { limb: 'leg', at: NOW.toISOString() } })).toBeNull();
  });
  it('checks clearance every two weeks on the gentle plan only', () => {
    expect(clearanceCheckDue(gentle, NOW.getTime() + 13 * 86_400_000)).toBe(false);
    expect(clearanceCheckDue(gentle, NOW.getTime() + 14 * 86_400_000)).toBe(true);
    expect(clearanceCheckDue({ ...gentle, status: 'cleared' }, NOW.getTime() + 30 * 86_400_000)).toBe(false);
  });
  it('posts the follow-up once, and never without health consent', () => {
    expect(safetyNotice(gentle, new Set(), true)?.key).toBe('safety-followup');
    expect(safetyNotice(gentle, new Set(['safety-followup']), true, NOW.getTime())).toBeNull();
    expect(safetyNotice(gentle, new Set(), false)).toBeNull();
  });
});

describe('recording the screen', () => {
  it('a lower-back leg symptom gets spine rules; the vague answer becomes specific', () => {
    const { safety } = nextSafety(gentle, { limb: 'leg', side: 'left', origin: 'lower back', numbness: true }, NOW);
    expect(safety.status).toBe('gentle');
    expect(trainingRules(safety).join(' ')).toMatch(/no loaded spinal flexion/);
    expect(trainingRules(safety).join(' ')).toMatch(/RPE ≤ 6/);
    expect(injuryLine(safety)).toBe('Radiating pain down the left leg from the lower back, numbness — not yet cleared by a clinician');
  });
  it('an arm symptom from the neck gets no-overhead rules', () => {
    const { safety } = nextSafety(gentle, { limb: 'arm', origin: 'neck' }, NOW);
    expect(trainingRules(safety).join(' ')).toMatch(/no overhead pressing/);
  });
  it('any urgent sign wins, with a dated record', () => {
    const { safety, ack } = nextSafety(gentle, { limb: 'leg', emergencySigns: true, cleared: true }, NOW);
    expect(safety.status).toBe('urgent');
    expect(ack?.kind).toBe('urgent_signs');
    expect(safetyContextLine(safety)).toMatch(/URGENT/);
  });
  it('a clearance ends the gentle plan and is recorded as self-reported', () => {
    const { safety, ack } = nextSafety(gentle, { cleared: true, clearedBy: 'physio', notes: 'no deadlifts for 4 weeks' }, NOW);
    expect(safety.status).toBe('cleared');
    expect(ack).toMatchObject({ kind: 'clearance', termsVersion: CURRENT_TERMS_VERSION });
    expect(ack?.text).toMatch(/can’t verify/);
    expect(trainingRules(safety)).toEqual(['Cleared by a clinician; follow what they said: no deadlifts for 4 weeks']);
  });
  it('the context line demands the follow-up first', () => {
    expect(safetyContextLine(gentle)).toMatch(/FOLLOW-UP NOT DONE/);
  });
});
