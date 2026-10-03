// A test purchase (TestFlight / sandbox tester) is free, so the live server
// never turns it into Pro — and the app is told that plainly instead of
// "no active subscription", which reads as if a real payment was lost.

import { describe, it, expect, vi } from 'vitest';
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = {}; }) }));
import { isSandboxInProduction, verifyFailure } from '../routes/appleIap.js';

describe('apple verify failures', () => {
  it('names a test purchase reaching the live server', () => {
    expect(isSandboxInProduction({ environment: 'Sandbox' }, true)).toBe(true);
    expect(verifyFailure({ environment: 'Sandbox' }, true)).toMatchObject({ code: 'sandbox_purchase', error: expect.stringContaining('no money was charged') });
  });
  it('treats production purchases, and sandbox outside production, normally', () => {
    expect(isSandboxInProduction({ environment: 'Production' }, true)).toBe(false);
    expect(isSandboxInProduction({ environment: 'Sandbox' }, false)).toBe(false);
    expect(verifyFailure({ environment: 'Production' }, true)).toEqual({ error: 'No active Pro subscription found for this transaction', code: 'inactive' });
  });
});
