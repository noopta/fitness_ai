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
