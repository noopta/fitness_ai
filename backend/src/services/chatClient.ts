// Shared LLM chat client — the single place that decides which provider
// serves the app's general text/JSON prompts.
//
// Primary: DeepSeek V4 Flash via OpenRouter. Same Artificial Analysis
// intelligence index as gpt-5.4-mini (40.3 vs 40.0) at ~1/8 the input and
// ~1/25 the output price (live bake-off verified 2026-07-19).
// Fallback: the original OpenAI gpt-5.4-mini path — an OpenRouter failure
// degrades to the old cost, never to a user-facing error.
//
// Deliberately NOT routed through here: Whisper transcription, the
// Assistants-API threads, and Gemini vision (llmService.ts) — different
// APIs, different providers.
import OpenAI from 'openai';
import { parseModelJson } from './modelJson.js';

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const openaiDirect = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const PRIMARY_CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || 'deepseek/deepseek-v4-flash';
const FALLBACK_CHAT_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-5.4-mini';

/** OpenRouter provider slugs, in preference order (OPENROUTER_PROVIDERS="alibaba,baidu"). */
export const OPENROUTER_PROVIDERS = (process.env.OPENROUTER_PROVIDERS || 'alibaba,baidu')
  .split(',').map((x) => x.trim()).filter(Boolean);

type NonStreamingParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'model'
> & {
  // Optional per-call OpenRouter model override for prompts that warrant a
  // stronger model than the default (e.g. nutrition-plan generation). The
  // OpenAI fallback model is unchanged.
  modelOverride?: string;
};

/** Per-call reliability options for chatComplete. */
export interface ChatCompleteOptions {
  /** Abort the primary call after this long (no SDK retries) and use the fallback. */
  timeoutMs?: number;
  /**
   * The caller needs one complete JSON document: a primary response cut off at
   * the token cap (finish_reason "length") or that won't parse is retried once
   * on the OpenAI fallback instead of being returned.
   */
  requireJson?: boolean;
  /** Names the call in the log line. */
  label?: string;
}
type StreamingParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  'model'
>;

// DeepSeek's OpenRouter endpoint takes max_tokens (not OpenAI's
// max_completion_tokens), and V4 Flash defaults to reasoning effort "high" —
// disable it so short JSON prompts don't pay thinking-token latency/cost.
function toOpenRouterParams<
  T extends { max_completion_tokens?: number | null; modelOverride?: string },
>(params: T) {
  const { max_completion_tokens, modelOverride, ...rest } = params;
  const model = modelOverride || PRIMARY_CHAT_MODEL;
  return {
    ...rest,
    model,
    ...(max_completion_tokens != null ? { max_tokens: max_completion_tokens } : {}),
    reasoning: { enabled: false },
    // Pinned providers, not per-request routing. `sort: 'throughput'` picked a
    // different host each call, and on 6 Oct one of them ignored JSON mode
    // (fenced output) and crawled at ~60 tok/s until the token cap. Bake-off
    // 6 Oct on a 6-day/12-week program prompt (5 runs each): Alibaba 131–136
    // tok/s, Baidu 124–129 tok/s, both 5/5 clean JSON; Parasail ~85,
    // AtlasCloud ~90, DigitalOcean/DeepInfra 33 or timed out, Cloudflare
    // errored. No fallbacks beyond the list — if both are down the OpenAI
    // path below takes over. require_parameters keeps response_format honoured.
    // The pin is for the primary model only: an override (the nutrition plan's
    // GLM) isn't served by these hosts, so it keeps throughput routing — but
    // still only to hosts that honour response_format.
    provider: model === PRIMARY_CHAT_MODEL
      ? { order: OPENROUTER_PROVIDERS, allow_fallbacks: false, require_parameters: true }
      : { sort: 'throughput', require_parameters: true },
  };
}

export async function chatComplete(
  params: NonStreamingParams,
  opts: ChatCompleteOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const reqOpts = opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined;
  const t0 = Date.now();
  let reason: string;
  try {
    const res = await openrouter.chat.completions.create(
      toOpenRouterParams(params) as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      reqOpts,
    );
    if (opts.label) logCall(opts.label, res, t0);
    const bad = opts.requireJson ? incompleteJson(res) : null;
    if (!bad) return res;
    reason = bad;
  } catch (err) {
    reason = (err as Error)?.message ?? String(err);
  }
  console.warn(`[chatClient] ${opts.label ?? 'call'}: OpenRouter primary unusable (${reason}) after ${Date.now() - t0}ms, falling back to OpenAI`);
  const { modelOverride: _ignored, ...fallbackParams } = params;
  const t1 = Date.now();
  const res = await openaiDirect.chat.completions.create(
    { ...fallbackParams, model: FALLBACK_CHAT_MODEL },
    reqOpts,
  );
  if (opts.label) logCall(`${opts.label} (fallback)`, res, t1);
  return res;
}

/** Why a response isn't one complete JSON document, or null when it is. */
export function incompleteJson(res: OpenAI.Chat.Completions.ChatCompletion): string | null {
  const choice = res.choices?.[0];
  if (!choice) return 'no choices';
  if (choice.finish_reason === 'length') return `cut off at the token cap (${res.usage?.completion_tokens ?? '?'} tokens)`;
  try {
    parseModelJson(choice.message?.content ?? '');
    return null;
  } catch (e) {
    return `unparseable JSON: ${(e as Error).message.slice(0, 80)}`;
  }
}

function logCall(label: string, res: OpenAI.Chat.Completions.ChatCompletion, t0: number) {
  const ms = Date.now() - t0;
  const tok = res.usage?.completion_tokens ?? 0;
  const provider = (res as any).provider ?? 'openai';
  console.log(`[llm] ${label} model=${res.model} provider=${provider} finish=${res.choices?.[0]?.finish_reason} tokens=${tok} ms=${ms} tps=${ms ? Math.round(tok / (ms / 1000)) : 0}`);
}

export async function chatStream(params: StreamingParams) {
  try {
    return await openrouter.chat.completions.create(
      toOpenRouterParams(params) as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    );
  } catch (err) {
    console.warn(
      '[chatClient] OpenRouter stream failed, falling back to OpenAI:',
      (err as Error)?.message,
    );
    return openaiDirect.chat.completions.create({
      ...params,
      model: FALLBACK_CHAT_MODEL,
    });
  }
}
