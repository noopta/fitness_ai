// Card notes — how the next turn knows what is on screen ("make it 190"
// refers to the proposal), without the model ever seeing itself write one.
//
// The first version appended a line per card to the stored assistant text:
//   [card SCH-04 glance id=…: Today · Session · 62 min]
// The model read those lines back as its own earlier replies and started
// writing them itself, with made-up ids, into the visible reply. So now:
//   - cards are stored beside the reply (`cards` on the stored message), not
//     inside its text;
//   - the model is told about them in an <app_note> at the top of the NEXT
//     user message — no ids, no codes, nothing shaped like a reply;
//   - anything card-note-shaped the model still writes is removed from the
//     stream and from the final reply before it is sent or stored.
// Transcripts stored before this change still carry the old lines; they are
// parsed out on read, so no migration is needed.

import type { Card } from './cards/types.js';

export interface CardRef { id: string; fn: string; pattern: string; what: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPEN = '[card ';
/** A note can't run past this — a longer "[card …" is prose, not a note. */
const MAX_NOTE = 600;
const NOTE = new RegExp(`\\n?[ \\t]*\\[card [^\\]\\n]{0,${MAX_NOTE}}\\]`, 'g');
const NOTE_PARTS = /\[card (\S+) (\S+) id=([^\s:\]]+):? ?([^\]\n]*)\]/g;
const APP_NOTE = /<app_note>[\s\S]*?<\/app_note>\s*/g;

export function cardRef(c: Card): CardRef {
  const what = c.change
    ? `${c.change.key}: ${c.change.from} → ${c.change.to}`
    : (c.diff ?? []).map((d) => `${d.key}: ${d.from ?? ''} → ${d.to}`).join('; ') || c.meta?.label || c.fn;
  return { id: c.id, fn: c.fn, pattern: c.pattern, what: String(what) };
}

/** Remove anything card-note-shaped (and any echoed app note) from model text. */
export function stripCardNotes(text: string): string {
  return text.replace(APP_NOTE, '').replace(NOTE, '').trim();
}

/**
 * Split a stored assistant message into its text and its cards. Handles both
 * the current shape (`cards` beside the text) and old transcripts (note lines
 * inside the text). Old lines the model made up carry ids that aren't cards;
 * only real-looking ids are returned.
 */
export function splitStored(m: { text: string; cards?: CardRef[] }): { text: string; cards: CardRef[] } {
  const cards: CardRef[] = [...(m.cards ?? [])];
  const seen = new Set(cards.map((c) => c.id));
  for (const x of m.text.matchAll(NOTE_PARTS)) {
    const [, fn, pattern, id, what] = x;
    if (!UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    cards.push({ id, fn, pattern, what: what.trim() });
  }
  return { text: stripCardNotes(m.text), cards };
}

/** What the model is told about the cards under its last reply. No ids, no codes. */
export function appNote(cards: CardRef[]): string {
  if (!cards.length) return '';
  const lines = cards.map((c) => `- ${c.pattern}: ${c.what.replace(/[<>]/g, '')}`);
  return `<app_note>\nThe app showed these cards under your previous reply (the user can see and tap them):\n${lines.join('\n')}\n</app_note>`;
}

/**
 * Removes card notes from a token stream. Text is passed through as it
 * arrives; only a run that could still turn out to be "[card …]" is held
 * back until it resolves one way or the other.
 */
export class CardNoteFilter {
  private held = '';

  push(delta: string): string {
    let s = this.held + delta;
    this.held = '';
    let out = '';
    while (s) {
      const i = s.indexOf('[');
      if (i < 0) { out += s; break; }
      out += s.slice(0, i);
      s = s.slice(i);
      if (s.length < OPEN.length) {
        if (OPEN.startsWith(s)) { this.held = s; break; }
        out += '['; s = s.slice(1); continue;
      }
      if (!s.startsWith(OPEN)) { out += '['; s = s.slice(1); continue; }
      const end = s.search(/[\]\n]/);
      if (end < 0) {
        if (s.length > MAX_NOTE) { out += s; s = ''; } else { this.held = s; }
        break;
      }
      if (s[end] === ']') s = s.slice(end + 1); // a note — dropped
      else { out += s.slice(0, end); s = s.slice(end); } // a line break first: prose
    }
    return out;
  }

  /** End of the reply: whatever was still held was never a note. */
  flush(): string {
    const h = this.held;
    this.held = '';
    return h.startsWith(OPEN) ? '' : h;
  }
}
