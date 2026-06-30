import { describe, it, expect } from 'vitest';
import {
  macroPercents, studiesCitedCount, refsForSection,
  buildPhases, buildExercises, buildVolumeTiles, buildNutrition, firstNameOf,
} from '@/components/coach/revealModel';
import type { ProgramSource } from '@/components/coach/ProgramSetup';

const sources: ProgramSource[] = [
  { id: 'src-1', source: 'NASM Essentials', chapter: 'Periodization', sections: ['periodization', 'volume'] },
  { id: 'src-2', source: 'ACE Manual', chapter: 'Nutrition', sections: ['nutrition'] },
];

describe('macroPercents', () => {
  it('derives whole percentages that sum to 100', () => {
    const p = macroPercents({ proteinG: 186, carbsG: 220, fatG: 74 })!;
    expect(p.protein + p.carbs + p.fat).toBe(100);
    expect(p.protein).toBeGreaterThan(0);
  });
  it('returns null when no macro energy (omit, don\'t fake)', () => {
    expect(macroPercents({ proteinG: 0, carbsG: 0, fatG: 0 })).toBeNull();
    expect(macroPercents(null)).toBeNull();
  });
});

describe('studiesCitedCount / refsForSection', () => {
  it('counts real sources, zero when absent', () => {
    expect(studiesCitedCount(sources)).toBe(2);
    expect(studiesCitedCount(undefined)).toBe(0);
  });
  it('filters sources by section', () => {
    expect(refsForSection(sources, 'periodization').map(s => s.id)).toEqual(['src-1']);
    expect(refsForSection(sources, 'nutrition').map(s => s.id)).toEqual(['src-2']);
    expect(refsForSection(sources, 'exercise')).toEqual([]);
  });
});

describe('buildPhases', () => {
  it('reads backend shape (phaseName/weeksLabel/durationWeeks) and flags the first as current', () => {
    const phases = buildPhases({ phases: [
      { phaseName: 'Foundation', weeksLabel: 'Weeks 1-4', durationWeeks: 4 },
      { phaseName: 'Build', weeksLabel: 'Weeks 5-8', durationWeeks: 4 },
    ] });
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({ name: 'Foundation', weeks: 4, isCurrent: true });
    expect(phases[1].isCurrent).toBe(false);
  });
  it('tolerates client-normalised shape (name/weeks)', () => {
    const phases = buildPhases({ phases: [{ name: 'P1', weeks: 3 }] });
    expect(phases[0]).toMatchObject({ name: 'P1', weeks: 3 });
  });
  it('returns [] when no phases', () => {
    expect(buildPhases({})).toEqual([]);
  });
});

describe('buildExercises', () => {
  it('pulls first-day exercises with tag + reason', () => {
    const ex = buildExercises({ phases: [{ trainingDays: [{ exercises: [
      { exercise: 'Bench', sets: 4, reps: '6', intensity: 'RPE 7', notes: 'Scap retraction' },
    ] }] }] });
    expect(ex[0]).toEqual({ name: 'Bench', tag: 'RPE 7', reason: 'Scap retraction' });
  });
});

describe('buildVolumeTiles', () => {
  it('derives sets/session and rep range, omits e1RM', () => {
    const tiles = buildVolumeTiles({ phases: [{ trainingDays: [{ exercises: [
      { sets: 4, reps: '6', intensity: 'RPE 7' },
      { sets: 3, reps: '8-10', intensity: 'RPE 8' },
    ] }] }] });
    expect(tiles).toEqual(expect.arrayContaining([
      { value: '7', label: 'sets / session' },
      { value: '6–10', label: 'rep range' },
    ]));
    // No e1RM/%1RM tile is ever fabricated.
    expect(tiles.some(t => /1RM/i.test(t.value))).toBe(false);
  });
  it('returns [] when there is no training day', () => {
    expect(buildVolumeTiles({ phases: [] })).toEqual([]);
  });
});

describe('buildNutrition', () => {
  it('reads nutritionPlan.macros and derives percents', () => {
    const n = buildNutrition({ nutritionPlan: { macros: { proteinG: 186, carbsG: 220, fatG: 74, calories: 2560 } } })!;
    expect(n.proteinG).toBe(186);
    expect(n.calories).toBe(2560);
    expect(n.percents!.protein + n.percents!.carbs + n.percents!.fat).toBe(100);
  });
  it('returns null when no nutrition data', () => {
    expect(buildNutrition({})).toBeNull();
  });
});

describe('firstNameOf', () => {
  it('takes the first token, falls back to a neutral greeting', () => {
    expect(firstNameOf('Mark Johnson')).toBe('Mark');
    expect(firstNameOf('  ')).toBe('there');
    expect(firstNameOf(null)).toBe('there');
  });
});
