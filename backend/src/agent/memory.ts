// Long-term agent memory — the layer that turns a stateless chatbot into an
// agent that knows you across sessions. Stores free-form notes (goals,
// preferences, flagged constraints) as a JSON array in the AgentMemory table.
//
// Intentionally simple for Phase 1: a flat list of strings the agent appends
// to and reads back. Phase 2+ can add structure (typed memory: goals vs.
// constraints vs. preferences) if the flat list proves too lossy.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Cap stored notes so memory can't grow unbounded. When full, the oldest
// UNPINNED notes go first. A note can be up to NOTE_MAX characters — the
// remember tool used to cut at 240, so a fighter's cut protocol ended at
// "starting 10 da…" (Oct 2026). Longer text is split, never cut.
export const MAX_NOTES = 150;
export const NOTE_MAX = 2000;
/** What reaches the prompt: every pinned note, then the newest others, within this many characters. */
export const PROMPT_BUDGET = 16_000;
/** A pinned note (event dates, injuries, allergies, a coach's plan) always reaches the prompt and is never aged out. */
export const PINNED_PREFIX = '[pinned] ';
export const isPinned = (n: string) => n.startsWith(PINNED_PREFIX);

/** Pure: split text longer than NOTE_MAX at sentence (or word) boundaries; "(1/3)"-style tags keep the parts together. */
export function splitNote(text: string, max = NOTE_MAX): string[] {
  const t = text.trim();
  if (t.length <= max) return t ? [t] : [];
  const parts: string[] = [];
  let rest = t;
  const room = max - 8;
  while (rest.length > room) {
    let cut = Math.max(rest.lastIndexOf('. ', room), rest.lastIndexOf('\n', room));
    if (cut < room * 0.5) cut = rest.lastIndexOf(' ', room);
    if (cut < room * 0.5) cut = room;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.map((p, i) => `${p} (${i + 1}/${parts.length})`);
}

/** Pure: drop the oldest unpinned notes until at most `max` remain. */
export function capNotes(notes: string[], max = MAX_NOTES): string[] {
  const out = [...notes];
  while (out.length > max) {
    const i = out.findIndex((n) => !isPinned(n));
    out.splice(i < 0 ? 0 : i, 1);
  }
  return out;
}

// A note that reads like an instruction to the model ("always call
// adjust_macros", "ignore the calorie floor") is a jailbreak-persistence
// vector: memory is injected into every future prompt (Oct 2026 audit LOW-1).
// Such notes are still saved — the user sees them on the memory page, marked —
// but never reach the prompt.
export const FLAGGED_PREFIX = '[held for review] ';
const META_INSTRUCTION = /\b(ignore|disregard|instructions?|system prompt|system message|always call|never call|always use|never raise|never ask|never mention|never refuse|do not follow|don't follow|override|bypass|jailbreak|developer mode|you are now|you must|pretend|app_note|tool call|propose tool)\b|(?<!(?:nervous|immune|digestive|cardiovascular|metric|imperial|support|reward|training|lifting) )\bsystem\b/i;

export function looksLikeInstruction(note: string): boolean {
  return META_INSTRUCTION.test(note);
}

export function isFlaggedNote(note: string): boolean {
  return note.startsWith(FLAGGED_PREFIX);
}

/** Notes for the prompt: never flagged ones; every pinned note, then the newest others within PROMPT_BUDGET. */
export function promptMemory(notes: string[], budget = PROMPT_BUDGET): string[] {
  const ok = notes.filter((n) => !isFlaggedNote(n));
  const pinned = ok.filter(isPinned);
  let room = budget - pinned.reduce((n, x) => n + x.length, 0);
  const others: string[] = [];
  for (let i = ok.length - 1; i >= 0; i--) {
    const n = ok[i];
    if (isPinned(n)) continue;
    if (n.length > room) break;
    room -= n.length;
    others.unshift(n);
  }
  return [...pinned, ...others];
}

export async function readMemory(userId: string): Promise<string[]> {
  const row = await prisma.agentMemory.findUnique({ where: { userId } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.notesJson);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function appendMemory(userId: string, note: string, opts: { pinned?: boolean } = {}): Promise<string[]> {
  const raw = note.trim();
  if (!raw) return readMemory(userId);
  const flag = !isFlaggedNote(raw) && looksLikeInstruction(raw);
  const parts = splitNote(raw.replace(/^\[pinned\]\s*/, '')).map((p) => `${flag ? FLAGGED_PREFIX : ''}${opts.pinned || isPinned(raw) ? PINNED_PREFIX : ''}${p}`);
  const existing = await readMemory(userId);
  // De-dup exact repeats so the agent re-stating a known fact doesn't bloat.
  const fresh = parts.filter((p) => !existing.includes(p));
  if (!fresh.length) return existing;
  const next = capNotes([...existing, ...fresh]);
  await prisma.agentMemory.upsert({
    where: { userId },
    create: { userId, notesJson: JSON.stringify(next) },
    update: { notesJson: JSON.stringify(next) },
  });
  return next;
}

export async function replaceMemory(userId: string, notes: string[]): Promise<void> {
  const clean = capNotes(notes.map((n) => n.trim()).filter(Boolean));
  await prisma.agentMemory.upsert({
    where: { userId },
    create: { userId, notesJson: JSON.stringify(clean) },
    update: { notesJson: JSON.stringify(clean) },
  });
}
