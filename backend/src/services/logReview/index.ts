// Log review — running the rules, keeping flags, and the digest card
// (design "Log review 1a", Oct 2026).
//
//   scheduleReview(userId)  after any workout save, edit or delete (debounced)
//   runReview(userId)       detect → store new flags → invalidate stale ones →
//                           one digest per period: new flags join the pending
//                           digest instead of posting a second card
//   applyFlag / keepFlag / undoFlag / applyAll   the card's taps
//   excludedEntries(userId) flagged entries, kept out of e1RM, PRs and volume
//
// Rules for both surfaces: nothing in the log changes without a tap; every
// fix is a reversible AgentChange; every flag states its reason in a sentence.

import { PrismaClient } from '@prisma/client';
import { detect, type Finding, type ReviewLog } from './detect.js';
import { loadCanonicalResolver } from '../liftCanonical.js';
import { cacheDelete } from '../cacheService.js';
import type { ReviewBlock, ReviewRow, ReviewFlagType } from '../../agent/cards/types.js';

const prisma = new PrismaClient();

/** Logs this recent are checked; older ones are the baseline. */
export const REVIEW_WINDOW_DAYS = 14;
const HISTORY_DAYS = 120;
const SHOW_ROWS = 5;

const TYPE_LABEL: Record<ReviewFlagType, string> = {
  duplicate: 'Duplicate', fuzzy_duplicate: 'Likely duplicate', outlier: 'Unusual value',
  conflict: 'Conflict', missing: 'Missing', equipment: 'Equipment',
};

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** "Oct 20–24", "Oct 28–Nov 2", or "Oct 20" for one day. */
export function periodLabel(from: string, to: string): string {
  if (from === to) return shortDate(from);
  const a = shortDate(from), b = shortDate(to);
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a}–${b}`;
}
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function toReviewLog(r: { id: string; date: string; createdAt: Date; title: string | null; duration: number | null; notes: string | null; exercises: string }): ReviewLog {
  let exercises: ReviewLog['exercises'] = [];
  try { const x = JSON.parse(r.exercises); if (Array.isArray(x)) exercises = x; } catch { /* unreadable row: nothing to check */ }
  return { id: r.id, date: r.date, createdAt: r.createdAt, title: r.title, duration: r.duration, notes: r.notes, exercises };
}

// ── Exclusion: flagged entries stay out of e1RM, PR and volume until resolved ──

/** "<logId>" (whole log) or "<logId>#<index>" entries under a pending flag. */
export async function excludedEntries(userId: string): Promise<Set<string>> {
  // No LogFlag table (a client generated before it, a test double): nothing is excluded.
  let rows: unknown[] = [];
  try { rows = await (prisma as any).logFlag?.findMany({ where: { userId, status: 'pending' }, select: { entryIds: true, type: true } }) ?? []; } catch { rows = []; }
  const out = new Set<string>();
  for (const r of rows as { entryIds: string; type: string }[]) {
    let ids: string[] = [];
    try { ids = JSON.parse(r.entryIds); } catch { continue; }
    // A duplicate's first copy is the real session; only the copies sit out.
    const drop = r.type === 'duplicate' ? ids.slice(1) : r.type === 'conflict' ? ids.slice(0, -1) : ids;
    for (const id of drop) out.add(id);
  }
  return out;
}

/** Pure: a log's exercises with flagged and estimated entries removed (for e1RM / PR / volume). */
export function countableExercises<T extends { estimated?: boolean | null }>(logId: string, exercises: T[], excluded: Set<string>): T[] {
  if (excluded.has(logId)) return [];
  return exercises.filter((e, i) => !excluded.has(`${logId}#${i}`) && !e?.estimated);
}

// ── Running the review ─────────────────────────────────────────────────────────

const timers = new Map<string, NodeJS.Timeout>();
/** After a save, edit or delete: one review per burst of changes (a correction often follows a log). */
export function scheduleReview(userId: string, delayMs = 20_000): void {
  if (process.env.LOG_REVIEW_ENABLED === '0' || process.env.VITEST) return;
  const t = timers.get(userId);
  if (t) clearTimeout(t);
  timers.set(userId, setTimeout(() => {
    timers.delete(userId);
    runReview(userId).catch((err) => console.error('[log-review] run failed:', err?.message ?? err));
  }, delayMs).unref());
}

export interface ReviewResult { found: number; added: number; invalidated: number; digestId: string | null }

export async function runReview(userId: string, now = new Date()): Promise<ReviewResult> {
  const today = now.toISOString().slice(0, 10);
  const from = addDays(today, -REVIEW_WINDOW_DAYS);
  const [user, rows, flags] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, weightKg: true } }),
    prisma.workoutLog.findMany({ where: { userId, date: { gte: addDays(today, -HISTORY_DAYS) } }, orderBy: { date: 'desc' }, take: 400, select: { id: true, date: true, createdAt: true, title: true, duration: true, notes: true, exercises: true } }),
    (prisma as any).logFlag.findMany({ where: { userId }, select: { id: true, ruleKey: true, status: true, digestId: true, entryDate: true } }) as Promise<{ id: string; ruleKey: string; status: string; digestId: string | null; entryDate: string }[]>,
  ]);
  const logs = rows.map(toReviewLog);
  const recent = logs.filter((l) => l.date >= from);
  const history = logs.filter((l) => l.date < from);
  const { key } = await loadCanonicalResolver(prisma, logs.flatMap((l) => l.exercises.map((e) => e.name)));
  // Kept as is = suppressed for good; a fuzzy-name keep also suppresses that alias pair.
  const suppressed = new Set(flags.filter((f) => f.status === 'dismissed').map((f) => f.ruleKey));
  const findings = detect({ recent, history, key, unit: user?.unitPreference === 'metric' ? 'metric' : 'imperial', bodyweightKg: user?.weightKg ?? null, suppressed });

  // Invalidated: a pending flag in the window whose rule no longer triggers
  // (the user edited or deleted the entry elsewhere) disappears silently.
  const live = new Set(findings.map((f) => f.ruleKey));
  const stale = flags.filter((f) => f.status === 'pending' && f.entryDate >= from && !live.has(f.ruleKey));
  if (stale.length) await (prisma as any).logFlag.updateMany({ where: { id: { in: stale.map((f) => f.id) } }, data: { status: 'invalidated', resolvedAt: now } });

  // New: never re-raise a rule that's pending, applied or kept.
  const known = new Set(flags.filter((f) => f.status !== 'invalidated').map((f) => f.ruleKey));
  const fresh = findings.filter((f) => !known.has(f.ruleKey));

  let digestId = flags.find((f) => f.status === 'pending' && f.digestId && !stale.some((s) => s.id === f.id))?.digestId ?? null;
  if (fresh.length) {
    await (prisma as any).logFlag.createMany({ data: fresh.map((f) => toRow(userId, f, digestId)) });
  }
  if (fresh.length || stale.length) {
    if (digestId) await renderDigest(userId, digestId);
    else if (fresh.length) digestId = await postDigest(userId, fresh);
    invalidateStrength(userId);
  }
  return { found: findings.length, added: fresh.length, invalidated: stale.length, digestId };
}

function toRow(userId: string, f: Finding, digestId: string | null) {
  return {
    userId, digestId, type: f.type, ruleKey: f.ruleKey, entryIds: JSON.stringify(f.entryIds), confidence: f.confidence,
    reason: f.reason, impact: f.impact ?? null, title: f.title, fix: f.fix, before: f.before, after: f.after,
    doneLabel: f.doneLabel, suggestion: JSON.stringify(f.suggestion), entryDate: f.entryDate,
  };
}

function invalidateStrength(userId: string) {
  cacheDelete(`strength:profile:${userId}`);
  cacheDelete(`userctx:${userId}`);
}

// ── The digest card ────────────────────────────────────────────────────────────

/** Anakin's intro: says nothing has been changed, names what kinds were found. */
export function introText(types: ReviewFlagType[]): string {
  const n = types.length;
  const kinds = [...new Set(types)].map((t) => ({ duplicate: 'duplicates', fuzzy_duplicate: 'a lift under two names', outlier: 'an odd weight', conflict: 'a session saved in more than one version', missing: 'a gap', equipment: 'machine numbers logged as free weights' }[t]));
  const list = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0];
  return `${n === 1 ? 'One entry doesn’t' : `${n} entries don’t`} look right — ${list}. I haven’t changed anything. Review below before I recalculate your strength numbers.`;
}

async function postDigest(userId: string, findings: Finding[]): Promise<string> {
  const { saveCard } = await import('../../agent/cards/store.js');
  const { appendInitiated } = await import('../../agent/conversation.js');
  const { cardRef } = await import('../../agent/cardNotes.js');
  const card = await saveCard(userId, { fn: 'LOG-01', pattern: 'review', rule: 'show', meta: { label: 'Log check' } } as any);
  await (prisma as any).logFlag.updateMany({ where: { userId, status: 'pending', digestId: null }, data: { digestId: card.id } });
  const rendered = await renderDigest(userId, card.id);
  await appendInitiated(userId, introText(findings.map((f) => f.type)), [cardRef(rendered)]);
  return card.id;
}

/** Pure: the digest card's review block from its flags (pending first by confidence, then newest). */
export function reviewBlock(flags: FlagRow[], cap = SHOW_ROWS): ReviewBlock {
  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const visible = flags.filter((f) => f.status !== 'invalidated');
  const ordered = [...visible].sort((a, b) =>
    Number(a.status !== 'pending') - Number(b.status !== 'pending')
    || (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3)
    || b.entryDate.localeCompare(a.entryDate));
  const dates = visible.map((f) => f.entryDate).sort();
  const period = dates.length ? periodLabel(dates[0], dates[dates.length - 1]) : '';
  const rows: ReviewRow[] = ordered.slice(0, cap).map((f) => ({
    id: f.id, type: f.type as ReviewFlagType, typeLabel: TYPE_LABEL[f.type as ReviewFlagType] ?? 'Check',
    date: dayLabel(f.entryDate), title: f.title, fix: f.fix, before: f.before, after: f.after, why: f.reason,
    confidence: f.confidence as ReviewRow['confidence'], ...(f.impact ? { impact: f.impact } : {}),
    status: f.status === 'applied' ? 'applied' : f.status === 'dismissed' ? 'dismissed' : 'pending', doneLabel: f.doneLabel,
  }));
  return { period, pending: visible.filter((f) => f.status === 'pending').length, rows, ...(ordered.length > cap ? { hiddenCount: ordered.length - cap } : {}) };
}

export interface FlagRow { id: string; type: string; status: string; confidence: string; entryDate: string; title: string; fix: string; before: string; after: string; reason: string; impact: string | null; doneLabel: string }

/** Rebuild the stored digest card from its flags (after detection or any tap). */
export async function renderDigest(userId: string, digestId: string, opts: { showAll?: boolean } = {}) {
  const flags = await (prisma as any).logFlag.findMany({ where: { userId, digestId } }) as FlagRow[];
  const row = await prisma.agentCard.findFirst({ where: { id: digestId, userId } });
  if (!row) throw new Error('That review card is gone.');
  const card = JSON.parse(row.payloadJson);
  const review = reviewBlock(flags, opts.showAll ? Infinity : SHOW_ROWS);
  card.review = review;
  card.meta = { label: `Log check${review.period ? ` · ${review.period}` : ''}` };
  card.state = { status: review.pending ? 'live' : 'answered', ...(review.pending ? {} : { line: 'Reviewed' }) };
  await prisma.agentCard.update({ where: { id: digestId }, data: { payloadJson: JSON.stringify(card), status: card.state.status } });
  return card;
}
// ── Taps: apply, keep, undo, apply all ────────────────────────────────────────

export class ReviewError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function loadFlag(userId: string, flagId: string) {
  const f = await (prisma as any).logFlag.findFirst({ where: { id: flagId, userId } });
  if (!f) throw new ReviewError('That review item is no longer available.', 404);
  return f;
}

/** Apply one flag's suggested fix as one reversible change. */
export async function applyFlag(userId: string, flagId: string, via: 'row' | 'apply_all' = 'row') {
  const f = await loadFlag(userId, flagId);
  if (f.status !== 'pending') throw new ReviewError(f.status === 'applied' ? 'Already fixed.' : 'Already resolved.', 409);
  await import('../../agent/toolkits/logReview.js'); // registers the logflag ops
  const { executeOp } = await import('../../agent/ops.js');
  const change = await executeOp(userId, 'logflag.apply', { flagId, via });
  await (prisma as any).logFlag.update({ where: { id: flagId }, data: { changeId: change.changeId } });
  return afterTap(userId, f.digestId);
}

/** Keep as is: dismissed, and the same rule on the same entries never comes back. */
export async function keepFlag(userId: string, flagId: string) {
  const f = await loadFlag(userId, flagId);
  if (f.status !== 'pending') throw new ReviewError('Already resolved.', 409);
  await import('../../agent/toolkits/logReview.js');
  const { executeOp } = await import('../../agent/ops.js');
  const change = await executeOp(userId, 'logflag.keep', { flagId });
  await (prisma as any).logFlag.update({ where: { id: flagId }, data: { changeId: change.changeId } });
  return afterTap(userId, f.digestId);
}

/** Undo: revert the change and return the flag to pending. */
export async function undoFlag(userId: string, flagId: string) {
  const f = await loadFlag(userId, flagId);
  if (f.status === 'pending' || !f.changeId) throw new ReviewError('Nothing to undo.', 409);
  const { revertChange } = await import('../../agent/ops.js');
  await revertChange(userId, f.changeId, { ignoreWindow: true });
  return afterTap(userId, f.digestId, { reopened: true });
}

/** Apply every pending flag on the digest (low-confidence ones included — the label says so). */
export async function applyAll(userId: string, digestId: string) {
  const pending = await (prisma as any).logFlag.findMany({ where: { userId, digestId, status: 'pending' }, select: { id: true } }) as { id: string }[];
  for (const p of pending) {
    try { await applyFlag(userId, p.id, 'apply_all'); } catch (err: any) { if (!(err instanceof ReviewError)) throw err; }
  }
  return afterTap(userId, digestId);
}

async function afterTap(userId: string, digestId: string | null, opts: { reopened?: boolean } = {}) {
  invalidateStrength(userId);
  if (!digestId) return null;
  const before = await prisma.agentCard.findFirst({ where: { id: digestId, userId }, select: { status: true } });
  const card = await renderDigest(userId, digestId);
  // All resolved: Anakin posts the follow-up once (counts, then the resulting e1RM).
  if (!card.review.pending && before?.status === 'live' && !opts.reopened) await postFollowUp(userId, digestId).catch((err) => console.error('[log-review] follow-up failed:', err?.message ?? err));
  if (!card.review.pending) await (await import('../awayDigest.js')).resolveNeedsYou(userId, digestId).catch(() => {});
  return card;
}

export function followUpText(corrected: number, kept: number, strength: string | null): string {
  const parts = [corrected ? `${corrected} corrected` : null, kept ? `${kept} kept as is` : null].filter(Boolean).join(', ');
  return `All reviewed — ${parts}.${strength ? ` ${strength}` : ''}`;
}

async function postFollowUp(userId: string, digestId: string) {
  const flags = await (prisma as any).logFlag.findMany({ where: { userId, digestId } }) as FlagRow[];
  const corrected = flags.filter((f) => f.status === 'applied').length;
  const kept = flags.filter((f) => f.status === 'dismissed').length;
  let strength: string | null = null;
  try {
    const { getStrengthProfileCached } = await import('../../routes/strength.js');
    const p: any = await getStrengthProfileCached(userId);
    const top = (p?.lifts ?? []).filter((l: any) => l.current1RM > 0).sort((a: any, b: any) => (b.sessionCount ?? 0) - (a.sessionCount ?? 0))[0];
    if (top) strength = `Your ${top.canonicalName} estimated max is now ${Math.round(top.current1RM)} ${p.unit ?? 'lb'}.`;
  } catch { /* the counts alone are fine */ }
  const { appendInitiated } = await import('../../agent/conversation.js');
  await appendInitiated(userId, followUpText(corrected, kept, strength));
}

/** Show every row (the "Show N more" tap). */
export async function expandDigest(userId: string, digestId: string) {
  return renderDigest(userId, digestId, { showAll: true });
}
