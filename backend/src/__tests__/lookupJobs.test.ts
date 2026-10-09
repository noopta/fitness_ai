// Describe lookup jobs: the estimate comes back at once, the job reports each
// check as it runs, and ends with the resolved meal.

import { describe, it, expect, beforeEach } from 'vitest';
import { startLookupJob, getLookupJob, applyEvent, _resetLookupJobsForTests } from '../services/food/lookupJobs.js';

const detail: any = { name: 'Latte', calories: 200, proteinG: 20, carbsG: 20, fatG: 5, brandedItems: [{ brand: 'Starbucks', product: 'Caffè Latte', size: 'Grande', servings: 1, estimate: { calories: 200, proteinG: 20, carbsG: 20, fatG: 5 } }] };

beforeEach(() => _resetLookupJobsForTests());

describe('lookup jobs', () => {
  it('shows each check live, then the resolved meal', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const job = startLookupJob('u1', detail, async (_items, ctx) => {
      ctx.onEvent?.({ item: 0, brand: 'Starbucks', phase: 'web', state: 'checking', text: 'Starbucks Caffè Latte — searching the web' });
      await gate;
      ctx.onEvent?.({ item: 0, brand: 'Starbucks', phase: 'web', state: 'found', text: 'Starbucks Caffè Latte — from starbucks.ca' });
      return [{ result: { kind: 'not_found', reason: 'x' }, step: 'web', web: 'used', ms: 1 } as any];
    }, (d) => ({ ...d, calories: 190 }));
    await Promise.resolve();
    expect(getLookupJob(job.id, 'u1')).toMatchObject({ done: false, steps: [{ verb: 'Reading', text: 'Starbucks Caffè Latte — searching the web' }] });
    release();
    await new Promise((r) => setTimeout(r, 0));
    const j = getLookupJob(job.id, 'u1')!;
    expect(j.done).toBe(true);
    expect(j.result?.calories).toBe(190);
    expect(j.steps[0]).toMatchObject({ verb: 'Searched' });
  });

  it('belongs to its user', () => {
    const job = startLookupJob('u1', detail, async () => [], (d) => d);
    expect(getLookupJob(job.id, 'u2')).toBeNull();
  });

  it('falls back to the estimate if resolving throws, and closes open steps', async () => {
    const job = startLookupJob('u1', detail, async () => { throw new Error('boom'); }, (d) => d);
    await new Promise((r) => setTimeout(r, 0));
    const j = getLookupJob(job.id, 'u1')!;
    expect(j.done).toBe(true);
    expect(j.result?.lookups?.[0].status).toBe('estimated');
    expect(j.steps[0].verb).toBe('Checked');
  });

  it('keeps one line per item', () => {
    const s = applyEvent([], { item: 1, brand: 'B', phase: 'database', state: 'checking', text: 'b' });
    const t = applyEvent(applyEvent(s, { item: 0, brand: 'A', phase: 'database', state: 'found', text: 'a' }), { item: 1, brand: 'B', phase: 'web', state: 'checking', text: 'b2' });
    expect(t.map((x) => `${x.id}:${x.text}`)).toEqual(['item-0:a', 'item-1:b2']);
  });
});
