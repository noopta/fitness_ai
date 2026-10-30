// The user's message for the turn in flight, so a tool can read text the user
// pasted without the model copying it into the tool call. A backfill paste
// can run to thousands of characters; re-emitting it as tool input would be
// slow, costly, and an invitation to "tidy" what the user wrote.
//
// Keyed by user: one turn per user at a time is the normal case, and a later
// turn overwriting an earlier one only ever hands a tool the newer message.

const current = new Map<string, string>();

export function setTurnMessage(userId: string, text: string): void {
  current.set(userId, text);
}

export function turnMessage(userId: string): string {
  return current.get(userId) ?? '';
}

// What a log tool needs to put a log on the right day (dayWords.ts): when
// this message was sent, and the messages just before it. Set when the turn
// is loaded from the stored conversation (loadTurn).
export interface TurnFacts {
  /** The user's own text this turn (no app notes). */
  text: string;
  sentAt: string;
  /** Their previous message and when it was sent. */
  prevUser?: { text: string; at: string } | null;
  /** Anakin's last reply and when. */
  prevAssistant?: { text: string; at: string } | null;
}

const facts = new Map<string, TurnFacts>();

export function setTurnFacts(userId: string, f: TurnFacts): void {
  facts.set(userId, f);
}

/** This turn's facts, or a bare version built from the turn message. */
export function turnFacts(userId: string): TurnFacts {
  return facts.get(userId) ?? { text: turnMessage(userId).replace(/<app_note>[\s\S]*?<\/app_note>/g, ' ').trim(), sentAt: new Date().toISOString() };
}
