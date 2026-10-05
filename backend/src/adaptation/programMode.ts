// Program ↔ freestyle (contract 4).
//
//   goFreestyle     archive savedProgram as a CompletedProgram (reason
//                   'freestyle') and clear savedProgram / programStartDate /
//                   splitLabel — the user logs as they go from here.
//   restoreProgram  bring back the most recent 'freestyle' archive, resuming
//                   at the week they left (start date shifted by the time
//                   spent in the program), then drop that archive row — the
//                   program is live again, not finished.
//
// Both are explicit user taps; nothing here runs on its own.

import { PrismaClient } from '@prisma/client';
import { archiveProgram } from '../services/completedProgramService.js';
import { deriveSplitLabel } from '../services/trainTogetherService.js';
import { parseSavedProgram } from '../services/programPhaseService.js';
import { cacheDelete, cacheClearByPrefix } from '../services/cacheService.js';

const prisma = new PrismaClient();

export const FREESTYLE_REASON = 'freestyle';

function invalidate(userId: string) {
  cacheDelete(`program:${userId}`);
  cacheClearByPrefix(`today:${userId}:`);
  cacheClearByPrefix(`schedule:${userId}:`);
  cacheClearByPrefix(`dashboard:${userId}:`);
  cacheClearByPrefix(`brief:${userId}:`);
  cacheDelete(`userctx:${userId}`);
}

export class ProgramModeError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function goFreestyle(userId: string): Promise<{ ok: true; archivedId: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, programStartDate: true } });
  if (!user) throw new ProgramModeError('User not found', 404);
  if (!parseSavedProgram(user.savedProgram ?? null)) throw new ProgramModeError('No program to set aside', 409);
  // The archive's reason is the only marker restore looks for.
  const archived = await archiveProgram(userId, user.savedProgram ?? null, user.programStartDate ?? null, FREESTYLE_REASON);
  if (!archived) throw new ProgramModeError('Could not archive the program', 409);
  await prisma.user.update({ where: { id: userId }, data: { savedProgram: null, programStartDate: null, splitLabel: null } });
  invalidate(userId);
  return { ok: true, archivedId: archived.id };
}

export async function restoreProgram(userId: string, now = new Date()): Promise<{ ok: true; restoredId: string }> {
  const row = await prisma.completedProgram.findFirst({
    where: { userId, reason: FREESTYLE_REASON },
    orderBy: { endDate: 'desc' },
  });
  if (!row) throw new ProgramModeError('Nothing to restore', 404);
  const program = parseSavedProgram(row.programJson);
  if (!program) throw new ProgramModeError('Archived program is unreadable', 404);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, programStartDate: true } });
  // A program made since going freestyle is archived, not lost.
  if (user?.savedProgram && parseSavedProgram(user.savedProgram)) {
    try { await archiveProgram(userId, user.savedProgram, user.programStartDate ?? null, 'replaced'); }
    catch (err: any) { console.error('[program-mode] archive current program failed:', err?.message ?? err); }
  }
  const elapsed = Math.max(0, new Date(row.endDate).getTime() - new Date(row.startDate).getTime());
  const programStartDate = new Date(now.getTime() - elapsed);
  await prisma.user.update({
    where: { id: userId },
    data: { savedProgram: row.programJson, programStartDate, splitLabel: deriveSplitLabel(program) },
  });
  await prisma.completedProgram.delete({ where: { id: row.id } });
  invalidate(userId);
  return { ok: true, restoredId: row.id };
}
