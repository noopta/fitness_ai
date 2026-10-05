// OpenFoodFacts lookup classification. The bodies below are the shapes the v3
// API actually returns (captured 5 Oct 2026) — the original route only ever
// assumed a 200, and read OFF's 404 "product_not_found" as an outage, so an
// unlisted barcode surfaced as "OpenFoodFacts unreachable" in production.

import { describe, it, expect, vi } from 'vitest';
import { lookupOpenFoodFacts, OFF_BASE } from '../services/food/openFoodFacts.js';

const FOUND = { code: '737628064502', status: 'success_with_warnings', result: { id: 'product_found' }, product: { product_name: 'Thai peanut noodle kit', nutriments: { 'energy-kcal_100g': 385 } } };
const NOT_FOUND = { code: '6154000123456', status: 'failure', result: { id: 'product_not_found', name: 'Product not found' }, errors: [{ message: { id: 'not_found' } }] };

function res(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('lookupOpenFoodFacts', () => {
  it('returns the product on a 200 with a product body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, FOUND));
    const out = await lookupOpenFoodFacts('737628064502', fetchFn, 0);
    expect(out).toEqual({ kind: 'found', product: FOUND.product });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(`${OFF_BASE}/737628064502.json`);
  });

  it("treats OFF's v3 404 product_not_found as a miss, not an outage (the production bug)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(404, NOT_FOUND));
    const out = await lookupOpenFoodFacts('6154000123456', fetchFn, 0);
    expect(out).toEqual({ kind: 'not_found' });
    expect(fetchFn).toHaveBeenCalledTimes(1); // a miss is final — no retry
  });

  it('treats a 404 with a non-JSON body as a miss', async () => {
    const out = await lookupOpenFoodFacts('6154000123456', vi.fn().mockResolvedValue(res(404, '<html>Not found</html>')), 0);
    expect(out).toEqual({ kind: 'not_found' });
  });

  it('treats a v2-style 200 with status 0 as a miss', async () => {
    const out = await lookupOpenFoodFacts('123456', vi.fn().mockResolvedValue(res(200, { status: 0, status_verbose: 'product not found' })), 0);
    expect(out).toEqual({ kind: 'not_found' });
  });

  it('treats a 200 with an unparseable body as a miss', async () => {
    const out = await lookupOpenFoodFacts('123456', vi.fn().mockResolvedValue(res(200, 'not json')), 0);
    expect(out).toEqual({ kind: 'not_found' });
  });

  it('treats other 4xx (code rejected) as a miss, not an outage', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(400, { status: 'failure' }));
    expect(await lookupOpenFoodFacts('123456', fetchFn, 0)).toEqual({ kind: 'not_found' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries once on a 503 and returns the product if the retry lands', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(res(503, 'busy')).mockResolvedValueOnce(res(200, FOUND));
    expect(await lookupOpenFoodFacts('737628064502', fetchFn, 0)).toEqual({ kind: 'found', product: FOUND.product });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable with the upstream status when both attempts 5xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(503, 'busy'));
    expect(await lookupOpenFoodFacts('737628064502', fetchFn, 0)).toEqual({ kind: 'unavailable', upstream: 503, reason: 'upstream' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('treats 429 rate limiting as transient', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(res(429, 'slow down')).mockResolvedValueOnce(res(404, NOT_FOUND));
    expect(await lookupOpenFoodFacts('6154000123456', fetchFn, 0)).toEqual({ kind: 'not_found' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports a network failure as unavailable after one retry', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    expect(await lookupOpenFoodFacts('737628064502', fetchFn, 0)).toEqual({ kind: 'unavailable', upstream: null, reason: 'network' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('labels a timeout as such', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const fetchFn = vi.fn().mockRejectedValue(timeout);
    expect(await lookupOpenFoodFacts('737628064502', fetchFn, 0)).toEqual({ kind: 'unavailable', upstream: null, reason: 'timeout' });
  });

  it('recovers from a network blip on the retry', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(res(404, NOT_FOUND));
    expect(await lookupOpenFoodFacts('6154000123456', fetchFn, 0)).toEqual({ kind: 'not_found' });
  });
});
