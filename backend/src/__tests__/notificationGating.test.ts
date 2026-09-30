import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => {
  const user = { findUnique: vi.fn(), findMany: vi.fn() };
  const PrismaClient = vi.fn(function (this: any) {
    this.user = user;
  });
  return { PrismaClient, __mocks: { user } };
});

import { sendPushToUser, sendPushToUsers, categoryFor, localHour } from '../services/notificationService.js';
import * as prismaMod from '@prisma/client';
const { user: userMock } = (prismaMod as any).__mocks;

function mockFetch() {
  return vi.spyOn(global, 'fetch' as any).mockResolvedValue({ json: async () => ({}) } as any);
}

beforeEach(() => {
  userMock.findUnique.mockReset();
  userMock.findMany.mockReset();
  vi.restoreAllMocks();
});

describe('categoryFor', () => {
  it('prefers an explicit category', () => {
    expect(categoryFor({ type: 'message' }, 'milestones')).toBe('milestones');
  });
  it('maps typed social / group / partner pushes', () => {
    expect(categoryFor({ type: 'friend_request' })).toBe('social');
    expect(categoryFor({ type: 'group_message' })).toBe('groupCheckins');
    expect(categoryFor({ type: 'partner_workout_invite' })).toBe('partnerSessions');
  });
  it('returns null for untyped pushes so they are never gated', () => {
    expect(categoryFor({ screen: 'coach' })).toBeNull();
    expect(categoryFor(undefined)).toBeNull();
  });
});

describe('localHour', () => {
  it('returns an hour in 0..23 for valid and missing timezones', () => {
    for (const tz of ['Europe/London', 'Asia/Tokyo', null, undefined]) {
      const h = localHour(tz);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
  });
  it('falls back instead of throwing on a bad timezone', () => {
    expect(() => localHour('Not/AZone')).not.toThrow();
  });
});

describe('sendPushToUser gating', () => {
  it('drops a push whose category the user switched off', async () => {
    userMock.findUnique.mockResolvedValue({ expoPushToken: 'tok', notificationPrefsJson: JSON.stringify({ milestones: false }) });
    const f = mockFetch();
    await sendPushToUser('u1', 'PR!', 'body', { screen: 'coach' }, 'milestones');
    expect(f).not.toHaveBeenCalled();
  });
  it('sends when the category is on (default prefs)', async () => {
    userMock.findUnique.mockResolvedValue({ expoPushToken: 'tok', notificationPrefsJson: null });
    const f = mockFetch();
    await sendPushToUser('u1', 'PR!', 'body', { screen: 'coach' }, 'milestones');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('gates typed pushes without an explicit category', async () => {
    userMock.findUnique.mockResolvedValue({ expoPushToken: 'tok', notificationPrefsJson: JSON.stringify({ social: false }) });
    const f = mockFetch();
    await sendPushToUser('u1', 'New message', 'hi', { type: 'message' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('sendPushToUsers gating', () => {
  it('filters out recipients who muted the category', async () => {
    userMock.findMany.mockResolvedValue([
      { expoPushToken: 'on', notificationPrefsJson: null },
      { expoPushToken: 'off', notificationPrefsJson: JSON.stringify({ groupCheckins: false }) },
    ]);
    const f = mockFetch();
    await sendPushToUsers(['a', 'b'], 'Group', 'hi', { type: 'group_message' });
    const body = JSON.parse((f.mock.calls[0][1] as any).body);
    expect(body.map((m: any) => m.to)).toEqual(['on']);
  });
});
