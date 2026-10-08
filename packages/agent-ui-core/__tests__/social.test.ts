import { describe, it, expect } from 'vitest';
import { interleave, composeBody, cropRect } from '../src/social';

describe('interleave', () => {
  it('puts one research item after every 4 posts', () => {
    const r = interleave([1, 2, 3, 4, 5, 6, 7, 8, 9], ['a', 'b', 'c'], 4);
    expect(r.map((x) => x.data)).toEqual([1, 2, 3, 4, 'a', 5, 6, 7, 8, 'b', 9]);
  });
  it('shows up to two research items when there are only a few posts', () => {
    expect(interleave([1], ['a', 'b', 'c'], 4).map((x) => x.data)).toEqual([1, 'a', 'b']);
    expect(interleave([], ['a'], 4).map((x) => x.kind)).toEqual(['research']);
  });
});

describe('composeBody', () => {
  const w = { title: 'Pull', duration: 52, exercises: JSON.stringify([{ name: 'Deadlift', sets: 3, reps: 3, weightKg: 130 }]) };
  it('posts an attached workout even with no caption', () => {
    expect(composeBody('  ', { kind: 'workout', w }, null, 'friends')).toEqual({ itemType: 'workout', payload: { title: 'Pull', durationMin: 52, exercises: [{ name: 'Deadlift', sets: 3, reps: '3', weightKg: 130 }] }, caption: undefined, visibility: 'friends' });
  });
  it('a photo alone is a media post; text alone is a text post', () => {
    expect(composeBody('New belt', null, 'AAA', 'public')).toMatchObject({ itemType: 'media', payload: { imageBase64: 'AAA', text: 'New belt' }, visibility: 'public' });
    expect(composeBody('Hello', null, null, 'friends')).toEqual({ itemType: 'text', payload: { text: 'Hello' }, visibility: 'friends' });
  });
  it('a meal carries its numbers', () => {
    expect(composeBody('', { kind: 'meal', m: { name: 'Bowl', calories: 760.4, proteinG: 48, carbsG: 86, fatG: 24 } }, null, 'friends').payload).toEqual({ name: 'Bowl', calories: 760, proteinG: 48, carbsG: 86, fatG: 24 });
  });
});

describe('cropRect', () => {
  it('centres on the shorter side at scale 1', () => {
    expect(cropRect({ width: 4000, height: 3000 }, 300, 1, 0, 0)).toEqual({ originX: 500, originY: 0, width: 3000, height: 3000 });
  });
  it('zooms into the middle and follows a drag', () => {
    expect(cropRect({ width: 1000, height: 1000 }, 300, 2, 0, 0)).toEqual({ originX: 250, originY: 250, width: 500, height: 500 });
    // Dragging the image right shows more of its left side.
    expect(cropRect({ width: 1000, height: 1000 }, 300, 2, 60, 0).originX).toBe(150);
  });
  it('never leaves the image', () => {
    const r = cropRect({ width: 1000, height: 1000 }, 300, 2, 9999, -9999);
    expect(r).toEqual({ originX: 0, originY: 500, width: 500, height: 500 });
  });
});
