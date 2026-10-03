// Signed turns (chat spec "Signed turns", 3 Oct): no bubbles — each turn is
// signed. Anakin: his mark + name in a 22 pt gutter. You: a small "You" label
// above right-aligned text. These are the rules for when a signature, a label
// and a time stamp show; the app only draws what they return.

import type { Turn, ReceiptVerb } from './receipts';

export interface SignedSlot {
  /** "Today 1:57" — shown above the turn, or null. */
  stamp: string | null;
  /** User turns: the "You" label. False when grouped under the previous one. */
  showLabel: boolean;
  /** Agent turns: the mark + name. The gutter is reserved either way. */
  showSignature: boolean;
  /** Stacked under the previous turn (6 pt apart) instead of a new turn (30 pt). */
  grouped: boolean;
}

/** Consecutive user messages within this stack under one "You". */
export const GROUP_MS = 2 * 60_000;
/** A time stamp shows before a turn that starts a new day or follows a gap longer than this. */
export const STAMP_GAP_MS = 10 * 60_000;

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** `Today 1:57`, `Yesterday 6:10`, `Mon 28 Sep` — in the device's time zone. */
export function stampLabel(at: number, now: number): string {
  const d = new Date(at);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  const clock = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** Where signatures, labels and stamps go, one slot per turn. */
export function signedLayout(turns: Turn[], now: number): SignedSlot[] {
  const out: SignedSlot[] = [];
  let lastAt: number | null = null;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const prev = i > 0 ? turns[i - 1] : null;
    let stamp: string | null = null;
    if (t.at != null) {
      if (lastAt == null || startOfDay(t.at) !== startOfDay(lastAt) || t.at - lastAt > STAMP_GAP_MS) stamp = stampLabel(t.at, now);
      lastAt = t.at;
    }
    const grouped = !stamp && t.kind === 'user' && prev?.kind === 'user'
      && t.at != null && prev.at != null && t.at - prev.at <= GROUP_MS;
    out.push({ stamp, showLabel: t.kind === 'user' && !grouped, showSignature: t.kind === 'agent', grouped });
  }
  return out;
}

const READS: ReadonlySet<ReceiptVerb> = new Set(['Read', 'Pulled', 'Heard']);

/**
 * What the label says while Anakin works ("Anakin is reading your logs…"),
 * from the turn's latest receipt; null once the turn is done (the label is
 * then just "Anakin").
 */
export function workingLabel(t: Turn): string | null {
  if (t.kind !== 'agent' || t.done) return null;
  if (t.text) return 'Anakin is writing…';
  const v = t.receipts.length ? t.receipts[t.receipts.length - 1].verb : null;
  if (!v) return 'Anakin is thinking…';
  if (READS.has(v)) return 'Anakin is reading your logs…';
  if (v === 'Searched') return 'Anakin is searching…';
  if (v === 'Checked') return 'Anakin is checking your week…';
  if (v === 'Computed' || v === 'Delegated') return 'Anakin is working it out…';
  return 'Anakin is drafting…';
}

/** One spoken line per turn: "Anakin: …" / "You: …". */
export function turnA11yLabel(t: Turn): string {
  const who = t.kind === 'user' ? 'You' : 'Anakin';
  return `${who}: ${t.text.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()}`;
}
