// Program rescue sweep — generates programs server-side for users who
// completed intake but never generated, and pushes "your program is ready".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockGenerate = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockCacheDelete = vi.hoisted(() => vi.fn());

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = { findMany: mockFindMany, findUnique: mockFindUnique, update: mockUpdate };
  }),
}));
vi.mock('../services/llmService.js', () => ({ generateTrainingProgram: mockGenerate }));
vi.mock('../services/notificationService.js', () => ({ sendPushToUser: mockPush }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: mockCacheDelete }));

const { runProgramRescueSweep } = await import('../services/programRescueService.js');

const stranded = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'drew@example.org',
  coachProfile: JSON.stringify({ trainingPreference: 'hypertrophy', frequency: '5', gender: 'male' }),
  trainingAge: 'intermediate',
  equipment: 'full gym',
  weightKg: 80,
  heightCm: 180,
  ...over,
});

beforeEach(() => {
  mockFindMany.mockReset().mockResolvedValue([]);
  mockFindUnique.mockReset().mockResolvedValue({ savedProgram: null });
  mockUpdate.mockReset().mockResolvedValue({});
  mockGenerate.mockReset().mockResolvedValue({ weeks: [{ days: [] }] });
  mockPush.mockReset().mockResolvedValue(undefined);
  mockCacheDelete.mockReset();
});

describe('runProgramRescueSweep', () => {
  it('generates from the saved profile, persists, clears cache, and pushes', async () => {
    mockFindMany.mockResolvedValue([stranded()]);
    const result = await runProgramRescueSweep();

    expect(result).toEqual({ rescued: 1, failed: 0 });
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'hypertrophy', daysPerWeek: 5, durationWeeks: 8, gender: 'male' }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ savedProgram: JSON.stringify({ weeks: [{ days: [] }] }) }),
      }),
    );
    expect(mockCacheDelete).toHaveBeenCalledWith('program:u1');
    expect(mockPush).toHaveBeenCalledWith('u1', 'Your program is ready', expect.any(String), { type: 'program_rescued' });
  });

  it('clamps a nonsense frequency to the 2-6 range and defaults the goal', async () => {
    mockFindMany.mockResolvedValue([
      stranded({ coachProfile: JSON.stringify({ frequency: '9', primaryGoal: 'get big muscles' }) }),
    ]);
    await runProgramRescueSweep();
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'hypertrophy', daysPerWeek: 6 }),
    );
  });

  it('skips test accounts entirely', async () => {
    mockFindMany.mockResolvedValue([stranded({ email: 'alex@axiom.test.example.com' }), stranded({ id: 'u2', email: 'pomelowarrior@x.com' })]);
    const result = await runProgramRescueSweep();
    expect(result).toEqual({ rescued: 0, failed: 0 });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('keeps the in-app program when the user generated during the sweep (race guard)', async () => {
    mockFindMany.mockResolvedValue([stranded()]);
    mockFindUnique.mockResolvedValue({ savedProgram: '{"theirs":true}' });
    await runProgramRescueSweep();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('counts a generation failure and stops retrying that user after 3 attempts', async () => {
    mockFindMany.mockResolvedValue([stranded({ id: 'u-fail', email: 'f@x.com' })]);
    mockGenerate.mockRejectedValue(new Error('llm down'));
    expect(await runProgramRescueSweep()).toEqual({ rescued: 0, failed: 1 });
    expect(await runProgramRescueSweep()).toEqual({ rescued: 0, failed: 1 });
    expect(await runProgramRescueSweep()).toEqual({ rescued: 0, failed: 1 });
    // 4th sweep: attempt cap reached, user skipped
    expect(await runProgramRescueSweep()).toEqual({ rescued: 0, failed: 0 });
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });

  it('saves the program even when the push fails', async () => {
    mockFindMany.mockResolvedValue([stranded()]);
    mockPush.mockRejectedValue(new Error('no token'));
    const result = await runProgramRescueSweep();
    expect(result).toEqual({ rescued: 1, failed: 0 });
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('promotes a stored draft without spending on generation and clears it', async () => {
    const draft = { phases: [{ weeks: [] }], goal: 'strength' };
    mockFindMany.mockResolvedValue([stranded({ draftProgram: JSON.stringify(draft) })]);
    const result = await runProgramRescueSweep();

    expect(result).toEqual({ rescued: 1, failed: 0 });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          savedProgram: JSON.stringify(draft),
          draftProgram: null,
          draftProgramAt: null,
        }),
      }),
    );
    expect(mockPush).toHaveBeenCalledWith('u1', 'Your program is ready', expect.any(String), { type: 'program_rescued' });
  });

  it('regenerates when the draft is corrupt or not a real program', async () => {
    mockFindMany.mockResolvedValue([
      stranded({ draftProgram: 'not json' }),
      stranded({ id: 'u2', email: 'b@x.com', draftProgram: JSON.stringify({ phases: [] }) }),
    ]);
    const result = await runProgramRescueSweep();
    expect(result).toEqual({ rescued: 2, failed: 0 });
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('skips a draft-less user with no intake profile instead of generating blind', async () => {
    mockFindMany.mockResolvedValue([stranded({ coachProfile: null, draftProgram: 'not json' })]);
    const result = await runProgramRescueSweep();
    expect(result).toEqual({ rescued: 0, failed: 0 });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
