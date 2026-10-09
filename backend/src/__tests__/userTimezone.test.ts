// The user's local day: the phone's X-Timezone header first, then the saved
// zone, then ET — never the server's UTC date.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const user = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = user; }) }));

import { validTz, requestToday, queryDateOrToday, noteTimezone, onTimezoneChange, _resetTimezoneCacheForTests } from '../services/userTimezone.js';

const req = (headers: Record<string, string> = {}, id = 'u1') => ({ headers, user: { id } }) as any;
// 03:18 UTC on 9 Oct = 21:18 on 8 Oct in Calgary, 23:18 on 8 Oct in Toronto.
const NIGHT = new Date('2026-10-09T03:18:00Z');
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  _resetTimezoneCacheForTests();
  user.findUnique.mockReset();
  user.update.mockReset().mockResolvedValue({});
});

describe('validTz', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(validTz('America/Edmonton')).toBe('America/Edmonton');
    expect(validTz('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(validTz('Mars/Olympus')).toBeNull();
    expect(validTz('<script>')).toBeNull();
    expect(validTz(undefined)).toBeNull();
  });
});

describe('requestToday', () => {
  it('uses the phone header', async () => {
    expect(await requestToday(req({ 'x-timezone': 'America/Edmonton' }), NIGHT)).toBe('2026-10-08');
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the saved zone', async () => {
    user.findUnique.mockResolvedValue({ timezone: 'Asia/Tokyo' });
    expect(await requestToday(req(), NIGHT)).toBe('2026-10-09');
  });

  it('falls back to ET, not UTC, when nothing is known', async () => {
    user.findUnique.mockResolvedValue({ timezone: null });
    expect(await requestToday(req(), NIGHT)).toBe('2026-10-08');
  });
});

describe('queryDateOrToday', () => {
  it('keeps a date the client sent', async () => {
    expect(await queryDateOrToday(req({ 'x-timezone': 'Asia/Tokyo' }), '2026-10-01')).toBe('2026-10-01');
  });
  it('fills a missing or malformed one with the local day', async () => {
    user.findUnique.mockResolvedValue({ timezone: 'America/Edmonton' });
    vi.useFakeTimers({ now: NIGHT, toFake: ['Date'] });
    try {
      expect(await queryDateOrToday(req(), undefined)).toBe('2026-10-08');
      expect(await queryDateOrToday(req(), 'yesterday')).toBe('2026-10-08');
    } finally { vi.useRealTimers(); }
  });
});

describe('noteTimezone', () => {
  it('saves a new zone once and tells listeners', async () => {
    const seen: string[] = [];
    onTimezoneChange((id) => seen.push(id));
    user.findUnique.mockResolvedValue({ timezone: null });
    noteTimezone('u1', 'America/Edmonton');
    await flush(); await flush();
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { timezone: 'America/Edmonton' } });
    expect(seen).toContain('u1');
    noteTimezone('u1', 'America/Edmonton');
    await flush(); await flush();
    expect(user.update).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the stored zone already matches, or the header is junk', async () => {
    user.findUnique.mockResolvedValue({ timezone: 'America/Toronto' });
    noteTimezone('u2', 'America/Toronto');
    noteTimezone('u3', 'not a zone');
    await flush(); await flush();
    expect(user.update).not.toHaveBeenCalled();
  });
});
