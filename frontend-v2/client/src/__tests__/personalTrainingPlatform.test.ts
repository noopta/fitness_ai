/**
 * Coach-platform helpers: grouping and colouring contraindications, what a
 * body part refuses at each clearance, the unit a measurement is typed in,
 * downscaled photo sizes and roster tag counts.
 */

import { describe, it, expect } from 'vitest';
import type { BodyPartMeta, Contraindication } from '@axiom/personal-training-core';
import {
  contraChip, contraGroupOf, defaultUnit, fitWithin, goalUnit, groupContraindications, hasTag, inferUnitPreference,
  isHex, isInferred, patternLabel, refusalsFor, tagCounts, unitOptions,
} from '@/features/personal-training/platform';
import { formFrom, inputFrom } from '@/features/personal-training/components/HealthTab';

const ci = (over: Partial<Contraindication>): Contraindication => ({
  id: 'r1', label: 'Left knee', active: true, bodyPart: 'knee', clearance: 'not_cleared', severity: 'moderate', needsReview: false, ...over,
});

const KNEE: BodyPartMeta = { key: 'knee', label: 'Knee', primary: ['squat', 'lunge'], secondary: ['knee_flexion', 'hinge'] };

describe('contraindication groups', () => {
  it('puts unreviewed items first, then by clearance, and drops empty groups', () => {
    const list = [
      ci({ id: 'a', clearance: 'modified' }),
      ci({ id: 'inferred:client:x', needsReview: true }),
      ci({ id: 'b', clearance: 'cleared', active: false }),
      ci({ id: 'c' }),
    ];
    expect(groupContraindications(list).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['review', ['inferred:client:x']],
      ['not_cleared', ['c']],
      ['modified', ['a']],
      ['cleared', ['b']],
    ]);
    expect(groupContraindications([ci({ id: 'only' })]).map((g) => g.group)).toEqual(['not_cleared']);
  });

  it('reads a legacy label-only record by its active flag', () => {
    expect(contraGroupOf({ label: 'Shoulder', active: true })).toBe('not_cleared');
    expect(contraGroupOf({ label: 'Shoulder', active: false })).toBe('cleared');
  });

  it('treats a resolved but unreviewed reading as cleared, not as review', () => {
    expect(contraGroupOf(ci({ needsReview: true, active: false }))).toBe('cleared');
  });

  it('knows inferred ids', () => {
    expect(isInferred({ id: 'inferred:client:abc' })).toBe(true);
    expect(isInferred({ id: 'row-1' })).toBe(false);
    expect(isInferred({})).toBe(false);
  });
});

describe('header chips', () => {
  it('is red while not cleared, amber once modified, hidden when cleared', () => {
    expect(contraChip(ci({}))).toEqual({ tone: 'red', review: false });
    expect(contraChip(ci({ clearance: 'modified', needsReview: true }))).toEqual({ tone: 'amber', review: true });
    expect(contraChip(ci({ clearance: 'cleared', active: false }))).toBeNull();
    expect(contraChip({ label: 'Old', active: false })).toBeNull();
    expect(contraChip({ label: 'Old', active: true })).toEqual({ tone: 'red', review: false });
  });
});

describe('refusals', () => {
  it('refuses every loading pattern while not cleared', () => {
    expect(refusalsFor(ci({}), KNEE)).toEqual({ refused: ['squat', 'lunge', 'knee_flexion', 'hinge'], warned: [] });
  });

  it('warns instead once modified, unless severe', () => {
    expect(refusalsFor(ci({ clearance: 'modified' }), KNEE)).toEqual({ refused: [], warned: ['squat', 'lunge', 'knee_flexion', 'hinge'] });
    expect(refusalsFor(ci({ clearance: 'modified', severity: 'severe' }), KNEE)).toEqual({ refused: ['squat', 'lunge'], warned: ['knee_flexion', 'hinge'] });
  });

  it('applies extra blocks and allowances on top of the defaults', () => {
    const r = refusalsFor(ci({ clearance: 'modified', extraBlocks: ['plyometric', 'hinge'], allow: ['lunge'] }), KNEE);
    expect(r.refused).toEqual(['plyometric', 'hinge']);
    expect(r.warned).toEqual(['squat', 'knee_flexion']);
  });

  it('refuses nothing once cleared', () => {
    expect(refusalsFor(ci({ clearance: 'cleared' }), KNEE)).toEqual({ refused: [], warned: [] });
  });

  it('labels pattern keys for people', () => {
    expect(patternLabel('knee_extension')).toBe('Knee extension');
    expect(patternLabel('squat')).toBe('Squat');
  });
});

describe('health editor form', () => {
  it('pre-fills a confirm from the inferred reading and posts it with fromInferred', () => {
    const inferred = ci({ id: 'inferred:client:abc', label: 'bad left knee', bodyPart: 'knee', side: 'left', severity: 'mild', note: 'since March', needsReview: true });
    const form = formFrom(inferred);
    expect(form).toMatchObject({ bodyPart: 'knee', side: 'left', condition: 'bad left knee', severity: 'mild', clearance: 'not_cleared', notes: 'since March' });
    expect(inputFrom(form, 'confirm', inferred)).toMatchObject({ fromInferred: 'inferred:client:abc', bodyPart: 'knee', side: 'left', notes: 'since March', onsetDate: null });
  });

  it('makes the trainer choose a body part the reading could not find', () => {
    expect(formFrom(ci({ bodyPart: 'unknown' })).bodyPart).toBe('');
  });

  it('sends no side and no fromInferred for an ordinary edit', () => {
    const input = inputFrom({ ...formFrom(ci({})), side: 'none' }, 'edit', ci({}));
    expect(input.side).toBeNull();
    expect(input).not.toHaveProperty('fromInferred');
  });
});

describe('measurement units', () => {
  it('offers the trainer’s own unit first', () => {
    expect(unitOptions('bodyweight', 'metric')).toEqual(['kg', 'lb']);
    expect(unitOptions('bodyweight', 'imperial')).toEqual(['lb', 'kg']);
    expect(unitOptions('waist', 'metric')).toEqual(['cm', 'in']);
    expect(defaultUnit('neck', 'imperial')).toBe('in');
    expect(unitOptions('body_fat', 'metric')).toEqual(['%']);
    expect(unitOptions('resting_hr', 'imperial')).toEqual(['bpm']);
    expect(unitOptions('custom', 'metric')).toEqual(['']);
  });

  it('gives goals the unit the server reads them in', () => {
    expect(goalUnit('bodyweight', 'metric')).toBe('kg');
    expect(goalUnit('e1rm:squat', 'imperial')).toBe('lb');
    expect(goalUnit('measurement:waist', 'metric')).toBe('cm');
    expect(goalUnit('sessions_per_week', 'metric')).toBe('sessions');
    expect(goalUnit('custom', 'metric')).toBe('');
  });

  it('infers the trainer’s preference from what the server returned', () => {
    expect(inferUnitPreference([{ unit: '%' }, { unit: 'cm' }])).toBe('metric');
    expect(inferUnitPreference([{ unit: 'lb' }])).toBe('imperial');
    expect(inferUnitPreference([], [{ unit: 'in' }])).toBe('imperial');
    expect(inferUnitPreference([{ unit: 'bpm' }], [{ unit: 'sessions' }])).toBeNull();
  });
});

describe('photo downscale', () => {
  it('fits the long side to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(1000, 500, 512)).toEqual({ width: 512, height: 256 });
  });

  it('never scales up and survives empty input', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(10000, 1)).toEqual({ width: 1600, height: 1 });
  });
});

describe('roster tags and colours', () => {
  it('counts tags, most used first', () => {
    expect(tagCounts([{ tags: ['online', 'vip'] }, { tags: ['online'] }, {}])).toEqual([{ tag: 'online', count: 2 }, { tag: 'vip', count: 1 }]);
    expect(hasTag({ tags: ['vip'] }, 'vip')).toBe(true);
    expect(hasTag({}, 'vip')).toBe(false);
    expect(hasTag({}, null)).toBe(true);
  });

  it('accepts only #RRGGBB', () => {
    expect(isHex('#1F6FEB')).toBe(true);
    expect(isHex('#1f6')).toBe(false);
    expect(isHex('1F6FEB')).toBe(false);
  });
});
