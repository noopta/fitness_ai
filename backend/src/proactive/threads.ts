// "Working on" — the open-thread ledger (design flow C). A thread is one
// thing Anakin is keeping track of for a user: an event, a symptom, an
// experiment, a question, a goal. Each carries the user's own words as its
// source (mandatory — it's why people trust the extractor), a check-back
// date, and a history. Threads outlive the chat transcript (pruned at 90
// days), which is what makes "you said 'got a fight coming up' on Oct 12"
// possible in December.
//
// Pure parts (merge, due, rows, countdown) are tested without Prisma; the
// extractor asks the model for candidates and keeps only those whose quote
// is really in the transcript.

import { PrismaClient } from '@prisma/client';
import { loadStoredMessages, stripAppNotes } from '../agent/conversation.js';
import { parseBlob, mergeBlobKeys } from '../agent/profile/coachProfile.js';
import { proactiveAvailableFor } from '../services/featureFlags.js';

const prisma = new PrismaClient();

export type ThreadKind = 'event' | 'experiment' | 'symptom' | 'question' | 'goal';
export type ThreadStatus = 'open' | 'watching' | 'running' | 'resolved' | 'closed' | 'wrong';
export const THREAD_KINDS: ThreadKind[] = ['event', 'experiment', 'symptom', 'question', 'goal'];
export const KIND_LABEL: Record<ThreadKind, string> = { event: 'Event', experiment: 'Experiment', symptom: 'Symptom', question: 'Question', goal: 'Goal' };
export const STATUS_WORD: Record<ThreadStatus, string> = { open: 'Open', watching: 'Watching', running: 'Running', resolved: 'Resolved', closed: 'Closed', wrong: 'Removed' };
const OPEN_STATUSES: ThreadStatus[] = ['open', 'watching', 'running'];

export interface ThreadRow {
  id: string; userId: string; kind: string; title: string; status: string;
  sourceQuote: string | null; sourceAt: Date | null; sourceRole: string | null; read: string | null;
  checkBackAt: string | null; eventDate: string | null; affectsJson: string; metricJson: string | null; historyJson: string;
  raisedCount: number; ignoredCount: number; lastRaisedAt: Date | null; mutedUntil: Date | null;
  resolution: string | null; resolvedAt: Date | null; createdAt: Date; updatedAt: Date;
}

export interface ExtractedThread {
  kind: ThreadKind;
  title: string;
  /** Verbatim words from the transcript. Dropped when they aren't there. */
  sourceQuote: string;
  read?: string | null;
  checkBackAt?: string | null;
  eventDate?: string | null;
  affects?: string[];
}

export const parseList = (raw: string | null | undefined): string[] => { try { const p = JSON.parse(raw ?? '[]'); return Array.isArray(p) ? p.map(String) : []; } catch { return []; } };
export const isOpen = (t: Pick<ThreadRow, 'status'>) => OPEN_STATUSES.includes(t.status as ThreadStatus);

const DAY = 86_400_000;
export function addDays(date: string, n: number): string { return new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10); }
/** Days from today to the date (23 for a fight 23 days out). Negative once past. */
export function countdown(eventDate: string, today: string): number { return Math.round((Date.parse(`${eventDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY); }
export const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
/** Token Jaccard — "left elbow on heavy rows" vs "elbow on rows" merge; "knee clicking" doesn't. */
export function titleSimilarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
export const SAME_THREAD = 0.5;

const APP_SUPPORT = /\b(share|sharing|screenshot|snap|photo|camera|username|password|log ?in|sign ?in|sign ?up|account|billing|subscription|app|screen|button|tab|bug|crash|export|intake|onboarding|notification|update the app)\b/i;
const SESSION_WORDS = /\b(workout|session|day|push|pull|legs?|arms?|shoulders?|chest|back|upper|lower|full[- ]body)\b/i;
/**
 * Pure: should an extracted candidate become a thread? Drops app-support
 * questions, a planned session filed as an event, dates in the past, and
 * old unanswered questions (the silent test, 31 Oct 2026).
 */
export function acceptExtracted(e: ExtractedThread, today: string, sourceAt?: string | null): boolean {
  if (e.kind === 'question' && APP_SUPPORT.test(e.title)) return false;
  if (e.kind === 'event' && (!e.eventDate || e.eventDate < today || SESSION_WORDS.test(e.title) && !/\b(fight|meet|race|comp|competition|wedding|trip|match|tournament|marathon|game)\b/i.test(e.title))) return false;
  if (e.checkBackAt && e.checkBackAt < today) return false;
  if ((e.kind === 'question' || e.kind === 'goal') && !e.checkBackAt && sourceAt && sourceAt.slice(0, 10) < addDays(today, -14)) return false;
  return true;
}

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ses|s)$/, '');
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).map(stem).filter((w) => w.length >= 3 && !['the', 'and', 'with', 'bar', 'heavy', 'light', 'left', 'right'].includes(w));
/** Does a thread's "affects" list touch this exercise? Word-based and plural-insensitive: "rows" touches "Chest-supported row". */
export function exerciseTouches(affects: string[], exercise: string): boolean {
  const e = new Set(tokens(exercise));
  if (!e.size) return false;
  return affects.some((a) => { const t = tokens(a); return t.length > 0 && t.some((w) => e.has(w)); });
}

const squash = (s: string) => s.toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
/** The quote must be in the user's (or coach's) actual words — case/whitespace/quote-mark insensitive. */
export function quoteInTranscript(quote: string, transcript: string[]): boolean {
  const q = squash(quote);
  return q.length >= 6 && transcript.some((m) => squash(m).includes(q));
}

/** Pure: which extracted candidates are new, and which update an existing open thread. */
export function mergeExtracted(existing: Pick<ThreadRow, 'id' | 'kind' | 'title' | 'status'>[], extracted: ExtractedThread[], transcript: string[], today?: string, sourceAtOf?: (quote: string) => string | null): { create: ExtractedThread[]; update: { id: string; patch: Partial<ExtractedThread> }[] } {
  const create: ExtractedThread[] = [];
  const update: { id: string; patch: Partial<ExtractedThread> }[] = [];
  const open = existing.filter(isOpen);
  for (const e of extracted) {
    if (!THREAD_KINDS.includes(e.kind) || !e.title?.trim() || !e.sourceQuote?.trim()) continue;
    if (!quoteInTranscript(e.sourceQuote, transcript)) continue;
    if (today && !acceptExtracted(e, today, sourceAtOf?.(e.sourceQuote) ?? null)) continue;
    const match = open.find((t) => t.kind === e.kind && titleSimilarity(t.title, e.title) >= SAME_THREAD)
      ?? open.find((t) => titleSimilarity(t.title, e.title) >= 0.75);
    if (match) {
      const patch: Partial<ExtractedThread> = {};
      if (e.read) patch.read = e.read;
      if (e.checkBackAt) patch.checkBackAt = e.checkBackAt;
      if (e.eventDate) patch.eventDate = e.eventDate;
      if (e.affects?.length) patch.affects = e.affects;
      update.push({ id: match.id, patch });
    } else if (!create.some((c) => titleSimilarity(c.title, e.title) >= SAME_THREAD)) {
      create.push(e);
    }
  }
  return { create, update };
}

/** Pure: open threads whose check-back has come (and that aren't muted). */
export function dueThreads<T extends Pick<ThreadRow, 'status' | 'checkBackAt' | 'mutedUntil'>>(threads: T[], today: string, now = new Date()): T[] {
  return threads.filter((t) => isOpen(t) && !!t.checkBackAt && t.checkBackAt <= today && !(t.mutedUntil && t.mutedUntil.getTime() > now.getTime()));
}

export interface WorkingOnRow { id: string; title: string; sub: string; value: string | null; big: boolean; kind: string; status: string }

/** Pure: C1 rows — type in the sub, the next check-back as the value; an event takes the big numeral. */
export function threadRows(threads: ThreadRow[], today: string): { open: WorkingOnRow[]; closed: WorkingOnRow[] } {
  const row = (t: ThreadRow): WorkingOnRow => {
    const kind = (t.kind in KIND_LABEL ? KIND_LABEL[t.kind as ThreadKind] : t.kind);
    if (!isOpen(t)) return { id: t.id, title: t.title, sub: t.resolution ? `${STATUS_WORD[t.status as ThreadStatus] ?? t.status} · ${t.resolution}` : (STATUS_WORD[t.status as ThreadStatus] ?? t.status), value: t.resolvedAt ? shortDate(t.resolvedAt.toISOString().slice(0, 10)) : null, big: false, kind: t.kind, status: t.status };
    if (t.kind === 'event' && t.eventDate) {
      const n = countdown(t.eventDate, today);
      return { id: t.id, title: t.title, sub: `${kind}${t.read ? ` · ${t.read}` : ''}`, value: n >= 0 ? `${n}d` : 'Past', big: true, kind: t.kind, status: t.status };
    }
    const detail = t.kind === 'question' && t.sourceAt ? `you asked ${shortDate(t.sourceAt.toISOString().slice(0, 10))}` : (t.read ?? STATUS_WORD[t.status as ThreadStatus] ?? t.status);
    return { id: t.id, title: t.title, sub: `${kind} · ${detail}`, value: t.checkBackAt ? shortDate(t.checkBackAt) : null, big: false, kind: t.kind, status: t.status };
  };
  // Events first (soonest), then by check-back; muted threads sink to the bottom.
  const rank = (t: ThreadRow) => `${t.mutedUntil && t.mutedUntil.getTime() > Date.now() ? 1 : 0}${t.kind === 'event' ? 0 : 1}${t.kind === 'event' ? (t.eventDate ?? '9999') : (t.checkBackAt ?? t.eventDate ?? '9999')}`;
  const sorted = [...threads].sort((a, b) => rank(a).localeCompare(rank(b)));
  return {
    open: sorted.filter(isOpen).map(row),
    closed: [...threads].filter((t) => !isOpen(t) && t.status !== 'wrong').sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0)).map(row),
  };
}

// ── DB ──────────────────────────────────────────────────────────────────────

export async function listThreads(userId: string): Promise<ThreadRow[]> {
  return prisma.agentThread.findMany({ where: { userId, status: { not: 'wrong' } }, orderBy: { createdAt: 'desc' } }) as any;
}
export async function openThreads(userId: string): Promise<ThreadRow[]> {
  return prisma.agentThread.findMany({ where: { userId, status: { in: OPEN_STATUSES } }, orderBy: { createdAt: 'asc' } }) as any;
}
export async function getThread(userId: string, id: string): Promise<ThreadRow | null> {
  const t = await prisma.agentThread.findFirst({ where: { id, userId } });
  return (t as any) ?? null;
}

export async function appendHistory(id: string, text: string, now = new Date()): Promise<void> {
  const t = await prisma.agentThread.findUnique({ where: { id }, select: { historyJson: true } });
  if (!t) return;
  const h = (() => { try { const p = JSON.parse(t.historyJson); return Array.isArray(p) ? p : []; } catch { return []; } })();
  h.push({ at: now.toISOString(), text: text.slice(0, 200) });
  await prisma.agentThread.update({ where: { id }, data: { historyJson: JSON.stringify(h.slice(-40)) } });
}

export async function createThread(userId: string, e: ExtractedThread & { sourceAt?: Date | null; sourceRole?: string | null; status?: ThreadStatus; metric?: Record<string, unknown> | null }, now = new Date()): Promise<ThreadRow> {
  const status: ThreadStatus = e.status ?? (e.kind === 'symptom' ? 'watching' : e.kind === 'experiment' ? 'running' : 'open');
  const row = await prisma.agentThread.create({ data: {
    userId, kind: e.kind, title: e.title.trim().slice(0, 80), status,
    sourceQuote: e.sourceQuote?.trim().slice(0, 300) ?? null, sourceAt: e.sourceAt ?? now, sourceRole: e.sourceRole ?? 'user',
    read: e.read?.slice(0, 200) ?? null, checkBackAt: e.checkBackAt ?? null, eventDate: e.eventDate ?? null,
    affectsJson: JSON.stringify(e.affects ?? []), metricJson: e.metric ? JSON.stringify(e.metric) : null,
    historyJson: JSON.stringify([{ at: now.toISOString(), text: 'Thread opened from chat' }]),
  } });
  return row as any;
}

export async function updateThread(userId: string, id: string, patch: { title?: string; read?: string | null; checkBackAt?: string | null; eventDate?: string | null; affects?: string[]; status?: ThreadStatus; mutedUntil?: Date | null; metric?: Record<string, unknown> | null }): Promise<ThreadRow | null> {
  const t = await getThread(userId, id);
  if (!t) return null;
  const data: any = {};
  if (patch.title) data.title = patch.title.trim().slice(0, 80);
  if (patch.read !== undefined) data.read = patch.read?.slice(0, 200) ?? null;
  if (patch.checkBackAt !== undefined) data.checkBackAt = patch.checkBackAt;
  if (patch.eventDate !== undefined) data.eventDate = patch.eventDate;
  if (patch.affects) data.affectsJson = JSON.stringify(patch.affects);
  if (patch.status) data.status = patch.status;
  if (patch.mutedUntil !== undefined) data.mutedUntil = patch.mutedUntil;
  if (patch.metric !== undefined) data.metricJson = patch.metric ? JSON.stringify(patch.metric) : null;
  return prisma.agentThread.update({ where: { id }, data }) as any;
}

/** "Mark resolved" / Keep / a safety follow-up closed: the row moves to CLOSED with its one-line resolution. */
export async function resolveThread(userId: string, id: string, resolution: string, status: 'resolved' | 'closed' = 'resolved', now = new Date()): Promise<ThreadRow | null> {
  const t = await getThread(userId, id);
  if (!t) return null;
  await appendHistory(id, resolution, now);
  return prisma.agentThread.update({ where: { id }, data: { status, resolution: resolution.slice(0, 120), resolvedAt: now } }) as any;
}

/** "That's wrong" deletes the thread from view and logs a negative example for the extractor. */
export async function markWrong(userId: string, id: string, now = new Date()): Promise<boolean> {
  const t = await getThread(userId, id);
  if (!t) return false;
  await prisma.agentThread.update({ where: { id }, data: { status: 'wrong', resolvedAt: now, resolution: 'Marked wrong by the user' } });
  const blob = parseBlob((await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } }))?.coachProfile);
  const negatives: unknown[] = Array.isArray(blob.threadNegatives) ? blob.threadNegatives : [];
  negatives.push({ at: now.toISOString(), kind: t.kind, title: t.title, quote: t.sourceQuote });
  await mergeBlobKeys(userId, { threadNegatives: negatives.slice(-30) });
  return true;
}

export async function noteRaised(id: string, now = new Date()): Promise<void> {
  await prisma.agentThread.update({ where: { id }, data: { raisedCount: { increment: 1 }, lastRaisedAt: now } }).catch(() => {});
}
export async function noteIgnored(id: string): Promise<void> {
  await prisma.agentThread.update({ where: { id }, data: { ignoredCount: { increment: 1 } } }).catch(() => {});
}

// ── Extraction ──────────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You keep a coach's list of open threads from a chat with one client. From the NEW MESSAGES, list things worth coming back to:
- event: a dated thing they're training for (fight, meet, race, trip, wedding) — eventDate YYYY-MM-DD when stated
- symptom: a niggle, pain or odd sensation tied to lifts — affects: the lifts it touches
- experiment: a change being tried on purpose (new pull day, creatine, a deload) — affects: lifts involved
- question: something they asked that wasn't answered yet, or that the coach promised to come back to
- goal: a concrete target ("225 bench by March")
Not threads: questions about the app itself (sharing, screenshots, the snap button, usernames, login, billing, "restart the intake"), a planned or scheduled training session ("Saturday arms" is not an event), one-off logs, and anything already answered in the messages.
Rules: sourceQuote must be the client's or coach's EXACT words copied from the messages (short). title ≤ 8 words, plain. read: one short sentence on where it stands (optional). checkBackAt: a YYYY-MM-DD when a follow-up makes sense (optional; events get the week before). Skip chit-chat, one-off logs, and anything already in EXISTING THREADS unless the messages change it. Reply with JSON: {"threads":[{"kind","title","sourceQuote","read","checkBackAt","eventDate","affects":[]}]}. Nothing to add → {"threads":[]}.`;

export type ExtractFn = (prompt: string, input: string) => Promise<string>;

async function defaultExtract(prompt: string, input: string): Promise<string> {
  const { chatComplete } = await import('../services/chatClient.js');
  const res = await chatComplete({
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: input }],
    max_completion_tokens: 1200,
    response_format: { type: 'json_object' },
  } as any, { label: 'thread-extract', sensitive: true, timeoutMs: 45_000 });
  return res.choices?.[0]?.message?.content ?? '{}';
}

/** Pure: parse the model's JSON leniently; bad rows are dropped, never thrown. */
export function parseExtraction(raw: string): ExtractedThread[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : raw);
    const list = Array.isArray(p?.threads) ? p.threads : [];
    return list.filter((t: any) => t && typeof t.title === 'string' && typeof t.sourceQuote === 'string').map((t: any) => ({
      kind: t.kind, title: String(t.title).trim(), sourceQuote: String(t.sourceQuote).trim(),
      read: typeof t.read === 'string' ? t.read.trim() : null,
      checkBackAt: /^\d{4}-\d{2}-\d{2}$/.test(String(t.checkBackAt ?? '')) ? t.checkBackAt : null,
      eventDate: /^\d{4}-\d{2}-\d{2}$/.test(String(t.eventDate ?? '')) ? t.eventDate : null,
      affects: Array.isArray(t.affects) ? t.affects.map(String).slice(0, 6) : [],
    }));
  } catch { return []; }
}

/**
 * Fold the messages since the last extraction into the ledger. Runs after a
 * turn (fire-and-forget) and from the sweep. The quote check is the guard
 * against invented threads; the user's "That's wrong" is the second.
 */
export async function extractThreads(userId: string, opts: { extract?: ExtractFn; now?: Date; minNew?: number } = {}): Promise<{ created: number; updated: number }> {
  const now = opts.now ?? new Date();
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, coachProfile: true } });
  if (!u || !proactiveAvailableFor(userId, u.email)) return { created: 0, updated: 0 };
  const blob = parseBlob(u.coachProfile);
  const through: string | null = typeof blob.threadsExtractedThrough === 'string' ? blob.threadsExtractedThrough : null;
  const history = await loadStoredMessages(userId);
  const fresh = history.filter((m) => m.at && (!through || m.at > through) && m.role === 'user' || (m.at && (!through || m.at > through) && m.role === 'assistant' && !m.origin));
  if (fresh.length < (opts.minNew ?? 1)) return { created: 0, updated: 0 };
  const existing = await openThreads(userId);
  const transcript = fresh.map((m) => stripAppNotes(m.text));
  const input = [
    `TODAY: ${now.toISOString().slice(0, 10)}`,
    `EXISTING THREADS:\n${existing.map((t) => `- [${t.kind}] ${t.title}${t.checkBackAt ? ` (check back ${t.checkBackAt})` : ''}`).join('\n') || '(none)'}`,
    Array.isArray(blob.threadNegatives) && blob.threadNegatives.length ? `THE USER SAID THESE WERE WRONG (don't repeat them):\n${blob.threadNegatives.slice(-8).map((n: any) => `- [${n.kind}] ${n.title}`).join('\n')}` : '',
    `NEW MESSAGES:\n${fresh.map((m) => `[${(m.at ?? '').slice(0, 16).replace('T', ' ')}] ${m.role === 'user' ? 'Client' : 'Coach'}: ${stripAppNotes(m.text).slice(0, 1500)}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
  const raw = await (opts.extract ?? defaultExtract)(EXTRACT_PROMPT, input);
  const today = now.toISOString().slice(0, 10);
  const sourceAtOf = (quote: string) => fresh.find((m) => quoteInTranscript(quote, [stripAppNotes(m.text)]))?.at ?? null;
  const { create, update } = mergeExtracted(existing, parseExtraction(raw), transcript, today, sourceAtOf);
  for (const e of create) {
    const src = fresh.find((m) => quoteInTranscript(e.sourceQuote, [stripAppNotes(m.text)]));
    await createThread(userId, { ...e, sourceAt: src?.at ? new Date(src.at) : now, sourceRole: src?.role ?? 'user' }, now);
  }
  for (const u2 of update) await updateThread(userId, u2.id, u2.patch);
  await mergeBlobKeys(userId, { threadsExtractedThrough: fresh[fresh.length - 1].at });
  return { created: create.length, updated: update.length };
}

/** Fire-and-forget after a turn: never blocks or fails the reply. */
export function extractThreadsLater(userId: string): void {
  if (process.env.NODE_ENV === 'test') return;
  setTimeout(() => { void extractThreads(userId, { minNew: 2 }).catch((e) => console.warn('[threads] extraction failed:', e?.message ?? e)); }, 1500);
}
