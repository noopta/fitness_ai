// Long-term agent memory — the layer that turns a stateless chatbot into an
// agent that knows you across sessions. Stores free-form notes (goals,
// preferences, flagged constraints) as a JSON array in the AgentMemory table.
//
// Intentionally simple for Phase 1: a flat list of strings the agent appends
// to and reads back. Phase 2+ can add structure (typed memory: goals vs.
// constraints vs. preferences) if the flat list proves too lossy.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Cap stored notes so memory can't grow unbounded and blow the context
// budget. When full, oldest notes are dropped (FIFO) — recent context tends
// to matter more, and the agent can always re-derive stale facts from data.
const MAX_NOTES = 40;

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

/** Notes safe to put in the prompt (flagged ones are for the user's eyes only). */
export function promptMemory(notes: string[]): string[] {
  return notes.filter((n) => !isFlaggedNote(n));
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

export async function appendMemory(userId: string, note: string): Promise<string[]> {
  const raw = note.trim();
  if (!raw) return readMemory(userId);
  const trimmed = !isFlaggedNote(raw) && looksLikeInstruction(raw) ? `${FLAGGED_PREFIX}${raw}` : raw;
  const existing = await readMemory(userId);
  // De-dup exact repeats so the agent re-stating a known fact doesn't bloat.
  if (existing.includes(trimmed)) return existing;
  const next = [...existing, trimmed].slice(-MAX_NOTES);
  await prisma.agentMemory.upsert({
    where: { userId },
    create: { userId, notesJson: JSON.stringify(next) },
    update: { notesJson: JSON.stringify(next) },
  });
  return next;
}

export async function replaceMemory(userId: string, notes: string[]): Promise<void> {
  const clean = notes.map((n) => n.trim()).filter(Boolean).slice(-MAX_NOTES);
  await prisma.agentMemory.upsert({
    where: { userId },
    create: { userId, notesJson: JSON.stringify(clean) },
    update: { notesJson: JSON.stringify(clean) },
  });
}
