import { describe, it, expect } from 'vitest';
import { rankBoard } from '../services/leaderboardBoard.js';

const users = [
  { id: 'me', name: 'Me', username: 'me', weightKg: 80 },
  { id: 'sam', name: 'Sam', username: 'sam', weightKg: 100 },
  { id: 'ali', name: 'Ali', username: 'ali', weightKg: null },
];
// RPE 10 singles, so each set's e1RM is its weight (no RPE assumes reps in reserve).
const w = (userId: string, date: string, name: string, kg: number) => ({ userId, date, exercises: [{ name, sets: 1, reps: '1', weightKg: kg, setEntries: [{ weightKg: kg, reps: 1, rpe: 10 }] }] });
const logs = [
  w('me', '2026-09-20', 'Bench press', 100),
  w('me', '2026-10-05', 'Barbell bench press', 105),
  w('sam', '2026-10-02', 'bench press', 120),
  w('ali', '2026-10-01', 'Squat', 140),
  w('me', '2026-10-06', 'Squat', 130), w('me', '2026-10-07', 'Deadlift', 170),
];

describe('rankBoard', () => {
  it('ranks by best 1RM with this month’s change, and marks the viewer', () => {
    const b = rankBoard(users, logs, 'me', 'bench', false, '2026-10-08');
    expect(b.map((e) => [e.userId, e.rank])).toEqual([['sam', 1], ['me', 2]]);
    expect(b[1]).toMatchObject({ isYou: true, value: 105, monthDelta: 5, perBw: 1.31 });
    expect(b[0].monthDelta).toBeNull();
  });
  it('ranks per bodyweight and drops anyone without a bodyweight', () => {
    const b = rankBoard(users, logs, 'me', 'squat', true, '2026-10-08');
    expect(b.map((e) => e.userId)).toEqual(['me']);
  });
  it('totals need all three lifts', () => {
    const b = rankBoard(users, logs, 'me', 'total', false, '2026-10-08');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ userId: 'me', value: 405 });
  });
  it('counts sessions this month', () => {
    const b = rankBoard(users, logs, 'me', 'sessions', false, '2026-10-08');
    expect(b.find((e) => e.userId === 'me')?.value).toBe(3);
  });
});
