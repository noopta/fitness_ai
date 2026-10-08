import { describe, it, expect } from 'vitest';
import { programFromRecentLogs } from '../services/programFromLogs.js';

// 2026-10-05 is a Monday; 2026-10-08 a Thursday.
const logs = [
  { date: '2026-10-05', title: 'Push', exercises: [{ name: 'Bench press', sets: 3, reps: '8', weightKg: 80, setEntries: [{ weightKg: 60, reps: 10, rpe: null }, { weightKg: 80, reps: 8, rpe: 8 }] }] },
  { date: '2026-10-06', title: 'Pull', exercises: [{ name: 'Cable row', sets: 5, reps: '10', weightKg: 40 }] },
  { date: '2026-10-06', title: null, exercises: [{ name: 'Hammer curl', sets: 4, reps: '9', weightKg: 25 }] },
  { date: '2026-10-07', title: 'Legs', exercises: [{ name: 'Squat', sets: 4, reps: '6', weightKg: 120 }] },
  { date: '2026-09-20', title: 'Old', exercises: [{ name: 'Deadlift', sets: 1, reps: '1', weightKg: 200 }] },
];

describe('programFromRecentLogs', () => {
  it('keeps each logged day on its weekday, rests the rest, and starts today', () => {
    const p = programFromRecentLogs(logs, '2026-10-08')!;
    const days = p.phases[0].trainingDays;
    expect(days).toHaveLength(7);
    expect(days.map((d: any) => d.day)).toEqual(['Thursday — Rest', 'Friday — Rest', 'Saturday — Rest', 'Sunday — Rest', 'Monday — Push', 'Tuesday — Pull', 'Wednesday — Legs']);
    expect(p.daysPerWeek).toBe(3);
  });
  it('merges same-day workouts and takes the top set', () => {
    const days = programFromRecentLogs(logs, '2026-10-08')!.phases[0].trainingDays;
    expect(days[5].exercises.map((e: any) => e.name)).toEqual(['Cable row', 'Hammer curl']);
    expect(days[4].exercises[0]).toMatchObject({ name: 'Bench press', reps: '8', notes: 'Last week: 80 kg × 8', intensity: 'RPE 8' });
  });
  it('ignores logs older than a week, and is null with nothing recent', () => {
    expect(JSON.stringify(programFromRecentLogs(logs, '2026-10-08'))).not.toContain('Deadlift');
    expect(programFromRecentLogs(logs, '2026-12-01')).toBeNull();
  });
});
