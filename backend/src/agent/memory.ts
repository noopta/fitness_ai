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
  const trimmed = note.trim();
  if (!trimmed) return readMemory(userId);
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
