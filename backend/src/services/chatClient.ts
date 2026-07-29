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

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const openaiDirect = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const PRIMARY_CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || 'deepseek/deepseek-v4-flash';
const FALLBACK_CHAT_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-5.4-mini';

type NonStreamingParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'model'
> & {
  // Optional per-call OpenRouter model override for prompts that warrant a
  // stronger model than the default (e.g. nutrition-plan generation). The
  // OpenAI fallback model is unchanged.
  modelOverride?: string;
};
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
  return {
    ...rest,
    model: modelOverride || PRIMARY_CHAT_MODEL,
    ...(max_completion_tokens != null ? { max_tokens: max_completion_tokens } : {}),
    reasoning: { enabled: false },
    // Route to the fastest provider serving the model. Parse latency showed
    // 14s+ tails on default routing — user-facing flows (Describe review,
    // photo review) sit directly on this.
    provider: { sort: 'throughput' },
  };
}

export async function chatComplete(
  params: NonStreamingParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  try {
    return await openrouter.chat.completions.create(
      toOpenRouterParams(params) as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    );
  } catch (err) {
    console.warn(
      '[chatClient] OpenRouter primary failed, falling back to OpenAI:',
      (err as Error)?.message,
    );
    const { modelOverride: _ignored, ...fallbackParams } = params;
    return openaiDirect.chat.completions.create({
      ...fallbackParams,
      model: FALLBACK_CHAT_MODEL,
    });
  }
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
