import { describe, it, expect } from 'vitest';
import { sessionMinutes } from '../services/sessionMinutes.js';

describe('sessionMinutes', () => {
  it("uses the session's own estimatedMinutes when the program has one", () => {
    expect(sessionMinutes({ estimatedMinutes: 48, exercises: [{ sets: 5, reps: '5' }] })).toBe(48);
  });

  it('is null for a rest day or an empty session', () => {
    expect(sessionMinutes(null)).toBeNull();
    expect(sessionMinutes({ exercises: [] })).toBeNull();
  });

  it('estimates from sets, reps and rest, so different sessions differ', () => {
    const heavy = { exercises: [{ sets: 5, reps: '3' }, { sets: 5, reps: '3' }, { sets: 4, reps: '5' }] };
    const pump = { exercises: [{ sets: 3, reps: '12' }, { sets: 3, reps: '12' }, { sets: 3, reps: '15' }] };
    const h = sessionMinutes(heavy)!, p = sessionMinutes(pump)!;
    expect(h).toBeGreaterThan(p);
    expect(h % 5).toBe(0);
    expect(p % 5).toBe(0);
  });

  it('reads explicit rest, timed holds and warm-up lists', () => {
    const base = { warmup: ['a', 'b'], exercises: [{ sets: 3, reps: '30s' }] };
    const long = { ...base, exercises: [{ sets: 3, reps: '30s', notes: 'rest 4 min' }] };
    expect(sessionMinutes(long)!).toBeGreaterThan(sessionMinutes(base)!);
  });

  it('lands a typical six-exercise session near an hour', () => {
    const s = {
      warmup: ['x', 'y', 'z'], cooldown: ['c'],
      exercises: [
        { sets: 4, reps: '6', intensity: 'RPE 8' }, { sets: 4, reps: '8' }, { sets: 3, reps: '10' },
        { sets: 3, reps: '10' }, { sets: 3, reps: '12' }, { sets: 3, reps: '15' },
      ],
    };
    const m = sessionMinutes(s)!;
    expect(m).toBeGreaterThanOrEqual(45);
    expect(m).toBeLessThanOrEqual(75);
  });
});
