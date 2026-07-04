/**
 * Tests for the shareable-workout payload the mobile celebration sheet consumes
 * (spec §4 data contract):
 *   - buildShareableWorkout: volume, sets, exercise detail formatting, PR mapping
 *   - detectStrengthPRs: PR-vs-history detection that drives the `pr` field
 */

import { describe, it, expect, vi } from 'vitest';
import { buildShareableWorkout } from '../services/shareableWorkout.js';
import { detectStrengthPRs, epley1RM } from '../services/progressService.js';
import type { DetectedPR } from '../services/progressService.js';

const LOGGED_AT = '2026-06-18T19:42:00.000Z';

describe('buildShareableWorkout', () => {
  it('sums working sets and lb volume from uniform exercises', () => {
    const s = buildShareableWorkout(
      {
        title: 'Push Day',
        durationMin: 58,
        loggedAt: LOGGED_AT,
        exercises: [
          { name: 'Bench Press', sets: 5, reps: '5', weightKg: 83.9 }, // ~185 lb
          { name: 'Overhead Press', sets: 3, reps: '8', weightKg: 45.36 }, // ~100 lb
        ],
      },
      [],
    );
    expect(s.title).toBe('Push Day');
    expect(s.durationMin).toBe(58);
    expect(s.sets).toBe(8);
    // 185×5×5 + 100×8×3 = 4625 + 2400 = 7025 (allow rounding slack)
    expect(s.volumeLb).toBeGreaterThanOrEqual(7010);
    expect(s.volumeLb).toBeLessThanOrEqual(7040);
    expect(s.pr).toBeNull();
  });

  it('formats exercise detail with weight, and without it for bodyweight', () => {
    const s = buildShareableWorkout(
      {
        title: 'Mixed',
        durationMin: 40,
        loggedAt: LOGGED_AT,
        exercises: [
          { name: 'Bench Press', sets: 5, reps: '5', weightKg: 83.9 },
          { name: 'Pull Up', sets: 4, reps: '12', bodyweight: true, weightKg: null },
        ],
      },
      [],
    );
    expect(s.exercises[0].detail).toMatch(/^5 × 5 · \d+ lb$/);
    expect(s.exercises[1].detail).toBe('4 × 12'); // no load for bodyweight
  });

  it('counts per-set entries as the source of truth for sets + volume', () => {
    const s = buildShareableWorkout(
      {
        title: 'Squat',
        durationMin: 50,
        loggedAt: LOGGED_AT,
        exercises: [
          {
            name: 'Back Squat',
            sets: 3,
            reps: '5',
            weightKg: 100,
            setEntries: [
              { weightKg: 100, reps: 5 },
              { weightKg: 90, reps: 6 },
              { weightKg: 90, reps: 6 },
            ],
          },
        ],
      },
      [],
    );
    expect(s.sets).toBe(3);
    const volKg = 100 * 5 + 90 * 6 + 90 * 6; // 1580 kg
    expect(s.volumeKg).toBe(volKg);
    // (100×5 + 90×6 + 90×6) kg → lb, exact avoirdupois
    expect(s.volumeLb).toBe(Math.round(volKg * 2.2046226218));
  });

  it('maps the top PR into the pr field', () => {
    const prs: DetectedPR[] = [
      { key: 'bench press', displayName: 'Bench Press', e1RMLbs: 215, prevLbs: 210, deltaLbs: 5 },
    ];
    const s = buildShareableWorkout(
      { title: 'Push Day', durationMin: 58, loggedAt: LOGGED_AT, exercises: [{ name: 'Bench Press', sets: 5, reps: '3', weightKg: 90 }] },
      prs,
    );
    expect(s.pr).toEqual({
      lift: 'Bench Press', metric: 'e1RM', value: '215', unit: 'lb', delta: '+5 lb',
      valueKg: 98, deltaKg: 2, // 215 lb → 98 kg, +5 lb → +2 kg
    });
  });

  it('falls back to a default title and zero duration', () => {
    const s = buildShareableWorkout(
      { title: '', durationMin: null, loggedAt: LOGGED_AT, exercises: [] },
      [],
    );
    expect(s.title).toBe('Workout');
    expect(s.durationMin).toBe(0);
    expect(s.sets).toBe(0);
    expect(s.volumeLb).toBe(0);
  });
});

describe('detectStrengthPRs', () => {
  // Minimal prisma stub: returns the prior logs we hand it.
  function prismaWith(priorExercises: any[][]) {
    return {
      workoutLog: {
        findMany: vi.fn(async () => priorExercises.map((ex) => ({ exercises: JSON.stringify(ex) }))),
      },
    } as any;
  }

  it('returns a PR when the new best beats the prior lifetime best by ≥2.5 lb', async () => {
    const prisma = prismaWith([
      [{ name: 'Bench Press', sets: 1, reps: 5, weightKg: 90 }], // ~210 e1RM
    ]);
    const now = [{ name: 'Bench Press', sets: 1, reps: 3, weightKg: 100 }]; // higher e1RM
    const prs = await detectStrengthPRs(prisma, 'u1', 'w-new', now);
    expect(prs.length).toBe(1);
    expect(prs[0].displayName).toBe('Bench Press');
    expect(prs[0].deltaLbs).toBeGreaterThanOrEqual(3);
    expect(prs[0].e1RMLbs).toBe(epley1RM(100 * 2.20462, 3));
  });

  it('does not announce a first-ever lift (no baseline)', async () => {
    const prisma = prismaWith([]); // no history
    const now = [{ name: 'Bench Press', sets: 1, reps: 3, weightKg: 95 }];
    const prs = await detectStrengthPRs(prisma, 'u1', 'w-new', now);
    expect(prs).toEqual([]);
  });

  it('ignores tiny improvements below the 2.5 lb noise floor', async () => {
    const prisma = prismaWith([
      [{ name: 'Bench Press', sets: 1, reps: 5, weightKg: 90 }],
    ]);
    // Same load + reps → identical e1RM, no PR.
    const now = [{ name: 'Bench Press', sets: 1, reps: 5, weightKg: 90 }];
    const prs = await detectStrengthPRs(prisma, 'u1', 'w-new', now);
    expect(prs).toEqual([]);
  });
});
