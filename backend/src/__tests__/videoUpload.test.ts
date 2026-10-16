// Upload plumbing (Oct 2026 audit M8/H2): 100 MB default cap and a bounded
// number of clips in memory at once.
import { describe, it, expect, afterEach } from 'vitest';
import { Semaphore, videoMaxMb } from '../services/videoUpload.js';

describe('videoMaxMb', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it('defaults to 100 MB', () => {
    delete process.env.FORM_VIDEO_MAX_MB;
    delete process.env.DIAGNOSTIC_VIDEO_MAX_MB;
    expect(videoMaxMb()).toBe(100);
    expect(videoMaxMb('DIAGNOSTIC_VIDEO_MAX_MB')).toBe(100);
  });
  it('honours the specific env var first, then FORM_VIDEO_MAX_MB', () => {
    process.env.FORM_VIDEO_MAX_MB = '50';
    expect(videoMaxMb('DIAGNOSTIC_VIDEO_MAX_MB')).toBe(50);
    process.env.DIAGNOSTIC_VIDEO_MAX_MB = '20';
    expect(videoMaxMb('DIAGNOSTIC_VIDEO_MAX_MB')).toBe(20);
  });
});

describe('Semaphore', () => {
  it('admits max holders, refuses a third without waiting, and hands a freed slot to a waiter', async () => {
    const s = new Semaphore(2);
    const a = await s.acquire();
    const b = await s.acquire();
    expect(a && b).toBeTruthy();
    expect(await s.acquire(0)).toBeNull();
    const waiting = s.acquire(1000);
    a!();
    const c = await waiting;
    expect(c).toBeTruthy();
    expect(s.inUse).toBe(2);
    a!(); // double release is a no-op
    expect(s.inUse).toBe(2);
  });
  it('times out a waiter', async () => {
    const s = new Semaphore(1);
    await s.acquire();
    expect(await s.acquire(20)).toBeNull();
  });
});
