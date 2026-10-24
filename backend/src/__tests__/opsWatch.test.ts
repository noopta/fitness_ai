import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/growth/telegramPublisher.js', () => ({ sendTelegramMessage: vi.fn() }));

import {
  recordLlmPrimary, recordRoute, evaluate, due, servingProviders, resetOpsWatchForTests,
  WINDOW_MS, REALERT_MS, SLOW_P90_MS,
} from '../services/opsWatch.js';

const T = 1_800_000_000_000;
beforeEach(() => resetOpsWatchForTests());

describe('ops watchdog: LLM primary', () => {
  it('alerts when most primary calls in the window fell back (the Oct 17–24 week)', () => {
    for (let i = 0; i < 12; i++) recordLlmPrimary(false, T + i);
    for (let i = 0; i < 3; i++) recordLlmPrimary(true, T + 100 + i);
    expect(evaluate(T + 1000).map((a) => a.key)).toEqual(['llm_primary']);
  });

  it('stays quiet for a few failures, or once they age out of the window', () => {
    for (let i = 0; i < 5; i++) recordLlmPrimary(false, T + i);
    expect(evaluate(T + 1000)).toEqual([]);
    for (let i = 0; i < 12; i++) recordLlmPrimary(false, T + i);
    expect(evaluate(T + WINDOW_MS + 10_000)).toEqual([]);
  });
});

describe('ops watchdog: routes', () => {
  it('alerts on a slow p90 and on users abandoning a route (the Fuel page)', () => {
    for (let i = 0; i < 10; i++) recordRoute('GET /nutrition-profile', SLOW_P90_MS + 2_000, false, T + i);
    for (let i = 0; i < 3; i++) recordRoute('GET /nutrition-profile', 3_000, true, T + 50 + i);
    const keys = evaluate(T + 1000).map((a) => a.key).sort();
    expect(keys).toEqual(['aborts:GET /nutrition-profile', 'slow:GET /nutrition-profile']);
  });

  it('ignores long-by-design routes and quick ones', () => {
    for (let i = 0; i < 10; i++) recordRoute('POST /coach/agent', 30_000, i < 5, T + i);
    for (let i = 0; i < 10; i++) recordRoute('GET /workouts', 200, false, T + i);
    expect(evaluate(T + 1000)).toEqual([]);
  });
});

describe('ops watchdog: dedupe and provider coverage', () => {
  it('sends each alert key at most once per re-alert window', () => {
    const a = [{ key: 'llm_primary', text: 'x' }];
    expect(due(a, T)).toHaveLength(1);
    expect(due(a, T + 60_000)).toHaveLength(0);
    expect(due(a, T + REALERT_MS + 1)).toHaveLength(1);
  });

  it('counts the pinned hosts that actually serve the model', () => {
    const endpoints = [{ tag: 'deepinfra/fp8', provider_name: 'DeepInfra' }, { tag: 'azure/us', provider_name: 'Azure' }, { tag: 'baidu/fp8' }];
    expect(servingProviders(['fireworks', 'together', 'deepinfra', 'baseten'], endpoints)).toEqual(['deepinfra']);
    expect(servingProviders(['deepinfra', 'azure'], endpoints)).toEqual(['deepinfra', 'azure']);
  });
});

describe('ops watchdog: middleware', () => {
  it('records a closed-before-finish response as an abort, keyed by the matched route', async () => {
    const { EventEmitter } = await import('node:events');
    const { opsTiming } = await import('../services/opsWatch.js');
    for (let i = 0; i < 3; i++) {
      const res: any = Object.assign(new EventEmitter(), { writableFinished: false });
      const req: any = { method: 'GET', route: { path: '/nutrition-profile' } };
      opsTiming(req, res, () => {});
      res.emit('close');
    }
    expect(evaluate().map((a) => a.key)).toEqual(['aborts:GET /nutrition-profile']);
  });
});
