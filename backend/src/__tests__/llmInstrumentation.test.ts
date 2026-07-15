// Layer-1 resilience: guardedProviderCall must retry transient provider
// failures, never retry deterministic ones or non-idempotent ops, and
// journal the terminal failure while rethrowing the original error.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockJournal } = vi.hoisted(() => ({ mockJournal: vi.fn() }));
vi.mock('../services/errorJournal.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, journalError: mockJournal };
});

import { guardedProviderCall, wrapMethod } from '../services/llmInstrumentation.js';

const NO_BACKOFF = { backoffMs: [0, 0] };

beforeEach(() => mockJournal.mockReset());

describe('guardedProviderCall', () => {
  it('retries a transient failure and succeeds without journaling', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
      .mockResolvedValueOnce('ok');
    const out = await guardedProviderCall({ provider: 'openai', op: 'test', ...NO_BACKOFF }, fn);
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockJournal).not.toHaveBeenCalled();
  });

  it('does not retry deterministic failures; journals and rethrows', async () => {
    const boom = new TypeError('undefined is not a function');
    const fn = vi.fn().mockRejectedValue(boom);
    await expect(
      guardedProviderCall({ provider: 'openai', op: 'chat.completions.create', ...NO_BACKOFF }, fn, [{ model: 'gpt-x' }]),
    ).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockJournal).toHaveBeenCalledWith(expect.objectContaining({
      source: 'provider', provider: 'openai', op: 'chat.completions.create', model: 'gpt-x', attempts: 1,
    }));
  });

  it('journals after exhausting retries on a persistent transient failure', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
    await expect(guardedProviderCall({ provider: 'gemini', op: 'models.generateContent', ...NO_BACKOFF }, fn))
      .rejects.toThrow('overloaded');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(mockJournal).toHaveBeenCalledWith(expect.objectContaining({ attempts: 3 }));
  });

  it('honors retryable: false for non-idempotent ops even on transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { status: 504 }));
    await expect(
      guardedProviderCall({ provider: 'openai', op: 'threads.runs.createAndPoll', retryable: false }, fn),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('wrapMethod (prototype patching)', () => {
  it('wraps once, preserves this-binding, and covers all instances sharing the prototype', async () => {
    class FakeResource {
      label = 'real-instance';
      async create(_req: unknown) { return `hello from ${this.label}`; }
    }
    const a = new FakeResource();
    const b = new FakeResource();
    expect(wrapMethod(FakeResource.prototype, 'create', { provider: 'fake', op: 'create' })).toBe(true);
    // Idempotent — wrapping again keeps the single wrapper.
    expect(wrapMethod(FakeResource.prototype, 'create', { provider: 'fake', op: 'create' })).toBe(true);

    await expect(a.create({})).resolves.toBe('hello from real-instance');
    b.label = 'second';
    await expect(b.create({})).resolves.toBe('hello from second');
  });

  it('journals through the wrapper when the underlying method fails deterministically', async () => {
    class Failing {
      async generateContent(req: any) { throw new Error(`bad request for ${req.model}`); }
    }
    wrapMethod(Failing.prototype, 'generateContent', { provider: 'gemini', op: 'models.generateContent', backoffMs: [0, 0] });
    await expect(new Failing().generateContent({ model: 'gemini-test' })).rejects.toThrow('bad request');
    expect(mockJournal).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-test' }));
  });

  it('returns false for missing methods instead of throwing', () => {
    expect(wrapMethod({}, 'nope', { provider: 'x', op: 'y' })).toBe(false);
    expect(wrapMethod(undefined, 'nope', { provider: 'x', op: 'y' })).toBe(false);
  });
});
