// Operations: every mutation Anakin can cause, each with its own inverse.
//
// Tools never write directly. A Log/Set tool runs an op at once (the user
// stated a fact or asked for a setting); a Proposal/Draft/Confirm tool only
// stores a pending op on its card, and POST /cards/:id/action runs it on the
// user's tap. Either way executeOp records an AgentChange with the op that
// reverses it, which is what makes Undo — and "undo what you changed
// yesterday" — work. The write guard makes the rule structural: a propose-
// kind tool that tried to call executeOp throws.

import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface OpOutcome {
  /** What the op produced (row, new value…); returned to the caller. */
  result?: unknown;
  /** How to reverse it; null = irreversible (account deletion, sent message). */
  inverse: { op: string; args: Record<string, unknown> } | null;
  /** One line for the change log and receipts: "Units · lb → kg". */
  summary: string;
}
export interface Op {
  name: string;
  /** Undo window in ms for cards (24 h logs/settings, 30 s deletes). */
  undoMs?: number;
  run: (userId: string, args: Record<string, unknown>) => Promise<OpOutcome>;
}

const OPS = new Map<string, Op>();
export function defineOp(op: Op): Op {
  if (OPS.has(op.name)) throw new Error(`Duplicate op ${op.name}`);
  OPS.set(op.name, op);
  return op;
}
export function getOp(name: string): Op | undefined { return OPS.get(name); }
export function listOps(): string[] { return [...OPS.keys()].sort(); }

export const HOUR = 60 * 60 * 1000;
export const UNDO_LOG_MS = 24 * HOUR;
export const UNDO_DELETE_MS = 30 * 1000;

// ── Write guard ──────────────────────────────────────────────────────────────
// 'deny' is set while a propose/draft/confirm/read tool runs, so those tools
// can prepare a pending op but cannot perform one.
const guard = new AsyncLocalStorage<{ writes: 'allow' | 'deny'; tool?: string }>();
export function withWriteGuard<T>(writes: 'allow' | 'deny', tool: string, fn: () => Promise<T>): Promise<T> {
  return guard.run({ writes, tool }, fn);
}
export class WriteNotAllowedError extends Error {
  constructor(tool?: string) { super(`${tool ?? 'This tool'} can only propose a change; the user applies it from the card.`); }
}

export interface ExecutedChange {
  changeId: string;
  summary: string;
  undoUntil: string | null;
  result: unknown;
  reversible: boolean;
}

/** Run an op and record it in the change log. */
export async function executeOp(
  userId: string,
  name: string,
  args: Record<string, unknown>,
  opts: { cardId?: string | null; undoMs?: number } = {},
): Promise<ExecutedChange> {
  const ctx = guard.getStore();
  if (ctx?.writes === 'deny') throw new WriteNotAllowedError(ctx.tool);
  const op = OPS.get(name);
  if (!op) throw new Error(`Unknown operation: ${name}`);
  const out = await op.run(userId, args);
  const undoMs = out.inverse ? (opts.undoMs ?? op.undoMs ?? UNDO_LOG_MS) : 0;
  const undoUntil = out.inverse ? new Date(Date.now() + undoMs) : null;
  const change = await prisma.agentChange.create({
    data: {
      userId,
      cardId: opts.cardId ?? null,
      op: name,
      argsJson: JSON.stringify(args ?? {}),
      inverseJson: out.inverse ? JSON.stringify(out.inverse) : null,
      summary: out.summary.slice(0, 300),
      undoUntil,
    },
  });
  return { changeId: change.id, summary: out.summary, undoUntil: undoUntil?.toISOString() ?? null, result: out.result, reversible: !!out.inverse };
}

export class UndoError extends Error {}

/**
 * Reverse a recorded change. Cards respect the undo window; a request typed
 * in chat ("undo that") passes ignoreWindow — the change log still knows how.
 */
export async function revertChange(userId: string, changeId: string, opts: { ignoreWindow?: boolean } = {}) {
  const change = await prisma.agentChange.findFirst({ where: { id: changeId, userId } });
  if (!change) throw new UndoError('That change isn’t in your history.');
  if (change.status === 'reverted') return { alreadyReverted: true, summary: change.summary };
  if (!change.inverseJson) throw new UndoError('That one can’t be undone.');
  if (!opts.ignoreWindow && change.undoUntil && change.undoUntil.getTime() < Date.now()) {
    throw new UndoError('The undo window has passed. Ask me to undo it and I’ll reverse it from your history.');
  }
  const inverse = JSON.parse(change.inverseJson) as { op: string; args: Record<string, unknown> };
  const op = OPS.get(inverse.op);
  if (!op) throw new UndoError(`Can’t reverse ${change.op}.`);
  await guard.run({ writes: 'allow', tool: 'undo' }, () => op.run(userId, inverse.args));
  await prisma.agentChange.update({ where: { id: change.id }, data: { status: 'reverted', revertedAt: new Date() } });
  return { alreadyReverted: false, summary: change.summary, cardId: change.cardId };
}

export async function listChanges(userId: string, limit = 20) {
  const rows = await prisma.agentChange.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
  return rows.map((c) => ({
    id: c.id, summary: c.summary, op: c.op, status: c.status, at: c.createdAt.toISOString(),
    reversible: !!c.inverseJson, undoUntil: c.undoUntil?.toISOString() ?? null, cardId: c.cardId,
  }));
}
