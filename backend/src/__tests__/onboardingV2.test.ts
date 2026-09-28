import { describe, it, expect } from 'vitest';
import { goalKind, profileFromAnswers, phasesFromProgram, nutritionLine } from '../services/onboardingV2.js';

describe('goalKind', () => {
  it('classifies the three demo goals and a generic one', () => {
    expect(goalKind('Pull a 350 lb deadlift')).toBe('strength');
    expect(goalKind('Fix my lower back')).toBe('pain');
    expect(goalKind('Rehab a ruptured Achilles')).toBe('rehab');
    expect(goalKind('feel better')).toBe('general');
  });
});

describe('profileFromAnswers', () => {
  it('writes the same profile fields the v1 intake did', () => {
    const r = profileFromAnswers('Pull a 350 lb deadlift', { days: '4', age: '1–3 years', equipment: 'Full gym', region: 'Western', bw: '80–100 kg / 175–220' });
    expect(r.daysPerWeek).toBe(4);
    expect(r.durationWeeks).toBe(12);
    expect(r.profileUpdate.coachGoal).toBe('Pull a 350 lb deadlift');
    expect(r.profileUpdate.coachOnboardingDone).toBe(true);
    expect(r.profileUpdate.trainingAge).toBe('1–3 years');
    expect(r.profileUpdate.equipment).toBe('Full gym');
    expect(r.profileUpdate.foodRegion).toBe('Western');
    expect(r.profileUpdate.weightKg).toBe(90);
    const cp = JSON.parse(r.profileUpdate.coachProfile);
    expect(cp.primaryGoal).toBe('Pull a 350 lb deadlift');
    expect(cp.daysPerWeek).toBe(4);
    expect(cp.answers.age).toBe('1–3 years');
  });
  it('folds pain and red-flag answers into constraintsText', () => {
    const r = profileFromAnswers('Fix my lower back', { leg: 'Yes', hurt: 'Lower back, sometimes', redFlagRoute: 'cleared' });
    expect(r.profileUpdate.constraintsText).toContain('radiating leg pain');
    expect(r.profileUpdate.constraintsText).toContain('Lower back');
    expect(r.kind).toBe('pain');
    expect(r.durationWeeks).toBe(12);
  });
  it('clamps days to 2–6 and defaults to 4', () => {
    expect(profileFromAnswers('x', { days: '5+' }).daysPerWeek).toBe(5);
    expect(profileFromAnswers('x', { days: '9' }).daysPerWeek).toBe(6);
    expect(profileFromAnswers('x', {}).daysPerWeek).toBe(4);
  });
  it('uses a pre-filled days value when the question was skipped', () => {
    expect(profileFromAnswers('x', {}, [{ key: 'days', label: 'Days', value: '3', source: 'logs' }]).daysPerWeek).toBe(3);
  });
});

describe('phasesFromProgram / nutritionLine', () => {
  it('reads either phase shape', () => {
    expect(phasesFromProgram({ phases: [{ phaseName: 'Base', durationWeeks: 4, description: 'Volume' }, { name: 'Build', weeks: 5 }] }))
      .toEqual([{ name: 'Base', weeks: 4, focus: 'Volume' }, { name: 'Build', weeks: 5, focus: '' }]);
    expect(phasesFromProgram(null)).toEqual([]);
  });
  it('prefers the generated nutrition plan and falls back by goal kind', () => {
    expect(nutritionLine({ nutritionPlan: { calories: 2600, proteinG: 180 } }, 'strength')).toBe('180 g protein · 2600 kcal a day.');
    expect(nutritionLine({}, 'rehab')).toMatch(/Collagen/);
    expect(nutritionLine({}, 'pain')).toMatch(/Omega-3/);
  });
});
