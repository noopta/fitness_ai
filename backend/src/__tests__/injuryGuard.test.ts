import { describe, it, expect } from 'vitest';
import { cleanInjuryText, lowerBodyBlocked, lowerBodyExercises, stripLowerBody, hardConstraintBlock } from '../services/injuryGuard.js';

const ACHILLES = 'No; Achilles tendon (rupture) — Reported Achilles tendon rupture, not yet cleared by a doctor or PT for loading.';

describe('injury guard', () => {
  it('cleans intake artifacts', () => {
    expect(cleanInjuryText(ACHILLES, ACHILLES)).toBe('Achilles tendon (rupture) — Reported Achilles tendon rupture, not yet cleared by a doctor or PT for loading.');
    expect(cleanInjuryText('No', null, 'none')).toBe('');
  });
  it('blocks the lower body for an un-cleared lower-limb injury only', () => {
    expect(lowerBodyBlocked(cleanInjuryText(ACHILLES))).toBe(true);
    expect(lowerBodyBlocked('Lower back, sometimes')).toBe(false);
    expect(lowerBodyBlocked('Old knee pain, fine now')).toBe(false);
  });
  it('finds lower-body exercises but not arm curls', () => {
    const p = { phases: [{ trainingDays: [{ day: 'Mon — Upper', exercises: [{ name: 'Bench Press' }, { name: 'Hammer Curl' }, { name: 'Bulgarian bicep curl' }] }, { day: 'Tue — Lower', exercises: [{ name: 'Back Squat' }, { name: 'Romanian Deadlift' }, { name: 'Leg Curl' }] }] }] };
    expect(lowerBodyExercises(p).sort()).toEqual(['Back Squat', 'Leg Curl', 'Romanian Deadlift']);
    const s = stripLowerBody(p);
    expect(s.phases[0].trainingDays[1]).toMatchObject({ day: 'Tue — Rest', focus: 'Rest', exercises: [] });
    expect(s.phases[0].trainingDays[0].exercises).toHaveLength(3);
  });
  it('leads with the rule and caps an upper-only week at four days', () => {
    const h = hardConstraintBlock(cleanInjuryText(ACHILLES), 6);
    expect(h.daysPerWeek).toBe(4);
    expect(h.block).toMatch(/^HARD CONSTRAINTS/);
    expect(h.block).toContain('NO squats');
    expect(hardConstraintBlock('', 6)).toEqual({ block: '', daysPerWeek: 6 });
  });
});
