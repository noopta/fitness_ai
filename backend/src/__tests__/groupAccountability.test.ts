// Group accountability — verifies Anakin's morning check-in composes a real
// data-grounded prompt and posts the message. No live API calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  groupChat: { findUnique: vi.fn(), findMany: vi.fn() },
  groupMember: { },
  groupMessage: { create: vi.fn() },
  user: { findUnique: vi.fn() },
  workoutLog: { count: vi.fn() },
  mealEntry: { count: vi.fn() },
  bodyWeightLog: { findFirst: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

import { runAnakinGroupCheckin } from '../services/groupAccountability.js';

beforeEach(() => {
  mocks.groupChat.findUnique.mockReset();
  mocks.groupMessage.create.mockReset();
  mocks.user.findUnique.mockReset();
  mocks.workoutLog.count.mockReset();
  mocks.mealEntry.count.mockReset();
  mocks.bodyWeightLog.findFirst.mockReset();
});

describe('runAnakinGroupCheckin', () => {
  function setupGroup(opts: { anakinDailyEnabled: boolean; members?: any[]; groupGoal?: string | null }) {
    mocks.groupChat.findUnique.mockResolvedValue({
      id: 'g1', name: 'Squad', groupGoal: opts.groupGoal ?? null,
      anakinDailyEnabled: opts.anakinDailyEnabled,
      members: opts.members ?? [{ userId: 'u1', goal: 'lose 10 lbs' }, { userId: 'u2', goal: 'add 50 lb to bench' }],
    });
    mocks.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'u1' ? { username: 'pomelo', name: 'Anupta' } : { username: 'b', name: 'B' },
    );
    mocks.workoutLog.count.mockResolvedValue(3);
    mocks.mealEntry.count.mockResolvedValue(5);
    mocks.bodyWeightLog.findFirst.mockResolvedValue({ weightLbs: 197.4 });
  }

  it('no-ops when Anakin daily is disabled', async () => {
    setupGroup({ anakinDailyEnabled: false });
    const client = { messages: { create: vi.fn() } } as any;
    const out = await runAnakinGroupCheckin('g1', { injectClient: client });
    expect(out.posted).toBe(false);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('drafts + persists a check-in when enabled, with member data in prompt', async () => {
    setupGroup({ anakinDailyEnabled: true, groupGoal: 'all hit 5 workouts/week' });
    let capturedUser = '';
    const client = { messages: { create: vi.fn(async (args: any) => {
      capturedUser = args.messages[0].content;
      return { content: [{ type: 'text', text: 'Anupta — 3 sessions, nicely on pace.' }] };
    }) } } as any;
    mocks.groupMessage.create.mockResolvedValue({});
    const out = await runAnakinGroupCheckin('g1', { injectClient: client });
    expect(out.posted).toBe(true);
    expect(out.text).toContain('Anupta');
    // Prompt includes the group goal + member context.
    expect(capturedUser).toContain('all hit 5 workouts/week');
    expect(capturedUser).toContain('lose 10 lbs');
    expect(capturedUser).toContain('3 workouts in last 7d');
    // Persisted with no sender (Anakin = system).
    const createArgs = mocks.groupMessage.create.mock.calls[0][0];
    expect(createArgs.data.senderId).toBeNull();
    expect(createArgs.data.groupId).toBe('g1');
  });

  it('dryRun returns the draft without persisting', async () => {
    setupGroup({ anakinDailyEnabled: true });
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Draft only.' }] })) } } as any;
    const out = await runAnakinGroupCheckin('g1', { injectClient: client, dryRun: true });
    expect(out.posted).toBe(false);
    expect(out.text).toBe('Draft only.');
    expect(mocks.groupMessage.create).not.toHaveBeenCalled();
  });

  it("returns no-post when Anakin declines (empty draft)", async () => {
    setupGroup({ anakinDailyEnabled: true });
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: '   ' }] })) } } as any;
    const out = await runAnakinGroupCheckin('g1', { injectClient: client });
    expect(out.posted).toBe(false);
    expect(out.text).toBeNull();
  });
});
