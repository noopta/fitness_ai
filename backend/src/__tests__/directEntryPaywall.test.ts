// The classic-paywall switch: off unless DIRECT_ENTRY_PAYWALL_ENABLED is exactly '1'.
import { describe, it, expect, vi, afterEach } from 'vitest';

const load = async (v?: string) => {
  vi.resetModules();
  if (v === undefined) delete process.env.DIRECT_ENTRY_PAYWALL_ENABLED; else process.env.DIRECT_ENTRY_PAYWALL_ENABLED = v;
  return (await import('../services/featureFlags.js')).directEntryPaywallEnabled();
};

afterEach(() => { delete process.env.DIRECT_ENTRY_PAYWALL_ENABLED; });

describe('directEntryPaywallEnabled', () => {
  it('is on only for "1"', async () => {
    expect(await load('1')).toBe(true);
    expect(await load('0')).toBe(false);
    expect(await load('true')).toBe(false);
    expect(await load(undefined)).toBe(false);
  });
});
