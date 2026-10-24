import { describe, it, expect, vi, beforeEach } from 'vitest';

// Two OpenAI clients are built in chatClient: OpenRouter (has baseURL) and OpenAI direct.
const h = vi.hoisted(() => ({ router: vi.fn(), direct: vi.fn() }));
vi.mock('openai', () => ({
  default: vi.fn(function (this: any, cfg: any) {
    this.chat = { completions: { create: cfg?.baseURL ? h.router : h.direct } };
  }),
}));

import { chatComplete, incompleteJson, OPENROUTER_PROVIDERS, primaryCoolingDown, resetPrimaryCooldownForTests, PRIMARY_COOLDOWN_MS } from '../services/chatClient.js';

const reply = (content: string, finish = 'stop', extra: any = {}) =>
  ({ model: 'm', choices: [{ finish_reason: finish, message: { content } }], usage: { completion_tokens: 10 }, ...extra }) as any;

beforeEach(() => { resetPrimaryCooldownForTests(); h.router.mockReset(); h.direct.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('chatComplete routing', () => {
  it('pins the configured providers with no open fallback and JSON mode required', async () => {
    h.router.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [], max_completion_tokens: 100 });
    const body = h.router.mock.calls[0][0];
    // US hosts only, no prompt retention (audit HIGH-4).
    expect(OPENROUTER_PROVIDERS).toEqual(['fireworks', 'together', 'deepinfra', 'baseten']);
    expect(body.provider).toEqual({ order: ['fireworks', 'together', 'deepinfra', 'baseten'], allow_fallbacks: false, require_parameters: true, data_collection: 'deny' });
    expect(body.max_tokens).toBe(100);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('leaves a model override on throughput routing (the pinned hosts may not serve it)', async () => {
    h.router.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [], modelOverride: 'z-ai/glm-5.2' } as any);
    const body = h.router.mock.calls[0][0];
    expect(body.model).toBe('z-ai/glm-5.2');
    expect(body.provider).toEqual({ sort: 'throughput', require_parameters: true, data_collection: 'deny' });
  });

  it('passes a timeout with no SDK retries only when asked', async () => {
    h.router.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [] });
    expect(h.router.mock.calls[0][1]).toBeUndefined();
    await chatComplete({ messages: [] }, { timeoutMs: 5000 });
    expect(h.router.mock.calls[1][1]).toEqual({ timeout: 5000, maxRetries: 0 });
  });
});

describe('chatComplete requireJson', () => {
  it('returns a complete primary reply untouched', async () => {
    const ok = reply('{"a":1}');
    h.router.mockResolvedValue(ok);
    expect(await chatComplete({ messages: [] }, { requireJson: true })).toBe(ok);
    expect(h.direct).not.toHaveBeenCalled();
  });

  it('falls back to OpenAI when the primary is cut off at the token cap', async () => {
    h.router.mockResolvedValue(reply('```json\n{"phases": [', 'length'));
    const fb = reply('{"phases":[]}');
    h.direct.mockResolvedValue(fb);
    expect(await chatComplete({ messages: [], modelOverride: 'x' } as any, { requireJson: true })).toBe(fb);
    expect(h.direct.mock.calls[0][0].model).toBe('gpt-5.4-mini');
    expect(h.direct.mock.calls[0][0].modelOverride).toBeUndefined();
  });

  it('falls back when the primary JSON will not parse, but accepts a fenced complete object', async () => {
    h.router.mockResolvedValueOnce(reply('not json at all'));
    h.direct.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [] }, { requireJson: true });
    expect(h.direct).toHaveBeenCalledTimes(1);

    h.router.mockResolvedValueOnce(reply('```json\n{"ok":true}\n```'));
    await chatComplete({ messages: [] }, { requireJson: true });
    expect(h.direct).toHaveBeenCalledTimes(1);
  });

  it('falls back on a timeout / error, and without requireJson a cut-off reply is returned as before', async () => {
    h.router.mockRejectedValueOnce(new Error('Request timed out.'));
    h.direct.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [] }, { timeoutMs: 10, requireJson: true });
    expect(h.direct).toHaveBeenCalledTimes(1);
    expect(h.direct.mock.calls[0][1]).toEqual({ timeout: 10, maxRetries: 0 });

    const cut = reply('{"a":', 'length');
    h.router.mockResolvedValueOnce(cut);
    expect(await chatComplete({ messages: [] })).toBe(cut);
  });
});

describe('incompleteJson', () => {
  it('names the problem, or null for a complete document', () => {
    expect(incompleteJson(reply('{"a":1}'))).toBeNull();
    expect(incompleteJson(reply('{"a":', 'length'))).toMatch(/token cap/);
    expect(incompleteJson(reply('```json\n{"a":'))).toMatch(/unparseable/);
    expect(incompleteJson({ choices: [] } as any)).toBe('no choices');
  });
});

describe('chatComplete health-data routing (audit HIGH-4)', () => {
  it('sends a sensitive prompt straight to OpenAI, never OpenRouter', async () => {
    h.direct.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [] }, { sensitive: true });
    expect(h.router).not.toHaveBeenCalled();
    expect(h.direct.mock.calls[0][0].model).toBe('gpt-5.4-mini');
  });

  it('falls back to OpenAI when OpenRouter has no providers available (thrown 404)', async () => {
    h.router.mockRejectedValue(Object.assign(new Error('404 No endpoints found matching your data policy'), { status: 404 }));
    const fb = reply('ok');
    h.direct.mockResolvedValue(fb);
    expect(await chatComplete({ messages: [] })).toBe(fb);
  });

  it('falls back when OpenRouter answers 200 with an error body and no choices', async () => {
    h.router.mockResolvedValue({ error: { message: 'No allowed providers are available for the selected model.' } });
    const fb = reply('ok');
    h.direct.mockResolvedValue(fb);
    expect(await chatComplete({ messages: [] })).toBe(fb);
  });
});


describe('chatComplete rate-limit cooldown', () => {
  it('skips the primary for a while after a 429, then tries it again', async () => {
    h.router.mockRejectedValue(new Error('429 Provider returned error'));
    h.direct.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [] });
    expect(h.router).toHaveBeenCalledTimes(1);
    expect(primaryCoolingDown()).toBe(true);

    await chatComplete({ messages: [] });
    expect(h.router).toHaveBeenCalledTimes(1); // went straight to OpenAI
    expect(h.direct).toHaveBeenCalledTimes(2);

    expect(primaryCoolingDown(Date.now() + PRIMARY_COOLDOWN_MS + 1)).toBe(false);
  });

  it('does not cool down on an ordinary failure, and never for a model override', async () => {
    h.router.mockRejectedValue(new Error('socket hang up'));
    h.direct.mockResolvedValue(reply('{}'));
    await chatComplete({ messages: [] });
    expect(primaryCoolingDown()).toBe(false);

    h.router.mockRejectedValue(new Error('429 Provider returned error'));
    await chatComplete({ messages: [], modelOverride: 'z-ai/glm-5.2' } as any);
    expect(primaryCoolingDown()).toBe(false);
  });
});
