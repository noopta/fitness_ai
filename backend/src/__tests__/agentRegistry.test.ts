// The full agent tool registry: every tool declares its kind and catalog id,
// has a usable schema, names are unique, and the always-loaded core set stays
// small enough that the rest can live behind tool search.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { return new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) }); }) }));

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test';
await import('../agent/toolkits/index.js');
const { AGENT_TOOLS } = await import('../agent/registry.js');
const { listOps } = await import('../agent/ops.js');

describe('agent tool registry', () => {
  const tools = [...AGENT_TOOLS];
  it('has the full catalog of tools with unique names', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(tools.length).toBeGreaterThan(110);
  });
  it('every tool declares a kind and a valid object schema', () => {
    for (const t of tools) {
      expect(['read', 'log', 'set', 'propose', 'draft', 'confirm', 'intent'], t.name).toContain(t.kind);
      expect((t.input_schema as any).type, t.name).toBe('object');
      expect(t.description.length, t.name).toBeGreaterThan(20);
    }
  });
  it('new toolkit tools carry a catalog id and a card', () => {
    const legacyOnly = new Set(['read_latest_diagnostic', 'query_research', 'adjust_macros', 'apply_program_update', 'propose_program_update']);
    for (const t of tools.filter((x) => !legacyOnly.has(x.name))) {
      expect(t.fn, t.name).toBeTruthy();
      expect(typeof t.card, t.name).toBe('function');
    }
  });
  it('keeps the always-loaded set small', () => {
    const core = tools.filter((t) => t.core);
    expect(core.length).toBeLessThanOrEqual(40);
  });
  it('registers the operations the cards point at', () => {
    const ops = new Set(listOps());
    for (const name of ['program.replace', 'program.activate', 'schedule.set_days', 'workout.create', 'workout.remove', 'meal.create', 'meal.remove', 'nutrition.set_macros', 'profile.set_fields', 'pref.set_many', 'notif.set', 'account.delete', 'social.dm', 'social.post', 'adapt.decide', 'weight.log', 'wellness.log', 'memory.set', 'change.revert']) {
      expect(ops.has(name), name).toBe(true);
    }
  });
});
