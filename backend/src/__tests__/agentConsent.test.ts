// Consent (PRF-11): switched-off sources leave the turn context and the read
// tools over them refuse, while logging on request keeps working.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const users: Record<string, any> = {};
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = { findUnique: async ({ where }: any) => users[where.id] ?? null };
  }),
}));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const { parseConsent } = await import('../agent/consent.js');
const { runToolCall } = await import('../agent/turn.js');
const { renderContext } = await import('../agent/context.js');

const withConsent = (c: Record<string, boolean> | null) => JSON.stringify(c ? { consent: c } : {});
const ctx: any = { userId: 'u1', turnId: 't1' };

beforeEach(() => { users.u1 = { id: 'u1', coachProfile: withConsent(null) }; });

describe('parseConsent', () => {
  it('defaults every source on', () => {
    expect(parseConsent(null)).toEqual({ logs: true, health: true, research: true, nutrition: true });
  });
  it('reads booleans and ignores junk', () => {
    expect(parseConsent(withConsent({ nutrition: false, logs: 'no' as any }))).toMatchObject({ nutrition: false, logs: true });
  });
});

describe('runToolCall consent gate', () => {
  const readTool = (name: string, execute = vi.fn(async () => ({ ok: true }))) =>
    ({ name, kind: 'read', description: '', input_schema: { type: 'object', properties: {} }, execute } as any);

  it('refuses a gated read when its source is off, without executing', async () => {
    users.u1.coachProfile = withConsent({ nutrition: false });
    const t = readTool('read_nutrition_history');
    const out = await runToolCall(t, {}, 'u1', ctx, { buildCards: true });
    expect(t.execute).not.toHaveBeenCalled();
    expect(out.cards).toEqual([]);
    expect(out.modelResult).toMatchObject({ error: 'consent_off' });
  });

  it('runs the gated read when the source is on', async () => {
    const t = readTool('read_nutrition_history');
    const out = await runToolCall(t, {}, 'u1', ctx, { buildCards: false });
    expect(t.execute).toHaveBeenCalled();
    expect(out.modelResult).toMatchObject({ ok: true });
  });

  it('never gates writes (logging a meal on request)', async () => {
    users.u1.coachProfile = withConsent({ nutrition: false });
    const t = { ...readTool('log_meal'), kind: 'log' };
    await runToolCall(t, {}, 'u1', ctx, { buildCards: false });
    expect(t.execute).toHaveBeenCalled();
  });
});

describe('renderContext privacy line', () => {
  const base: any = {
    userId: 'u1', profile: { name: 'A', tier: 'free', unitPreference: 'imperial' },
    todayNutrition: null, bodyWeight: null, lastWellness: null, memory: [],
  };
  it('names the switched-off sources and hides the nutrition line', () => {
    const out = renderContext({ ...base, consentOff: ['nutrition', 'health'] });
    expect(out).toContain('food logs, health notes');
    expect(out).not.toContain('nothing logged yet');
  });
  it('says nothing about privacy when everything is on', () => {
    expect(renderContext({ ...base, consentOff: [] })).not.toContain('Privacy');
  });
});
