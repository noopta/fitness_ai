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
