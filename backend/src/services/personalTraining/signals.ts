// Reading free text a client wrote for a mention of pain. Keyword based and
// deliberately over-inclusive: this only decides what a trainer is shown, and
// a safety event that reaches a human for nothing is the cheaper mistake.

const PAIN = /\b(pain(?:ful)?|hurt(?:s|ing)?|sore(?:ness)?|ach(?:e|es|ing)|tweak(?:ed)?|strain(?:ed)?|sprain(?:ed)?|injur(?:y|ed)|pinch(?:ed|ing)?|sharp|swollen|swelling|tight(?:ness)?|niggle|flare(?:d)?(?:[- ]up)?)\b/i;
// "No pain", "not sore", "pain free", "nothing hurts" are the opposite signal.
const NEGATED = /\b(no|not|without|zero|never|nothing|none)\b[^.!?]{0,24}\b(pain|hurt|hurts|sore|soreness|ache|aches|niggles?|issues?|injur(?:y|ies))\b|\bpain[- ]free\b|^\s*(no|none|nope|n\/a|na|nothing)\s*[.!]?\s*$/i;

/** The sentence that mentions pain, trimmed for display, or null. */
export function painMention(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s || !PAIN.test(s) || NEGATED.test(s)) continue;
    return s.length > 140 ? `${s.slice(0, 137)}…` : s;
  }
  return null;
}
