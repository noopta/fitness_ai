/**
 * Program builder logic as pure functions: the document reducer (weeks, days,
 * blocks, items, moves and nudges, limits), how the rules engine's check maps
 * onto the canvas, the publish blocker, and the helpers behind Generate with
 * Axiom, the library form, nutrition targets, the programs filter and money.
 */

import { describe, it, expect } from 'vitest';
import type { ProgramCheck, ProgramDoc, ProgramSummary } from '@axiom/personal-training-core';
import {
  LIMITS, ackKey, acknowledgeable, docReducer, locate, publishBlocker, refusalNotes, violationsByItem, worstLevel,
} from '@/features/personal-training/programDoc';
import { generateDefaults, progressLine } from '@/features/personal-training/components/ProgramDialogs';
import { validateExerciseForm, formOf, inScope } from '@/features/personal-training/pages/LibraryPage';
import { targetsFrom, money } from '@/features/personal-training/components/DossierBusinessTabs';
import { matchesFilter } from '@/features/personal-training/pages/ProgramsPage';
import { saveLabel } from '@/features/personal-training/pages/ProgramBuilderPage';

const doc = (): ProgramDoc => ({
  weeks: [{
    id: 'w1', label: 'Week 1',
    days: [
      { id: 'd1', name: 'Lower', weekday: 1, blocks: [
        { id: 'b1', kind: 'single', items: [{ id: 'i1', name: 'Back squat', sets: 5, reps: '5', load: { type: 'percent1rm', value: 75 } }] },
        { id: 'b2', kind: 'superset', rounds: 3, items: [{ id: 'i2', name: 'Leg curl', sets: 3, reps: '10' }, { id: 'i3', name: 'Plank', sets: 3, reps: '30s' }] },
      ] },
      { id: 'd2', name: 'Upper', weekday: 3, blocks: [{ id: 'b3', kind: 'single', items: [{ id: 'i4', name: 'Bench press', sets: 4, reps: '6' }] }] },
    ],
  }],
});

const ids = (d: ProgramDoc) => d.weeks.flatMap((w) => [w.id, ...w.days.flatMap((x) => [x.id, ...x.blocks.flatMap((b) => [b.id, ...b.items.map((i) => i.id)])])]);
const itemsOf = (d: ProgramDoc, blockId: string) => d.weeks.flatMap((w) => w.days.flatMap((x) => x.blocks)).find((b) => b.id === blockId)!.items.map((i) => i.id);
const blocksOf = (d: ProgramDoc, dayId: string) => d.weeks.flatMap((w) => w.days).find((x) => x.id === dayId)!.blocks.map((b) => b.id);

describe('weeks and days', () => {
  it('adds a week with the last week’s day names, empty', () => {
    const next = docReducer(doc(), { type: 'addWeek' });
    expect(next.weeks).toHaveLength(2);
    expect(next.weeks[1].label).toBe('Week 2');
    expect(next.weeks[1].days.map((d) => [d.name, d.weekday, d.blocks.length])).toEqual([['Lower', 1, 0], ['Upper', 3, 0]]);
  });

  it('duplicates a week with fresh ids everywhere', () => {
    const before = doc();
    const next = docReducer(before, { type: 'duplicateWeek', weekId: 'w1' });
    expect(next.weeks).toHaveLength(2);
    expect(next.weeks[1].days[0].blocks[0].items[0].name).toBe('Back squat');
    const original = new Set(ids(before));
    expect(ids({ weeks: [next.weeks[1]] }).some((id) => original.has(id))).toBe(false);
    expect(new Set(ids(next)).size).toBe(ids(next).length);
  });

  it('never deletes the last week, and respects the week limit', () => {
    expect(docReducer(doc(), { type: 'deleteWeek', weekId: 'w1' }).weeks).toHaveLength(1);
    let d = doc();
    for (let i = 0; i < 20; i++) d = docReducer(d, { type: 'addWeek' });
    expect(d.weeks).toHaveLength(LIMITS.weeks);
  });

  it('copies a day into another week with new ids', () => {
    const two = docReducer(doc(), { type: 'addWeek' });
    const w2 = two.weeks[1].id;
    const next = docReducer(two, { type: 'copyDayToWeek', dayId: 'd1', weekId: w2 });
    const copy = next.weeks[1].days[2];
    expect(copy.name).toBe('Lower');
    expect(copy.blocks.map((b) => b.items.map((i) => i.name))).toEqual([['Back squat'], ['Leg curl', 'Plank']]);
    expect(copy.id).not.toBe('d1');
    expect(copy.blocks[0].items[0].id).not.toBe('i1');
  });

  it('updates and deletes a day', () => {
    const named = docReducer(doc(), { type: 'updateDay', dayId: 'd2', patch: { name: 'Push', weekday: null } });
    expect(named.weeks[0].days[1]).toMatchObject({ name: 'Push', weekday: null });
    expect(docReducer(named, { type: 'deleteDay', dayId: 'd2' }).weeks[0].days.map((d) => d.id)).toEqual(['d1']);
  });
});

describe('blocks', () => {
  it('sets rounds and a time cap to match the kind', () => {
    let d = docReducer(doc(), { type: 'updateBlock', blockId: 'b1', patch: { kind: 'amrap' } });
    expect(d.weeks[0].days[0].blocks[0]).toMatchObject({ kind: 'amrap', timeCapMin: 10 });
    expect(d.weeks[0].days[0].blocks[0]).not.toHaveProperty('rounds');
    d = docReducer(d, { type: 'updateBlock', blockId: 'b1', patch: { kind: 'circuit' } });
    expect(d.weeks[0].days[0].blocks[0]).toMatchObject({ kind: 'circuit', rounds: 3 });
    expect(d.weeks[0].days[0].blocks[0]).not.toHaveProperty('timeCapMin');
  });

  it('reorders blocks within a day and moves them to another day', () => {
    expect(blocksOf(docReducer(doc(), { type: 'nudgeBlock', blockId: 'b1', dir: 1 }), 'd1')).toEqual(['b2', 'b1']);
    expect(blocksOf(docReducer(doc(), { type: 'nudgeBlock', blockId: 'b1', dir: -1 }), 'd1')).toEqual(['b1', 'b2']);
    expect(blocksOf(docReducer(doc(), { type: 'moveBlock', blockId: 'b2', toDayId: 'd1', toIndex: 0 }), 'd1')).toEqual(['b2', 'b1']);
    const moved = docReducer(doc(), { type: 'moveBlock', blockId: 'b2', toDayId: 'd2', toIndex: 0 });
    expect(blocksOf(moved, 'd1')).toEqual(['b1']);
    expect(blocksOf(moved, 'd2')).toEqual(['b2', 'b3']);
  });

  it('adds a block with one empty exercise', () => {
    const d = docReducer(doc(), { type: 'addBlock', dayId: 'd2', kind: 'emom' });
    const b = d.weeks[0].days[1].blocks[1];
    expect(b).toMatchObject({ kind: 'emom', timeCapMin: 10 });
    expect(b.items).toHaveLength(1);
    expect(b.items[0].name).toBe('');
  });
});

describe('items', () => {
  it('moves an item within a block, in either direction', () => {
    expect(itemsOf(docReducer(doc(), { type: 'moveItem', itemId: 'i2', toBlockId: 'b2', toIndex: 2 }), 'b2')).toEqual(['i3', 'i2']);
    expect(itemsOf(docReducer(doc(), { type: 'moveItem', itemId: 'i3', toBlockId: 'b2', toIndex: 0 }), 'b2')).toEqual(['i3', 'i2']);
  });

  it('moves an item between blocks and between days', () => {
    const d = docReducer(doc(), { type: 'moveItem', itemId: 'i1', toBlockId: 'b2', toIndex: 1 });
    expect(itemsOf(d, 'b1')).toEqual([]);
    expect(itemsOf(d, 'b2')).toEqual(['i2', 'i1', 'i3']);
    const e = docReducer(doc(), { type: 'moveItem', itemId: 'i4', toBlockId: 'b1', toIndex: 0 });
    expect(itemsOf(e, 'b1')).toEqual(['i4', 'i1']);
    expect(itemsOf(e, 'b3')).toEqual([]);
  });

  it('nudges past a block edge into the neighbouring block, and stops at the ends of the day', () => {
    expect(itemsOf(docReducer(doc(), { type: 'nudgeItem', itemId: 'i1', dir: 1 }), 'b2')).toEqual(['i1', 'i2', 'i3']);
    expect(itemsOf(docReducer(doc(), { type: 'nudgeItem', itemId: 'i2', dir: -1 }), 'b1')).toEqual(['i1', 'i2']);
    expect(docReducer(doc(), { type: 'nudgeItem', itemId: 'i1', dir: -1 })).toEqual(doc());
    expect(docReducer(doc(), { type: 'nudgeItem', itemId: 'i3', dir: 1 })).toEqual(doc());
  });

  it('refuses to overfill a block', () => {
    let d = doc();
    for (let i = 0; i < 12; i++) d = docReducer(d, { type: 'addItem', blockId: 'b3' });
    expect(itemsOf(d, 'b3')).toHaveLength(LIMITS.items);
    const before = itemsOf(d, 'b3');
    expect(itemsOf(docReducer(d, { type: 'moveItem', itemId: 'i1', toBlockId: 'b3', toIndex: 0 }), 'b3')).toEqual(before);
  });

  it('edits and removes an item', () => {
    const d = docReducer(doc(), { type: 'updateItem', itemId: 'i4', patch: { name: 'Incline press', exerciseId: 'builtin:incline', load: { type: 'rpe', value: 8 } } });
    expect(d.weeks[0].days[1].blocks[0].items[0]).toMatchObject({ name: 'Incline press', exerciseId: 'builtin:incline', load: { type: 'rpe', value: 8 } });
    expect(itemsOf(docReducer(d, { type: 'deleteItem', itemId: 'i4' }), 'b3')).toEqual([]);
  });

  it('finds any node by id', () => {
    expect(locate(doc(), 'i3')).toEqual({ week: 0, day: 0, block: 1, item: 1 });
    expect(locate(doc(), 'd2')).toEqual({ week: 0, day: 1 });
    expect(locate(doc(), 'nope')).toBeNull();
  });
});

const check = (over: Partial<ProgramCheck> = {}): ProgramCheck => ({
  publishable: false, issues: [],
  guardrails: {
    checked: 1, ok: false, label: '1 conflict, 1 warning', unclassified: [], unclassifiedConditions: [],
    violations: [
      { exercise: 'Back squat', pattern: 'squat', contraindicationId: 'c1', condition: 'Left knee', bodyPart: 'knee', level: 'block', reason: 'Back squat loads squat' },
      { exercise: 'Leg Curl', pattern: 'knee_flexion', contraindicationId: 'c1', condition: 'Left knee', bodyPart: 'knee', level: 'warn', reason: 'Leg curl loads knee flexion' },
      { exercise: 'Leg Curl', pattern: 'knee_flexion', contraindicationId: 'c1', condition: 'Left knee', bodyPart: 'knee', level: 'warn', reason: 'again' },
    ],
  },
  ...over,
});

describe('the check on the canvas', () => {
  it('maps violations onto every item of that name, case-insensitively', () => {
    const d = docReducer(doc(), { type: 'duplicateWeek', weekId: 'w1' });
    const map = violationsByItem(d, check());
    const squats = d.weeks.flatMap((w) => w.days[0].blocks[0].items.map((i) => i.id));
    expect(squats.every((id) => worstLevel(map.get(id)) === 'block')).toBe(true);
    expect(worstLevel(map.get('i2'))).toBe('warn');
    expect(map.has('i4')).toBe(false);
    expect(violationsByItem(d, null).size).toBe(0);
  });

  it('builds acknowledge keys the server accepts and offers each warning once, never a block', () => {
    expect(ackKey({ exercise: ' Leg Curl ', contraindicationId: 'c1' })).toBe('leg curl|c1');
    expect(acknowledgeable(check()).map(ackKey)).toEqual(['leg curl|c1']);
  });

  it('says why a program cannot be published', () => {
    const base = { isTemplate: false, clientId: 'u1', status: 'draft' as const };
    expect(publishBlocker({ ...base, check: check() })).toBe('Resolve the refusal before publishing.');
    expect(publishBlocker({ ...base, check: check({ guardrails: { ...check().guardrails!, violations: check().guardrails!.violations.slice(1, 2) } }) })).toBe('Acknowledge or change the warning before publishing.');
    expect(publishBlocker({ ...base, check: { publishable: false, issues: [{ level: 'block', where: 'program', text: 'Add at least one exercise' }], guardrails: null } })).toBe('Resolve the refusal before publishing.');
    expect(publishBlocker({ ...base, isTemplate: true, clientId: null, check: check() })).toMatch(/Templates are not published/);
    expect(publishBlocker({ ...base, check: { publishable: true, issues: [], guardrails: null } })).toBeNull();
  });

  it('picks out the refusals Axiom wrote while drafting', () => {
    expect(refusalNotes([
      { target: 'program', kind: 'removed', text: 'Not programmed: box jumps' },
      { target: 'i1', kind: 'rationale', text: 'Main lift' },
      { target: 'program', kind: 'guardrail', text: 'Swapped deadlifts for hip thrusts' },
    ]).map((a) => a.kind)).toEqual(['removed', 'guardrail']);
  });
});

describe('generate, library, nutrition, list and money helpers', () => {
  it('moves the progress line on over time and holds the last step', () => {
    expect(progressLine(0)).toBe('Reading the intake and injuries on file');
    expect(progressLine(10)).toBe('Drafting the weeks');
    expect(progressLine(600)).toBe('Nearly there');
  });

  it('pre-fills days a week from the client, within 1–7', () => {
    expect(generateDefaults({ sessionsPerWeek: 4 })).toMatchObject({ weeks: 4, daysPerWeek: 4, sessionMinutes: 60 });
    expect(generateDefaults({ sessionsPerWeek: 12 }).daysPerWeek).toBe(7);
    expect(generateDefaults(undefined).daysPerWeek).toBe(3);
  });

  it('validates the exercise form like the server', () => {
    expect(validateExerciseForm(formOf(null))).toHaveProperty('name');
    expect(validateExerciseForm({ ...formOf(null), name: 'Hip airplane' })).toEqual({});
    expect(validateExerciseForm({ ...formOf(null), name: 'Hip airplane', videoUrl: 'http://youtu.be/x1234' })).toHaveProperty('videoUrl');
    expect(validateExerciseForm({ ...formOf(null), name: 'Hip airplane', videoUrl: 'https://youtu.be/x1234' })).toEqual({});
  });

  it('filters the library by scope', () => {
    const builtIn = { id: 'builtin:x', name: 'Squat', builtIn: true, patterns: [], equipment: [], primaryMuscle: null, videoUrl: null, cues: null };
    expect(inScope(builtIn, 'builtin')).toBe(true);
    expect(inScope(builtIn, 'mine')).toBe(false);
    expect(inScope({ ...builtIn, builtIn: false }, 'mine')).toBe(true);
  });

  it('reads nutrition targets: empty clears, junk refuses', () => {
    expect(targetsFrom({ calories: '2200', proteinG: '150.4', carbsG: '', fatG: '70' })).toEqual({ calories: 2200, proteinG: 150, carbsG: null, fatG: 70 });
    expect(targetsFrom({ calories: '-1', proteinG: '', carbsG: '', fatG: '' })).toBeNull();
  });

  it('filters the programs list', () => {
    const p = (over: Partial<ProgramSummary>): ProgramSummary => ({ id: 'p', clientId: 'u', name: 'P', status: 'draft', isTemplate: false, weeks: 4, daysPerWeek: 3, source: 'manual', updatedAt: '', ...over });
    expect(matchesFilter(p({}), 'draft')).toBe(true);
    expect(matchesFilter(p({ status: 'published' }), 'published')).toBe(true);
    expect(matchesFilter(p({ isTemplate: true, clientId: null }), 'draft')).toBe(false);
    expect(matchesFilter(p({ isTemplate: true, clientId: null }), 'templates')).toBe(true);
  });

  it('formats money and save states', () => {
    expect(money(12_000, 'gbp')).toMatch(/120/);
    expect(saveLabel('saving')).toBe('Saving…');
    expect(saveLabel('saved')).toBe('Saved');
  });
});
