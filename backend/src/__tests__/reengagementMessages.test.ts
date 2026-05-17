/**
 * Guards the re-engagement notification copy. These pushes went from a
 * sarcastic / shame-based tone to positive reinforcement so the app works
 * for a broad audience including beginners. This test:
 *   - sweeps every message in every pool (Math.random is stubbed so the
 *     random `pick` is exhaustive and deterministic),
 *   - asserts no shame/crude vocabulary survives,
 *   - asserts placeholders are always substituted.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getWorkoutMissMessage,
  getNutritionMissMessage,
  getInactivityMessage,
  getJunkFoodMessage,
} from '../messages/reengagement.js';

// Vocabulary that belonged to the old shame-based tone — must never reappear.
const BANNED = [
  'chud', 'chungus', 'shame', 'disappoint', 'milk carton',
  '600 lb', 'rage', 'ghost', 'judgment of', 'concerned',
];

/**
 * Collect every message a getter can produce by sweeping Math.random across
 * the full [0,1) range — 100 evenly spaced points cover every index of any
 * pool with ≤8 entries.
 */
function sweep(produce: () => { title: string; body: string }) {
  const out: { title: string; body: string }[] = [];
  for (let k = 0; k < 100; k++) {
    vi.spyOn(Math, 'random').mockReturnValue(k / 100);
    out.push(produce());
  }
  return out;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('re-engagement message tone', () => {
  it('workout / nutrition / inactivity pools carry no shame vocabulary', () => {
    const all = [
      ...[1, 6, 12].flatMap(d => sweep(() => getWorkoutMissMessage(d, 'Alex'))),
      ...[1, 6, 12].flatMap(d => sweep(() => getNutritionMissMessage(d, 'Alex'))),
      ...[3, 6, 12].flatMap(d => sweep(() => getInactivityMessage(d, 'Alex'))),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      const text = `${m.title} ${m.body}`.toLowerCase();
      for (const word of BANNED) {
        expect(text, `"${m.title}" / "${m.body}"`).not.toContain(word);
      }
    }
  });

  it('junk-food messages are encouraging, not shaming', () => {
    const all = sweep(() => getJunkFoodMessage('cheeseburger', 800, 'Alex'));
    for (const m of all) {
      const text = `${m.title} ${m.body}`.toLowerCase();
      for (const word of BANNED) {
        expect(text, `"${m.title}" / "${m.body}"`).not.toContain(word);
      }
    }
  });
});

describe('re-engagement placeholder substitution', () => {
  it('substitutes {{name}} and {{days}} and leaves no raw placeholders', () => {
    const msgs = [
      getWorkoutMissMessage(4, 'Jordan'),
      getNutritionMissMessage(9, 'Jordan'),
      getInactivityMessage(15, 'Jordan'),
    ];
    for (const m of msgs) {
      expect(m.title + m.body).not.toContain('{{');
      expect(m.title + m.body).not.toContain('}}');
    }
  });

  it('junk-food message substitutes the food name and calories', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic pick
    // Index 0 of the pool references {{food}} but not {{calories}}; sweep a
    // calorie-referencing entry too by checking the whole pool has no raw tags.
    for (let k = 0; k < 100; k++) {
      vi.spyOn(Math, 'random').mockReturnValue(k / 100);
      const m = getJunkFoodMessage('ice cream', 450, 'Sam');
      expect(m.title + m.body).not.toContain('{{');
    }
  });
});
