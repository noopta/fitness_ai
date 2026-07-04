// Train Together service — taxonomy, tier ladder, calendar resolution, split
// labels, pin-break watcher, morning reminders. Pure logic is tested directly;
// DB-touching helpers run against the standard Prisma constructor mock.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  scheduleOverride: { findMany: vi.fn() },
  partnerWorkout: { findMany: vi.fn(), update: vi.fn() },
  partnerWorkoutMember: {},
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

const { mockSendPushToUser, mockSendPushToUsers } = vi.hoisted(() => ({
  mockSendPushToUser: vi.fn(),
  mockSendPushToUsers: vi.fn(),
}));
vi.mock('../services/notificationService.js', () => ({
  sendPushToUser: mockSendPushToUser,
  sendPushToUsers: mockSendPushToUsers,
}));

import {
  normalizeFocus,
  pairTier,
  groupTier,
  resolveCalendar,
  deriveSplitLabel,
  computeOverlap,
  upcomingDates,
  checkPinsAfterScheduleChange,
  runPartnerWorkoutMorningReminders,
  type ResolvedDay,
} from '../services/trainTogetherService.js';

beforeEach(() => {
  mocks.user.findUnique.mockReset();
  mocks.scheduleOverride.findMany.mockReset();
  mocks.partnerWorkout.findMany.mockReset();
  mocks.partnerWorkout.update.mockReset();
  mockSendPushToUser.mockReset();
  mockSendPushToUser.mockResolvedValue(undefined);
  mockSendPushToUsers.mockReset();
  mockSendPushToUsers.mockResolvedValue(undefined);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const day = (over: Partial<ResolvedDay>): ResolvedDay => ({
  date: '2099-01-08', rest: false, label: 'X', focusKey: null, muscles: [], ...over,
});

function fromLabel(label: string | null): ResolvedDay {
  const n = normalizeFocus(label);
  if (n === 'rest' || label === null) return day({ rest: true, label: null });
  return day({ label, focusKey: n.key, muscles: [...n.muscles].sort() });
}

const program = (focuses: string[], durationWeeks = 12) => ({
  phases: [{ durationWeeks, trainingDays: focuses.map((f, i) => ({ day: `Day ${i + 1}`, focus: f })) }],
});

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

describe('normalizeFocus', () => {
  it('recognizes canonical splits', () => {
    expect((normalizeFocus('Push') as any).key).toBe('push');
    expect((normalizeFocus('Upper Body Strength') as any).key).toBe('upper');
    expect((normalizeFocus('Legs + Core') as any).key).toBe('legs+core');
  });

  it('treats rest-like labels as rest', () => {
    expect(normalizeFocus('Rest')).toBe('rest');
    expect(normalizeFocus('Active Recovery')).toBe('rest');
    expect(normalizeFocus(null)).toBe('rest');
    expect(normalizeFocus('')).toBe('rest');
  });

  it('unrecognized labels get an other: key with no muscles', () => {
    const n = normalizeFocus('Zercher Carnival') as any;
    expect(n.key).toMatch(/^other:/);
    expect(n.muscles.size).toBe(0);
  });
});

// ─── Tier ladder ──────────────────────────────────────────────────────────────

describe('pairTier', () => {
  it('exact: same normalized focus', () => {
    expect(pairTier(fromLabel('Push'), fromLabel('Push Day A'))).toBe('exact');
  });

  it('strong: overlapping muscle groups (Upper + Back)', () => {
    expect(pairTier(fromLabel('Upper'), fromLabel('Back'))).toBe('strong');
  });

  it('none: disjoint sessions (Upper + Legs, Push + Pull)', () => {
    expect(pairTier(fromLabel('Upper'), fromLabel('Legs'))).toBe('none');
    expect(pairTier(fromLabel('Push'), fromLabel('Pull'))).toBe('none');
  });

  it('flexible: exactly one person rests; none when both rest', () => {
    expect(pairTier(fromLabel('Push'), fromLabel(null))).toBe('flexible');
    expect(pairTier(fromLabel(null), fromLabel(null))).toBe('none');
  });

  it('unrecognized labels only match identical labels', () => {
    expect(pairTier(fromLabel('Zercher Carnival'), fromLabel('Zercher Carnival'))).toBe('exact');
    expect(pairTier(fromLabel('Zercher Carnival'), fromLabel('Push'))).toBe('none');
  });
});

describe('groupTier', () => {
  it('is the weakest pairwise link among training members', () => {
    // Push+Push = exact, but Push+Upper = strong -> group is strong
    expect(groupTier([fromLabel('Push'), fromLabel('Push'), fromLabel('Upper')])).toBe('strong');
  });

  it('caps at flexible when any member rests', () => {
    expect(groupTier([fromLabel('Push'), fromLabel('Push'), fromLabel(null)])).toBe('flexible');
  });

  it('none when everyone rests, or any training pair is disjoint', () => {
    expect(groupTier([fromLabel(null), fromLabel(null)])).toBe('none');
    expect(groupTier([fromLabel('Push'), fromLabel('Push'), fromLabel('Legs')])).toBe('none');
  });
});

// ─── Calendar resolution ──────────────────────────────────────────────────────

describe('resolveCalendar', () => {
  const prog = program(['Push', 'Pull', 'Legs']);
  const start = new Date('2099-01-04T12:00:00Z'); // arbitrary fixed Monday

  it('maps the first N personal-week days to training days, rest after', () => {
    const days = resolveCalendar(prog as any, start, new Map(), [
      '2099-01-04', '2099-01-05', '2099-01-06', '2099-01-07', '2099-01-10', '2099-01-11',
    ]);
    expect(days[0]).toMatchObject({ rest: false, label: 'Push', focusKey: 'push' });
    expect(days[1]).toMatchObject({ rest: false, label: 'Pull' });
    expect(days[2]).toMatchObject({ rest: false, label: 'Legs' });
    expect(days[3].rest).toBe(true);            // day 4 of a 3-day split
    expect(days[4].rest).toBe(true);            // day 7
    expect(days[5]).toMatchObject({ rest: false, label: 'Push' }); // next week wraps
  });

  it('a per-date override wins; null sessionJson forces a rest day', () => {
    const overrides = new Map<string, string | null>([
      ['2099-01-04', JSON.stringify({ day: 'Swapped', focus: 'Upper' })],
      ['2099-01-05', null],
    ]);
    const days = resolveCalendar(prog as any, start, overrides, ['2099-01-04', '2099-01-05']);
    expect(days[0]).toMatchObject({ rest: false, label: 'Upper', focusKey: 'upper' });
    expect(days[1].rest).toBe(true);
  });

  it('no program -> all rest', () => {
    const days = resolveCalendar(null, null, new Map(), ['2099-01-04']);
    expect(days[0].rest).toBe(true);
  });
});

// ─── Split label ──────────────────────────────────────────────────────────────

describe('deriveSplitLabel', () => {
  it('recognizes PPL / UL / FB', () => {
    expect(deriveSplitLabel(program(['Push', 'Pull', 'Legs']) as any)).toBe('PPL');
    expect(deriveSplitLabel(program(['Upper', 'Lower', 'Upper', 'Lower']) as any)).toBe('UL');
    expect(deriveSplitLabel(program(['Full Body', 'Full Body', 'Full Body']) as any)).toBe('FB');
  });

  it('falls back to an N-day label and handles empty programs', () => {
    expect(deriveSplitLabel(program(['Push', 'Legs']) as any)).toBe('2-day');
    expect(deriveSplitLabel(null)).toBeNull();
    expect(deriveSplitLabel({} as any)).toBeNull();
  });
});

// ─── Overlap payload ──────────────────────────────────────────────────────────

describe('computeOverlap', () => {
  it('produces per-date tiers with per-participant sessions', () => {
    const dates = ['2099-01-04', '2099-01-05'];
    const a = { userId: 'u1', days: [fromLabel('Push'), fromLabel('Pull')] };
    const b = { userId: 'u2', days: [fromLabel('Upper'), fromLabel(null)] };
    const out = computeOverlap([a, b], dates);
    expect(out[0]).toMatchObject({ date: dates[0], tier: 'strong' });
    expect(out[0].sessions).toEqual([
      { userId: 'u1', rest: false, label: 'Push' },
      { userId: 'u2', rest: false, label: 'Upper' },
    ]);
    expect(out[1].tier).toBe('flexible');
  });
});

describe('upcomingDates', () => {
  it('returns consecutive EST dates starting today', () => {
    const dates = upcomingDates(3, new Date('2099-01-04T18:00:00Z'));
    expect(dates).toEqual(['2099-01-04', '2099-01-05', '2099-01-06']);
  });
});

// ─── Pin-break watcher ────────────────────────────────────────────────────────

describe('checkPinsAfterScheduleChange', () => {
  // Dispatch user.findUnique by the select shape: the changer-name lookup
  // selects name/username; loadUserCalendar selects savedProgram.
  function wireUsers(programs: Record<string, any>) {
    mocks.user.findUnique.mockImplementation(async ({ where, select }: any) => {
      if (select?.name) return { name: 'Alex', username: 'alex' };
      return { savedProgram: JSON.stringify(programs[where.id]), programStartDate: new Date('2099-01-08T12:00:00Z') };
    });
    mocks.scheduleOverride.findMany.mockResolvedValue([]);
  }

  it('marks the pin changed and notifies all members when the tier drops', async () => {
    mocks.partnerWorkout.findMany.mockResolvedValue([{
      id: 'pin1', date: '2099-01-08', pinnedTier: 'exact', status: 'confirmed',
      members: [{ userId: 'u1' }, { userId: 'u2' }],
    }]);
    // Day 0 of each program: u1 Push vs u2 Legs -> none < exact -> break.
    wireUsers({ u1: program(['Push']), u2: program(['Legs']) });

    await checkPinsAfterScheduleChange('u1', ['2099-01-08']);

    expect(mocks.partnerWorkout.update).toHaveBeenCalledWith({
      where: { id: 'pin1' }, data: { status: 'changed' },
    });
    expect(mockSendPushToUser).toHaveBeenCalledTimes(2);
    const [, title, body] = mockSendPushToUser.mock.calls[0];
    expect(title).toMatch(/changed/i);
    expect(body).toContain('Alex');
  });

  it('leaves the pin alone when the tier holds', async () => {
    mocks.partnerWorkout.findMany.mockResolvedValue([{
      id: 'pin1', date: '2099-01-08', pinnedTier: 'strong', status: 'confirmed',
      members: [{ userId: 'u1' }, { userId: 'u2' }],
    }]);
    // Push vs Upper -> strong: no drop from a strong pin.
    wireUsers({ u1: program(['Push']), u2: program(['Upper']) });

    await checkPinsAfterScheduleChange('u1', ['2099-01-08']);

    expect(mocks.partnerWorkout.update).not.toHaveBeenCalled();
    expect(mockSendPushToUser).not.toHaveBeenCalled();
  });

  it('never throws — a watcher failure must not break the mutation', async () => {
    mocks.partnerWorkout.findMany.mockRejectedValue(new Error('db down'));
    await expect(checkPinsAfterScheduleChange('u1')).resolves.toBeUndefined();
  });
});

// ─── Morning reminders ────────────────────────────────────────────────────────

describe('runPartnerWorkoutMorningReminders', () => {
  it('pushes each accepted member the names of the others', async () => {
    mocks.partnerWorkout.findMany.mockResolvedValue([{
      id: 'pin1', date: '2099-01-08', status: 'confirmed', note: '6pm at Crunch',
      members: [
        { userId: 'u1', response: 'accepted', user: { id: 'u1', name: 'Anupta', username: null } },
        { userId: 'u2', response: 'accepted', user: { id: 'u2', name: 'Alex', username: null } },
      ],
    }]);
    mocks.user.findUnique.mockResolvedValue({ savedProgram: null, programStartDate: null });
    mocks.scheduleOverride.findMany.mockResolvedValue([]);

    const { sent } = await runPartnerWorkoutMorningReminders();
    expect(sent).toBe(2);
    const bodies = mockSendPushToUser.mock.calls.map((c) => c[2]);
    expect(bodies[0]).toContain('Alex');
    expect(bodies[1]).toContain('Anupta');
    expect(bodies[0]).toContain('6pm at Crunch');
  });

  it('no confirmed pins today -> nothing sent', async () => {
    mocks.partnerWorkout.findMany.mockResolvedValue([]);
    const { sent } = await runPartnerWorkoutMorningReminders();
    expect(sent).toBe(0);
    expect(mockSendPushToUser).not.toHaveBeenCalled();
  });
});
