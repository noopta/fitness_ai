// Parsing JSON that came back from a language model.
//
// We ask for `response_format: json_object`, but that is a request, not a
// guarantee: OpenRouter routes to whichever provider is fastest, and some of
// them return the object wrapped in a Markdown fence (```json … ```) or with a
// sentence before it. A strict JSON.parse then throws and the user sees a
// 500 for a response that contained exactly what we asked for.

/**
 * JSON.parse that tolerates a code fence or surrounding prose. Valid JSON
 * takes the fast path untouched; only on failure is the outermost object or
 * array extracted and retried. If that also fails, the ORIGINAL error is
 * thrown, so genuinely malformed output still surfaces as it did before.
 */
export function parseModelJson<T = any>(raw: string | null | undefined): T {
  const text = raw ?? '';
  try {
    return JSON.parse(text) as T;
  } catch (original) {
    const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    const candidates = [fenced?.[1], outermost(text, '{', '}'), outermost(text, '[', ']')];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate.trim()) as T;
      } catch {
        // try the next shape
      }
    }
    throw original;
  }
}

function outermost(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}
