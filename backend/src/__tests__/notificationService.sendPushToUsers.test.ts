import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma so sendPushToUsers resolves tokens without a real DB.
vi.mock('@prisma/client', () => {
  const user = { findUnique: vi.fn(), findMany: vi.fn() };
  const PrismaClient = vi.fn(function (this: any) {
    this.user = user;
  });
  return { PrismaClient, __mocks: { user } };
});

import { sendPushToUsers } from '../services/notificationService.js';
import * as prismaMod from '@prisma/client';
const { user: userMock } = (prismaMod as any).__mocks;

beforeEach(() => {
  userMock.findMany.mockReset();
  vi.restoreAllMocks();
});

describe('sendPushToUsers', () => {
  it('does nothing when the user list is empty (no DB / network calls)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({ json: async () => ({}) } as any);
    await sendPushToUsers([], 'Title', 'Body');
    expect(userMock.findMany).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deduplicates user ids before querying for tokens', async () => {
    userMock.findMany.mockResolvedValue([]);
    await sendPushToUsers(['a', 'a', 'b', 'b', 'b'], 'T', 'B');
    expect(userMock.findMany).toHaveBeenCalledTimes(1);
    const arg = userMock.findMany.mock.calls[0][0];
    expect(arg.where.id.in.sort()).toEqual(['a', 'b']);
  });

  it('skips sending when no recipient has a push token', async () => {
    userMock.findMany.mockResolvedValue([]); // query filters out null tokens
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({ json: async () => ({}) } as any);
    await sendPushToUsers(['a', 'b'], 'T', 'B');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends one Expo batch with a message per token + carries data payload', async () => {
    userMock.findMany.mockResolvedValue([
      { expoPushToken: 'tok1' },
      { expoPushToken: 'tok2' },
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({ json: async () => ({}) } as any);
    await sendPushToUsers(['a', 'b'], 'Group', 'hi', { type: 'group_message', groupId: 'g1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ to: 'tok1', title: 'Group', body: 'hi', data: { type: 'group_message', groupId: 'g1' } });
    expect(body[1].to).toBe('tok2');
  });
});
