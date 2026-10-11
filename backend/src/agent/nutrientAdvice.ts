// Nutrient advice has to land somewhere the user can track it. On 11 Oct 2026
// the coach recommended vitamin C, zinc and omega-3 doses after a user's
// surgery, then put up a calories-and-macros card only — and later said the
// app couldn't track micronutrients. A prompt rule alone was a coin flip, so
// the loop checks the finished reply: amounts recommended and no plan card →
// one more step asking for the card.

const NUTRIENT = /\b(vitamin\s?[a-k]\d?|d3|zinc|omega[- ]?3|epa|dha|magnesium|iron|calcium|potassium|folate|b12|collagen|fib(?:er|re)|creatine|protein|electrolytes?|sodium)\b/i;
const AMOUNT = /\b\d[\d,.]*\s?(?:[-–]|to)?\s?\d*[\d,.]*\s?(?:mg|mcg|µg|iu|g)\b/i;
const PRESCRIPTIVE = /\b(per day|a day|\/day|daily|each day|aim|target|take|add|push|bump|raise|hit|get to|keep .* (near|at|around))\b/i;
const PLAN_TOOLS = ['propose_nutrition_plan_change', 'propose_nutrition_plan'];

/** Did the reply recommend nutrient amounts without putting up a plan card? Pure. */
export function needsPlanCard(reply: string, toolsUsed: string[]): boolean {
  if (toolsUsed.some((t) => PLAN_TOOLS.includes(t))) return false;
  // Sentence by sentence: a nutrient, an amount and a "do this" in the same sentence.
  const sentences = reply.split(/(?<=[.!?\n])\s+/);
  return sentences.some((s) => NUTRIENT.test(s) && AMOUNT.test(s) && PRESCRIPTIVE.test(s));
}

export const PLAN_CARD_NUDGE =
  '(Server check: your reply recommends nutrient amounts but no plan card went up. If you meant them as targets for the user, call propose_nutrition_plan_change now with all of them — focus nutrients, a target for each, supplements with dose and when, and any calorie/macro change — then add ONE short line saying it\'s on the card to apply. If you were only answering a factual question and not recommending targets, reply with nothing.)';
