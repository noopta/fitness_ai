import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS } from '../agent/registry.js';
import { getOp } from '../agent/ops.js';
import '../agent/toolkits/index.js';

describe('freestyle from chat', () => {
  it('is a proposal (nothing changes until Apply) with an undoable op pair', async () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'propose_freestyle');
    expect(t?.kind).toBe('propose');
    expect(getOp('program.freestyle')).toBeTruthy();
    expect(getOp('program.unfreestyle')).toBeTruthy();
    const card: any = await t!.card!({}, { goal: 'Strength', weeks: 12 }, { userId: 'u', unit: 'metric', tz: 'UTC', today: '2026-10-08' });
    expect(card).toMatchObject({ pattern: 'proposal', pending: { actions: { apply: { op: 'program.freestyle' } } } });
    expect(await t!.card!({}, { error: 'already freestyle' }, { userId: 'u', unit: 'metric', tz: 'UTC', today: '2026-10-08' })).toBeNull();
  });
});
