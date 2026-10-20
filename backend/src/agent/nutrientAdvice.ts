// Nutrient advice has to land somewhere the user can track it. On 11 Oct 2026
// the coach recommended vitamin C, zinc and omega-3 doses after a user's
// surgery, then put up a calories-and-macros card only — and later said the
// app couldn't track micronutrients. A prompt rule alone was a coin flip, so
// the loop checks the finished reply: amounts recommended and no plan card →
// one more step asking for the card.

const NUTRIENT = /\b(vitamin\s?[a-k]\d?|d3|zinc|omega[- ]?3|epa|dha|magnesium|iron|calcium|potassium|folate|b12|collagen|fib(?:er|re)|creatine|protein|electrolytes?|sodium)\b/i;
const AMOUNT = /\b\d[\d,.]*\s?(?:[-–]|to)?\s?\d*[\d,.]*\s?(?:mg|mcg|µg|iu|g)\b/i;
const PRESCRIPTIVE = /\b(per day|a day|\/day|daily|each day|aim|target|take|add|push|bump|raise|hit|get to|keep .* (near|at|around))\b/i;
// Any nutrition-targets card counts — a macro card IS the plan card for "protein 170, carbs 250"
// (20 Oct: the check fired after propose_macro_change and its meta-reply reached the user).
const PLAN_TOOLS = ['propose_nutrition_plan_change', 'propose_nutrition_plan', 'propose_macro_change', 'set_macro_targets', 'adjust_macros', 'set_nutrition_targets', 'log_supplement_plan'];

/** Did the reply recommend nutrient amounts without putting up a plan card? Pure. */
export function needsPlanCard(reply: string, toolsUsed: string[]): boolean {
  if (toolsUsed.some((t) => PLAN_TOOLS.includes(t))) return false;
  // Sentence by sentence: a nutrient, an amount and a "do this" in the same sentence.
  const sentences = reply.split(/(?<=[.!?\n])\s+/);
  return sentences.some((s) => NUTRIENT.test(s) && AMOUNT.test(s) && PRESCRIPTIVE.test(s));
}

export const PLAN_CARD_NUDGE =
  '(Server check: your reply recommends nutrient amounts but no plan card went up. If you meant them as targets for the user, call propose_nutrition_plan_change now with all of them — focus nutrients, a target for each, supplements with dose and when, and any calorie/macro change — then add ONE short line saying it\'s on the card to apply. If you were only answering a factual question and not recommending targets, reply with nothing.)';

/**
 * Pure: drop the model's talk about the server check itself ("I'm disregarding
 * that check…", "Server check: …") from the reply that follows the nudge. That
 * reply is meant to be one short line about the card, or nothing.
 */
export function stripNudgeTalk(text: string): string {
  return text
    .split(/(?<=[.!?\n])\s+/)
    .filter((s) => !/\b(server check|that check|the check|disregard(?:ing)?|nudge|no further (?:card|proposal)|nothing further to propose|reply with nothing)\b/i.test(s))
    .join(' ')
    .trim();
}

// Something eaten or taken has to be logged, not just talked about. On 20 Oct
// 2026 "Took magnesium glycinate 400mg and vitamin D3 5000 IU" got a friendly
// reply about doses and no log — so the day's micros never saw it. Same shape
// as the plan-card check: the finished turn is checked, and one more step asks
// for the log.
const SUPPLEMENT = /\b(vitamin\s?[a-k]\d{0,2}|d3|k2|zinc|magnesium|omega[- ]?3|fish oil|epa|dha|creatine|iron|calcium|potassium|folate|b12|b[- ]?complex|multi(?:vitamin)?|electrolytes?|collagen|supplements?|capsules?|pills?|tablets?|gummies|protein (?:shake|powder|bar)|whey|melatonin|ashwagandha|probiotic)\b/i;
const DOSE = /\b\d[\d,.]*\s?(?:mg|mcg|µg|iu|g|ml|oz|cups?|scoops?|servings?|caps?|tabs?)\b/i;
const MEAL = /\b(breakfast|lunch|dinner|supper|snack|brunch|pre[- ]?workout|post[- ]?workout|shake|smoothie|coffee|meal)\b/i;
const ATE = /\b(i\s+)?(?:just\s+)?(?:ate|drank|eaten|devoured)\b/i;
const TOOK = /\b(?:took|taken|popped|i'?m\s+taking|i\s+take|just\s+had|i\s+had|had\s+(?:a|an|my|some|\d))\b/i;
const ASKING = /\b(should i|can i|could i|is it (?:ok|okay|fine|safe|bad)|do i need|how much|what (?:if|about)|would it)\b/i;
const LOG_TOOLS = ['log_meal', 'log_saved_food', 'log_recipe', 'update_meal'];

/** Did the user report eating or taking something that the turn never logged? Pure. */
export function needsIntakeLog(message: string, toolsUsed: string[]): boolean {
  if (toolsUsed.some((t) => LOG_TOOLS.includes(t))) return false;
  const text = message.replace(/<app_note>[\s\S]*?<\/app_note>/g, ' ');
  return text.split(/(?<=[.!?\n])\s+/).some((s) => {
    if (ASKING.test(s)) return false;
    if (ATE.test(s)) return true;
    return TOOK.test(s) && (SUPPLEMENT.test(s) || DOSE.test(s) || MEAL.test(s));
  });
}

export const INTAKE_LOG_NUDGE =
  '(Server check: the user said they ate, drank or took something, and nothing was logged — so it is missing from their day, micronutrients included. If it was a report of what they had, call log_meal now with it exactly as they said it (supplements with each dose as written — the dose is the nutrient amount), then add ONE short line confirming it\'s logged. If it was not something they had, reply with nothing.)';
