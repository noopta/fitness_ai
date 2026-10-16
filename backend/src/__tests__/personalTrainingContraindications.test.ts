import { describe, expect, it } from 'vitest';
import {
  exercisePatterns, inferBodyPart, inferSeverity, inferSide, patternBlocked, patternsFor, programExerciseNames, validateExercises,
  type RuleInput,
} from '../services/personalTraining/contraindicationRules.js';

const knee = (over: Partial<RuleInput> = {}): RuleInput => ({ id: 'k1', bodyPart: 'knee', condition: 'ACL reconstruction', clearance: 'not_cleared', severity: 'severe', ...over });

describe('exercisePatterns', () => {
  it.each([
    ['Back Squat', ['squat', 'axial_load']],
    ['Goblet Squat', ['squat']],
    ['Bulgarian Split Squat', ['lunge']],
    ['Romanian Deadlift', ['hinge', 'grip', 'axial_load']],
    ['Leg Curl', ['knee_flexion']],
    ['Barbell Curl', ['elbow_flexion']],
    ['Seated Dumbbell Shoulder Press', ['overhead_press']],
    ['Pull-Up', ['vertical_pull', 'grip']],
    ['Box Jump', ['plyometric']],
    ['Hip Thrust', ['hip_thrust', 'supine']],
  ])('%s', (name, expected) => {
    expect(exercisePatterns(name).sort()).toEqual([...expected].sort());
  });

  it('returns nothing for a name it cannot read', () => {
    expect(exercisePatterns('Zottman thing')).toEqual([]);
  });
});

describe('inference from free text', () => {
  it('maps common injury phrases to body parts', () => {
    expect(inferBodyPart('Achilles rupture, not cleared')).toBe('calf_achilles');
    expect(inferBodyPart('torn ACL left knee')).toBe('knee');
    expect(inferBodyPart('L5 disc herniation')).toBe('lower_back');
    expect(inferBodyPart('rotator cuff impingement')).toBe('shoulder');
    expect(inferBodyPart('30 weeks pregnant')).toBe('systemic');
    expect(inferBodyPart('feels off sometimes')).toBe('unknown');
  });
  it('reads severity and side', () => {
    expect(inferSeverity('torn meniscus')).toBe('severe');
    expect(inferSeverity('tight hamstring')).toBe('mild');
    expect(inferSeverity('sore shoulder')).toBe('moderate');
    expect(inferSide('left knee')).toBe('left');
    expect(inferSide('both wrists')).toBe('both');
    expect(inferSide('lower back')).toBeNull();
  });
});

describe('validateExercises', () => {
  it('refuses knee-loading work while the knee is not cleared, and passes upper body', () => {
    const r = validateExercises([knee()], ['Back Squat', 'Walking Lunge', 'Bench Press', 'Lat Pulldown']);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.exercise)).toEqual(['Back Squat', 'Walking Lunge']);
    expect(r.violations.every((v) => v.level === 'block')).toBe(true);
    expect(r.checked).toBe(1);
  });

  it('turns secondary patterns into acknowledgeable warnings once modified', () => {
    const c = knee({ clearance: 'modified', severity: 'moderate' });
    const r = validateExercises([c], ['Romanian Deadlift', 'Leg Extension']);
    expect(r.violations.map((v) => [v.exercise, v.level])).toEqual([['Romanian Deadlift', 'warn'], ['Leg Extension', 'warn']]);
    const acked = validateExercises([c], ['Romanian Deadlift', 'Leg Extension'], new Set(['romanian deadlift|k1', 'leg extension|k1']));
    expect(acked.ok).toBe(true);
  });

  it('keeps primary patterns blocked for a severe injury even when modified, and acknowledging never clears a block', () => {
    const c = knee({ clearance: 'modified', severity: 'severe' });
    const r = validateExercises([c], ['Back Squat'], new Set(['back squat|k1']));
    expect(r.violations[0].level).toBe('block');
  });

  it('ignores cleared and inactive contraindications', () => {
    expect(validateExercises([knee({ clearance: 'cleared' })], ['Back Squat']).ok).toBe(true);
    expect(validateExercises([knee({ active: false })], ['Back Squat']).ok).toBe(true);
  });

  it('applies trainer allow and extra-block overrides', () => {
    expect(validateExercises([knee({ allow: ['squat', 'axial_load'] })], ['Box Squat']).ok).toBe(true);
    const shoulder: RuleInput = { id: 's1', bodyPart: 'shoulder', condition: 'impingement', clearance: 'cleared', severity: 'mild' };
    expect(validateExercises([shoulder], ['Bench Press']).ok).toBe(true);
  });

  it('reports exercises and conditions it cannot classify instead of passing them silently', () => {
    const unknown: RuleInput = { id: 'u1', bodyPart: 'unknown', condition: 'mystery pain', clearance: 'not_cleared', severity: 'moderate' };
    const r = validateExercises([unknown], ['Zottman thing']);
    expect(r.unclassified).toEqual(['Zottman thing']);
    expect(r.unclassifiedConditions).toEqual(['mystery pain']);
  });

  it('dedupes repeated exercises', () => {
    expect(validateExercises([knee()], ['Back Squat', 'back squat']).violations).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('patternsFor gives an unknown body part only its explicit extra blocks', () => {
    const r = patternsFor({ id: 'x', bodyPart: 'unknown', condition: 'x', clearance: 'not_cleared', severity: 'moderate', extraBlocks: ['running'] });
    expect([...r.block]).toEqual(['running']);
  });
  it('patternBlocked finds what refuses a pattern', () => {
    expect(patternBlocked([knee()], 'squat').map((c) => c.id)).toEqual(['k1']);
    expect(patternBlocked([knee()], 'horizontal_press')).toEqual([]);
  });
  it('programExerciseNames reads both the builder and saved-program shapes', () => {
    expect(programExerciseNames({ weeks: [{ days: [{ blocks: [{ items: [{ name: 'Squat' }, { name: 'Row' }] }] }] }] })).toEqual(['Squat', 'Row']);
    expect(programExerciseNames({ phases: [{ trainingDays: [{ exercises: [{ name: 'Bench Press' }] }] }] })).toEqual(['Bench Press']);
  });
});

describe('enforcement in the app program generator', () => {
  it('strips blocked exercises from a saved-program and rests an emptied day', async () => {
    const { stripBlocked, hardRulesPrompt } = await import('../services/personalTraining/contraindicationRules.js');
    const program = { phases: [{ trainingDays: [
      { day: 'Mon — Legs', focus: 'Legs', exercises: [{ name: 'Back Squat' }, { name: 'Walking Lunge' }] },
      { day: 'Wed — Upper', focus: 'Upper', exercises: [{ name: 'Bench Press' }, { name: 'Leg Extension' }] },
    ] }] };
    const { program: out, removed } = stripBlocked(program, [knee()]);
    expect(removed.sort()).toEqual(['Back Squat', 'Leg Extension', 'Walking Lunge']);
    expect(out.phases[0].trainingDays[0]).toMatchObject({ focus: 'Rest', day: 'Mon — Rest', exercises: [] });
    expect(out.phases[0].trainingDays[1].exercises.map((e: any) => e.name)).toEqual(['Bench Press']);
    expect(hardRulesPrompt([knee()])).toContain('ACL reconstruction (knee, not cleared): no squat');
    expect(hardRulesPrompt([knee({ clearance: 'cleared' })])).toBe('');
  });
});
