// Claims of an action no tool performed. On 14 Oct 2026 the user said "I have
// a pic" and Anakin replied "Camera's open — snap the pic" without calling
// open_food_capture: nothing opened, and "Where" got vague directions. The
// loop checks the finished reply; a claim with no matching tool gets one more
// step to make it true, and the false sentence is dropped (the final reply
// replaces streamed text on the phone).

const CAMERA_CLAIM = /\b(camera|scanner)(['’]s| is| has)?\s+(now\s+)?(open|up|ready|opened)\b|\bopened (the|your|a) (camera|scanner)\b|\b(snap|take) (the|a|your) (pic|photo|picture|shot)\b/i;
const CAPTURE_TOOLS = ['open_food_capture', 'start_form_check'];

/** Did the reply say a camera/scanner is open when no capture tool ran this turn? Pure. */
export function claimsCaptureWithoutTool(reply: string, toolsUsed: string[]): boolean {
  if (toolsUsed.some((t) => CAPTURE_TOOLS.includes(t))) return false;
  return CAMERA_CLAIM.test(reply);
}

export const CAPTURE_NUDGE =
  '(Server check: your reply says the camera or scanner is open, but no tool opened it — nothing is on the user\'s screen. Call open_food_capture now (mode photo unless they said barcode or a takeout order), then reply with ONE short line saying the camera card is up. Don\'t repeat your earlier reply.)';

// 20 Oct 2026: asked twice more to start the gut questions, Anakin said
// "That's already open on your screen — question 1 of 13" both times without
// calling anything. The card had scrolled away; he had nothing to tap. A claim
// that something is already showing, with no tool this turn, gets one more
// step: call the tool that brings it back.
const SHOWN_CLAIM = /\b(card|cards|question|questions|it|that|this)(['’]s| is| are)?\s+(already|still)\s+(open|up|running|showing|live|on (?:your|the) screen|in (?:the|our) chat)\b|\b(?:right |up )?(?:there |up )?on (?:your|the) screen\b/i;

/** Did the reply say a card is already on screen when no tool ran this turn? Pure. */
export function claimsShownWithoutTool(reply: string, toolsUsed: string[]): boolean {
  if (toolsUsed.length) return false;
  return SHOWN_CLAIM.test(reply);
}

export const SHOWN_NUDGE =
  '(Server check: your reply says something is already on the user\'s screen, but no tool ran this turn — the card may have scrolled away or closed, and they are asking because they can\'t see it. Call the tool that shows it now (for the gut and nutrition questions: start_nutrition_assessment, which resumes where they left off), then ONE short line. Don\'t repeat your earlier reply.)';

// 29 Oct 2026: Saeed described a Muay Thai session and Anakin replied
// "Logged — Muay Thai conditioning, about 45 minutes…" with no tool called.
// Nothing saved until his third ask. A reply may only say something was
// logged or saved when a tool saved it this turn; "it's already in your log"
// needs at least a look at the log. A claim with nothing behind it gets one
// more step; if it's still unbacked, the claim is replaced, never shown.

/** "Logged — …", "I've saved…", "it's in the books", "added to your log": an action this turn. */
const ACTION_CLAIM = /(?:^|[.!?\n]\s*|[—–-]\s+|:\s+)(logged|saved|recorded|added|tracked)\b(?!\s+(by|for you to|whenever|when|once|sugars?\b))|\bi(?:'ve| have)?\s+(?:just\s+|now\s+|also\s+)?(logged|saved|recorded|added|tracked)\b(?=[^.!?\n]{0,60}\b(log|day|history|diary|in|it|that|this|session|workout|meal|as)\b)|\b(?:it'?s|that'?s|this is|both are|they'?re|everything'?s|all|those are|these are)\s+(?:now\s+|all\s+)?(logged|saved|recorded|in the books|in your log|on your log|tracked)\b|\b(?:is|are|was|were|got|has been|have been)\s+(?:now\s+|all\s+)?(logged|saved|recorded|tracked)\b|\bin the books\b|\b(?:added|saved|logged) (?:it |that |this |them )?(?:to|in|on|under) your (log|day|history|diary|today)\b/i;
/** "Already logged", "already on your log": a statement about the log, not an action. */
const STATUS_CLAIM = /\balready\s+(?:been\s+)?(logged|saved|recorded|on your log|in your log|in the log|on file|tracked|in there)\b|\b(?:is|are)\s+(?:already\s+)?(?:on|in) your log\b/i;
/** A sentence that denies, conditions or asks ("isn't logged yet", "once it's logged", "want me to log it?"). */
const HEDGED = /\b(not|n't|never|no|nothing|yet|once|when|after|if|until|before|whenever|unless|want me|should i|shall i|could|would|will|i'?ll|let me|going to|you logged|you'?ve logged|you saved|you recorded|(a|an|any|every|each) (workout|session|meal|set|lift|log|run))\b|\?/i;

export type LogClaim = 'action' | 'status' | null;

function sentences(reply: string): string[] {
  return String(reply ?? '').replace(/[’‘]/g, "'").split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
}

function claimIn(s: string): LogClaim {
  const a = s.match(ACTION_CLAIM);
  const st = s.match(STATUS_CLAIM);
  const first = [a, st].filter(Boolean).sort((x, y) => x!.index! - y!.index!)[0];
  if (!first) return null;
  // Only the clause the claim sits in: "No need to log it again, it's already saved" claims; "Once it's logged, …" doesn't.
  const end = first.index! + first[0].length;
  const before = s.slice(0, first.index! + first[0].search(/\S/));
  const cut = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf('—'), before.lastIndexOf('–'), before.lastIndexOf(' - '));
  if (HEDGED.test(s.slice(cut + 1, end + 12))) return null;
  return first === st ? 'status' : 'action';
}

/** Pure: does the reply claim a log happened ('action') or is already there ('status')? */
export function logClaim(reply: string): LogClaim {
  let out: LogClaim = null;
  for (const s of sentences(reply)) {
    const c = claimIn(s);
    if (c === 'action') return 'action';
    if (c) out = c;
  }
  return out;
}

/** Tools that don't save: a claim needs one of the others (kind log/set) to have succeeded. */
export function claimsLogWithoutSave(reply: string, saved: string[], toolsUsed: string[]): LogClaim {
  const c = logClaim(reply);
  if (c === 'action' && !saved.length) return 'action';
  if (c === 'status' && !toolsUsed.length) return 'status';
  return null;
}

export const LOG_CLAIM_NUDGE =
  '(Server check: your reply says something was logged or saved, but no tool saved anything this turn — it is not in their log, and that reply was not shown. If they told you something to log, call the tool that logs it now (log_conditioning, log_workout, log_meal…), then write your reply. If it was logged on an earlier turn, call the read tool for that day and say what it shows. Never say logged or saved unless a tool saved it this turn.)';

/** Pure: the reply with every unbacked log claim taken out, and an honest line in its place. */
export function dropLogClaims(reply: string): string {
  const kept = sentences(reply).filter((s) => !claimIn(s));
  const line = 'I haven’t saved that yet — say the word and I’ll log it.';
  return [kept.join(' ').trim(), line].filter(Boolean).join(' ');
}
