// A rehab program asked for is a card, not a chat message (Oct 2026). The
// founder asked twice: once Anakin said the old card was "already up" and
// called nothing, once it researched and wrote the whole program in chat.
// Like the nutrition plan check (nutrientAdvice.ts): if they asked for a rehab
// program and no rehab card went up, one more step to put it up.

const VERB = /\b(build|create|make|write|design|draft|start (it )?over|redo|rebuild|new|give me|put together|set up)\b/i;
const REHAB = /\b(rehab(ilitation)?|physio(therapy)?|recovery|return[- ]to[- ](run|running|sport|play|training))\b/i;
const PLAN = /\b(program(me)?|protocol|plan|routine|prescription)\b/i;

/** Pure: did this message ask for a rehab program? */
export function asksForRehabProgram(message: string): boolean {
  const m = String(message ?? '');
  return VERB.test(m) && REHAB.test(m) && PLAN.test(m);
}

/** Pure: the user asked for one, the feature is on for them, and no rehab card (PRG-21) went up this turn. */
export function needsRehabCard(message: string, cardFns: string[], on: boolean): boolean {
  return on && asksForRehabProgram(message) && !cardFns.includes('PRG-21');
}

export const REHAB_CARD_NUDGE =
  '(Server check: they asked for a rehab program and no rehab card went up — a program written in chat can\'t be followed in the app. Call propose_rehab_program now with the full prescription from what you researched, starting at their current week. If it comes back with something to fix, fix it and call it again. If something essential is missing (the surgery date or what was cleared), ask for it in one line instead. Then one short line saying it\'s on the card to review with their physio.)';
