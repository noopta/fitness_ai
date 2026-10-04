// A meal logged without a date is filed under the user's own today, not rejected.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  // The service's imports start an OpenAI client at load; nothing here calls it.
  process.env.OPENAI_API_KEY ||= 'test-key';
  return { user: { findUnique: vi.fn() } };
});
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));

import { todayForUser, mealEntrySchema } from '../services/mealLogService.js';

beforeEach(() => { mocks.user.findUnique.mockReset(); });

describe('todayForUser', () => {
  // 03:30 UTC on 4 Oct is still 3 Oct in New York (23:30) and Los Angeles, already 4 Oct in London.
  const now = new Date('2026-10-04T03:30:00Z');
  it("uses the user's timezone", async () => {
    mocks.user.findUnique.mockResolvedValue({ timezone: 'Europe/London' });
    expect(await todayForUser('u', now)).toBe('2026-10-04');
    mocks.user.findUnique.mockResolvedValue({ timezone: 'America/Los_Angeles' });
    expect(await todayForUser('u', now)).toBe('2026-10-03');
  });
  it('falls back to New York when the timezone is missing or unknown', async () => {
    mocks.user.findUnique.mockResolvedValue({ timezone: null });
    expect(await todayForUser('u', now)).toBe('2026-10-03');
    mocks.user.findUnique.mockResolvedValue({ timezone: 'Not/AZone' });
    expect(await todayForUser('u', now)).toBe('2026-10-03');
  });
});

describe('mealEntrySchema date', () => {
  it('still refuses a malformed date', () => {
    expect(() => mealEntrySchema.parse({ date: '3 Oct', name: 'Pizza' })).toThrow();
  });
});
