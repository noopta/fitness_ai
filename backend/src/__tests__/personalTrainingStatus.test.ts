import { describe, it, expect } from 'vitest';
import { deriveStatus, engagementSeries, engagementTrend, estDateString } from '../services/personalTraining/status.js';
import { buildClient, contraindicationsOf, countStatuses, sortClients, type ClientUserRow } from '../services/personalTraining/roster.js';

const NOW = new Date('2026-10-02T16:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const dateAgo = (n: number) => estDateString(daysAgo(n));

describe('engagementSeries', () => {
  it('scores eight trailing weeks oldest first, capped at 10', () => {
    // This week: 3 sessions against a target of 3, logging on 5 days → 10.
    const series = engagementSeries({
      workoutDates: [dateAgo(0), dateAgo(2), dateAgo(4)],
      logDates: [dateAgo(0), dateAgo(1), dateAgo(2), dateAgo(3), dateAgo(4)],
      targetSessions: 3,
      now: NOW,
    });
    expect(series).toHaveLength(8);
    expect(series[7]).toBe(10);
    expect(series.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('weights training at 70% and counts a day once however often it was logged', () => {
    const series = engagementSeries({
      workoutDates: [dateAgo(7), dateAgo(7), dateAgo(9)],
      logDates: [],
      targetSessions: 4,
      now: NOW,
    });
    // Last week: 2 distinct days of 4 → 0.5 × 7 = 3.5 → 4.
    expect(series[6]).toBe(4);
    expect(series[7]).toBe(0);
  });

  it('ignores dates outside the window and future dates', () => {
    const series = engagementSeries({ workoutDates: [dateAgo(56), dateAgo(-1)], logDates: [], targetSessions: 3, now: NOW });
    expect(series.every((v) => v === 0)).toBe(true);
  });
});

describe('engagementTrend', () => {
  it('compares the last three weeks with the three before', () => {
    expect(engagementTrend([5, 5, 8, 8, 8, 4, 4, 4])).toBe('falling');
    expect(engagementTrend([5, 5, 3, 3, 3, 7, 7, 7])).toBe('rising');
    expect(engagementTrend([5, 5, 6, 6, 6, 7, 6, 7])).toBe('steady');
  });
});

describe('deriveStatus', () => {
  const base = { joinedAt: daysAgo(60), lastSessionAt: daysAgo(1), engagement8w: [7, 7, 7, 7, 7, 7, 7, 7], latestCheckIn: null, now: NOW };

  it('is on plan when nothing is wrong', () => {
    expect(deriveStatus(base)).toEqual({ status: 'onPlan' });
  });

  it('flags a week without a session and says how long', () => {
    expect(deriveStatus({ ...base, lastSessionAt: daysAgo(9) })).toEqual({ status: 'support', reason: 'No session logged in 9 days' });
  });

  it('measures a never-logged client from the day they joined', () => {
    expect(deriveStatus({ ...base, joinedAt: daysAgo(3), lastSessionAt: null })).toEqual({ status: 'new' });
    expect(deriveStatus({ ...base, joinedAt: daysAgo(8), lastSessionAt: null }))
      .toEqual({ status: 'support', reason: 'No session logged since joining 8 days ago' });
  });

  it('flags engagement that halved against the client’s own baseline', () => {
    const r = deriveStatus({ ...base, engagement8w: [8, 8, 8, 8, 8, 8, 4, 3] });
    expect(r.status).toBe('support');
    expect(r.reason).toBe('Engagement down from 8 to 4 out of 10 over two weeks');
  });

  it('does not flag a low but stable client', () => {
    expect(deriveStatus({ ...base, engagement8w: [2, 2, 2, 2, 2, 2, 1, 1] })).toEqual({ status: 'onPlan' });
  });

  it('flags a recent high-stress, low-energy check-in but not a stale one', () => {
    const checkIn = { stress: 5, energy: 1 };
    expect(deriveStatus({ ...base, latestCheckIn: { at: daysAgo(2), ...checkIn } }).status).toBe('support');
    expect(deriveStatus({ ...base, latestCheckIn: { at: daysAgo(10), ...checkIn } }).status).toBe('onPlan');
  });

  it('every support status carries a reason', () => {
    const cases = [
      { ...base, lastSessionAt: daysAgo(30) },
      { ...base, engagement8w: [9, 9, 9, 9, 9, 9, 2, 2] },
      { ...base, latestCheckIn: { at: daysAgo(1), stress: 4, energy: 2 } },
    ];
    for (const c of cases) {
      const r = deriveStatus(c);
      expect(r.status).toBe('support');
      expect(r.reason).toBeTruthy();
    }
  });
});

describe('buildClient', () => {
  const user: ClientUserRow = {
    id: 'c1', name: 'Maya Okafor', email: 'maya@example.com',
    savedProgram: JSON.stringify({ phases: [{ phaseName: 'Foundation', durationWeeks: 4, trainingDays: [{}, {}, {}, {}] }, { phaseName: 'Strength', durationWeeks: 4, trainingDays: [{}, {}, {}, {}] }] }),
    programStartDate: daysAgo(30),
    coachGoal: 'Squat 100 kg',
    coachProfile: JSON.stringify({ injuryList: [{ area: 'Left knee', note: 'patellar' }, { area: 'Shoulder', resolvedAt: '2026-08-01' }] }),
    constraintsText: null,
  };
  const activity = { workoutDates: [dateAgo(1)], logDates: [], lastSessionAt: daysAgo(1), lastCheckInAt: daysAgo(3), latestCheckIn: null };

  it('reads program position, goal and injuries', () => {
    const c = buildClient(user, daysAgo(60), activity, NOW);
    expect(c).toMatchObject({
      id: 'c1', name: 'Maya Okafor', initials: 'MO', channel: 'app', status: 'onPlan',
      program: { blockLabel: 'Strength', week: 5, weeks: 8, goal: 'Squat 100 kg' },
    });
    expect(c.statusReason).toBeUndefined();
    expect(c.contraindications).toEqual([
      { label: 'Left knee', note: 'patellar', active: true },
      { label: 'Shoulder', active: false },
    ]);
    expect(c.engagement8w).toHaveLength(8);
    expect(c.lastCheckInAt).toBe(daysAgo(3).toISOString());
  });

  it('handles a client with no program, no name and unparseable profile', () => {
    const c = buildClient(
      { ...user, name: null, savedProgram: '{not json', coachProfile: 'oops', constraintsText: 'lower back; lower back' },
      daysAgo(2), { ...activity, lastSessionAt: null, lastCheckInAt: null, workoutDates: [] }, NOW,
    );
    expect(c.program).toBeNull();
    expect(c.name).toBe('maya');
    expect(c.status).toBe('new');
    expect(c.contraindications).toEqual([{ label: 'lower back', active: true }]);
    expect(c.lastCheckInAt).toBeUndefined();
  });

  it('reads injuries from both profile and constraints text', () => {
    expect(contraindicationsOf({ coachProfile: JSON.stringify({ injuries: 'knee' }), constraintsText: 'wrist' }))
      .toEqual([{ label: 'knee', active: true }, { label: 'wrist', active: true }]);
  });
});

describe('roster ordering and counts', () => {
  const c = (id: string, name: string, status: any) => ({ id, name, status }) as any;
  it('puts clients who might need support first, then by name', () => {
    const sorted = sortClients([c('1', 'Zed', 'onPlan'), c('2', 'Amy', 'onPlan'), c('3', 'Bo', 'new'), c('4', 'Cy', 'support')]);
    expect(sorted.map((x) => x.id)).toEqual(['4', '3', '2', '1']);
  });
  it('counts every status', () => {
    expect(countStatuses([c('1', 'a', 'support'), c('2', 'b', 'onPlan'), c('3', 'c', 'onPlan')]))
      .toEqual({ all: 3, support: 1, new: 0, onPlan: 2, paused: 0 });
  });
});
