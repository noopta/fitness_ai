// Layer-1 resilience for every outbound LLM/provider call.
//
// Instead of wrapping 30+ call sites, we patch the SDK *prototypes* once at
// startup: every OpenAI and GoogleGenAI client instance in the codebase
// (llmService, geminiService, ragService, feedService, routes, …) shares
// those prototypes, so one hook covers them all.
//
// What the hook does:
//   1. Retries transient failures (429/quota/network/5xx) with backoff —
//      the caller never sees a blip that a retry would have cleared.
//   2. Journals the final failure (and deterministic failures immediately)
//      via errorJournal, tagged with provider/op/model, then rethrows the
//      original error so existing catch-paths behave exactly as before.
//
// Everything is defensive: if an SDK update moves a method, we log a warning
// and skip that hook rather than crash the API at boot.

import { journalError, classifyError } from './errorJournal.js';

export interface GuardOpts {
  provider: string;
  op: string;
  /** Retry transient failures? Off for non-idempotent ops (e.g. createAndPoll). */
  retryable?: boolean;
  /** Backoff schedule in ms between attempts (length = max retries). */
  backoffMs?: number[];
}

const DEFAULT_BACKOFF = [500, 1500];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractModel(args: unknown[]): string | undefined {
  const first = args[0] as any;
  return typeof first?.model === 'string' ? first.model : undefined;
}

/**
 * Run `fn`, retrying transient failures per opts, journaling the terminal
 * failure, and rethrowing the original error. Exported for direct use and
 * for tests.
 */
export async function guardedProviderCall<T>(
  opts: GuardOpts,
  fn: () => Promise<T>,
  callArgs: unknown[] = [],
): Promise<T> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  const maxAttempts = (opts.retryable ?? true) ? backoff.length + 1 : 1;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = classifyError(err) === 'transient';
      if (transient && attempt < maxAttempts) {
        const wait = backoff[attempt - 1] + Math.floor(Math.random() * 250);
        console.warn(`[llm] transient ${opts.provider}:${opts.op} failure (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms:`, (err as any)?.message ?? err);
        await sleep(wait);
        continue;
      }
      journalError({
        source: 'provider',
        error: err,
        provider: opts.provider,
        op: opts.op,
        model: extractModel(callArgs),
        attempts: attempt,
      });
      throw err;
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw lastErr;
}

const WRAPPED = Symbol('llmInstrumented');

/**
 * Replace `proto[method]` with a guarded version. All client instances share
 * the prototype, so this is a process-wide hook. Idempotent.
 */
export function wrapMethod(proto: any, method: string, opts: GuardOpts): boolean {
  const original = proto?.[method];
  if (typeof original !== 'function') return false;
  if (original[WRAPPED]) return true;
  const wrapped = function (this: any, ...args: unknown[]) {
    return guardedProviderCall(opts, () => original.apply(this, args), args);
  };
  (wrapped as any)[WRAPPED] = true;
  proto[method] = wrapped;
  return true;
}

/**
 * Patch the OpenAI + GoogleGenAI SDK prototypes. Call once at startup
 * (index.ts). Safe to call multiple times; safe when an SDK shape changed
 * (warns and skips).
 */
export async function instrumentLLMClients(): Promise<void> {
  // OpenAI — throwaway instance just to reach the shared prototypes.
  try {
    const { default: OpenAI } = await import('openai');
    const tmp: any = new OpenAI({ apiKey: 'sk-instrumentation-probe' });
    const hooks: Array<[any, string, GuardOpts]> = [
      [tmp.chat?.completions, 'create', { provider: 'openai', op: 'chat.completions.create' }],
      [tmp.embeddings, 'create', { provider: 'openai', op: 'embeddings.create' }],
      [tmp.audio?.transcriptions, 'create', { provider: 'openai', op: 'audio.transcriptions.create' }],
      [tmp.beta?.threads, 'create', { provider: 'openai', op: 'threads.create' }],
      [tmp.beta?.threads?.messages, 'create', { provider: 'openai', op: 'threads.messages.create' }],
      [tmp.beta?.threads?.messages, 'list', { provider: 'openai', op: 'threads.messages.list' }],
      // createAndPoll creates a run then polls — a blind retry could double-run
      // a thread, so journal-only.
      [tmp.beta?.threads?.runs, 'createAndPoll', { provider: 'openai', op: 'threads.runs.createAndPoll', retryable: false }],
    ];
    for (const [resource, method, opts] of hooks) {
      if (!resource || !wrapMethod(Object.getPrototypeOf(resource), method, opts)) {
        console.warn(`[llm] could not instrument openai ${opts.op} — SDK shape changed?`);
      }
    }
  } catch (e: any) {
    console.warn('[llm] OpenAI instrumentation skipped:', e?.message ?? e);
  }

  // Gemini (@google/genai) — same prototype trick.
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const tmp: any = new GoogleGenAI({ apiKey: 'instrumentation-probe' });
    const proto = Object.getPrototypeOf(tmp.models);
    for (const method of ['generateContent', 'generateContentStream', 'embedContent']) {
      if (typeof proto?.[method] === 'function') {
        wrapMethod(proto, method, { provider: 'gemini', op: `models.${method}` });
      }
    }
  } catch (e: any) {
    console.warn('[llm] Gemini instrumentation skipped:', e?.message ?? e);
  }

  console.log('✓ LLM clients instrumented (retry + error journal)');
}
