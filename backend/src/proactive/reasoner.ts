// The reasoner (design A1): the model reads one user's dossier and says what,
// if anything, is worth raising — at most 3 candidates, usually none. It can
// only cite evidence by id from the catalog evidence.ts computed; a candidate
// whose evidence isn't there is dropped. Follow-ups on due threads come
// first; new observations only when the gate's G2 minimums are met (the
// gate enforces that — the reasoner just proposes).
//
// Nothing here sends anything. deliver.ts does, after gate.ts.

import { PrismaClient } from '@prisma/client';
import { readProfile } from '../agent/profile/coachProfile.js';
import { resolveTargets } from '../services/nutritionTargets.js';
import { todayForTz } from '../services/localDate.js';
import { buildEvidence, loadEvidenceInput, type EvidenceItem, type EvidenceInput } from './evidence.js';
import { openThreads, dueThreads, parseList, type ThreadRow } from './threads.js';

const prisma = new PrismaClient();

export interface Candidate {
  kind: 'checkin' | 'followup';
  /** Short topic key the gate and mutes use ("the fight date", "recovery", "bench"). */
  topic: string;
  threadId: string | null;
  /** ≤ 160 chars, ends in a question. */
  question: string;
  /** The primary option's label, ≤ 5 words ("It's soon — I'll give the date"). */
  primary: string;
  evidence: string[];
  /** A2 — why it can't wait, if a session is soon ("Sparring's at 9."). Null = chat only. */
  pushWhyNow: string | null;
  area: 'training' | 'fuel';
}

export interface Dossier {
  today: string;
  tz: string;
  tier: string;
  profile: string[];
  threads: ThreadRow[];
  due: ThreadRow[];
  evidence: EvidenceItem[];
  sessions: { date: string; title: string }[];
  mealDays: { date: string; kcal: number; proteinG: number }[];
  checkins: { date: string; energy: number | null; sleepHours: number | null }[];
  recent: { kind: string; topic: string; outcome: string | null; createdAt: string }[];
  sessionCount: number;
  mealDayCount: number;
  negatives: string[];
}

const REASONER_PROMPT = `You are Anakin, a strength and nutrition coach, deciding whether to write FIRST to one client this morning. You are not in a conversation. Most days the right answer is nothing.

Raise something only when it is specific to this person and worth their attention today:
- A DUE THREAD (listed) → a follow-up that picks it up in their own terms. Due threads come first.
- A pattern in the evidence that calls for one question or one offer (a recovery week, a check on a stalled lift). One, not a list.

Rules:
- Cite only evidence ids from the EVIDENCE list. Never state a number that isn't there. Never mention HRV or soreness scores.
- The question is one or two sentences, ≤ 160 characters, in plain words, and offers to DO something ("If it's close, I'll build a recovery week around it").
- primary: the label of the one "yes" option, ≤ 5 words. (The app adds "Not now" and "Stop asking about this".)
- topic: a short key for muting ("the fight date", "recovery", "bench").
- pushWhyNow: only if the client's usual session is within a few hours AND the question changes that session. Plain words, no numbers from the evidence, no symptom or injury words. Otherwise null.
- Nothing about body weight, calorie deficits, injuries or medical conditions goes in a question that could be read from a lock screen.
- Don't repeat a topic the client ignored or muted recently (see RECENT).

Reply with JSON only: {"candidates":[{"kind":"followup"|"checkin","threadId":string|null,"topic":string,"question":string,"primary":string,"evidence":[ids],"pushWhyNow":string|null,"area":"training"|"fuel"}]}. At most 3. Nothing worth raising → {"candidates":[]}.`;

export function renderDossier(d: Dossier): string {
  const line = (s: string[]) => s.length ? s.join('\n') : '(none)';
  return [
    `TODAY: ${d.today} (${d.tz}) · plan: ${d.tier}`,
    `CLIENT:\n${line(d.profile.map((p) => `- ${p}`))}`,
    `DUE THREADS (check-back is today or past):\n${line(d.due.map((t) => `- id=${t.id} [${t.kind}] ${t.title}${t.read ? ` — ${t.read}` : ''}${t.sourceQuote ? ` (they said: "${t.sourceQuote}")` : ''}`))}`,
    `OTHER OPEN THREADS:\n${line(d.threads.filter((t) => !d.due.some((x) => x.id === t.id)).map((t) => `- id=${t.id} [${t.kind}] ${t.title}${t.checkBackAt ? ` · check back ${t.checkBackAt}` : ''}${t.eventDate ? ` · ${t.eventDate}` : ''}`))}`,
    `EVIDENCE (cite by id):\n${line(d.evidence.map((e) => `- ${e.id}: ${e.verb} — ${e.text}`))}`,
    `SESSIONS, last 14 days (${d.sessionCount} logged all time):\n${line(d.sessions.map((s) => `- ${s.date} ${s.title}`))}`,
    `MEALS, last 7 logged days (${d.mealDayCount} days all time):\n${line(d.mealDays.map((m) => `- ${m.date} ${Math.round(m.kcal)} kcal · ${Math.round(m.proteinG)} g protein`))}`,
    `CHECK-INS, newest first:\n${line(d.checkins.map((c) => `- ${c.date} energy ${c.energy ?? '–'}/5 · sleep ${c.sleepHours ?? '–'} h`))}`,
    `RECENT REACH-OUTS, last 14 days:\n${line(d.recent.map((r) => `- ${r.createdAt.slice(0, 10)} ${r.kind} · ${r.topic} → ${r.outcome ?? 'no reply yet'}`))}`,
    d.negatives.length ? `THE CLIENT SAID THESE WERE WRONG — don't raise them:\n${line(d.negatives.map((n) => `- ${n}`))}` : '',
  ].filter(Boolean).join('\n\n');
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Pure: keep only candidates whose evidence exists and whose thread is open. Model prose never becomes a receipt. */
export function verifyCandidates(raw: unknown, evidence: EvidenceItem[], threads: Pick<ThreadRow, 'id' | 'status'>[]): Candidate[] {
  let list: any[] = [];
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw) : raw;
    list = Array.isArray((p as any)?.candidates) ? (p as any).candidates : [];
  } catch { return []; }
  const ids = new Set(evidence.map((e) => e.id));
  const open = new Set(threads.filter((t) => ['open', 'watching', 'running'].includes(t.status)).map((t) => t.id));
  const out: Candidate[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const question = clean(c.question, 160);
    const primary = clean(c.primary, 40);
    const topic = clean(c.topic, 40).toLowerCase();
    const ev: string[] = Array.isArray(c.evidence) ? [...new Set<string>(c.evidence.map((x: unknown) => String(x)).filter((id: string) => ids.has(id)))].slice(0, 3) : [];
    const threadId = typeof c.threadId === 'string' && open.has(c.threadId) ? c.threadId : null;
    const kind: Candidate['kind'] = threadId ? 'followup' : 'checkin';
    if (!question || !primary || !topic || !ev.length) continue;
    if (c.kind === 'followup' && !threadId) continue;
    // ≤ 5 words plus a dash clause ("It's soon — I'll give the date"): punctuation isn't a word.
    if (primary.replace(/[—–-]/g, ' ').split(/\s+/).filter(Boolean).length > 7) continue;
    const pushWhyNow = typeof c.pushWhyNow === 'string' && c.pushWhyNow.trim() ? clean(c.pushWhyNow, 80) : null;
    out.push({ kind, topic, threadId, question, primary, evidence: ev, pushWhyNow, area: c.area === 'fuel' ? 'fuel' : 'training' });
    if (out.length >= 3) break;
  }
  // Due-thread follow-ups first.
  return out.sort((a, b) => Number(b.kind === 'followup') - Number(a.kind === 'followup'));
}

export type CompleteFn = (system: string, input: string) => Promise<string>;

async function defaultComplete(system: string, input: string): Promise<string> {
  const { chatComplete } = await import('../services/chatClient.js');
  const res = await chatComplete({
    messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
    max_completion_tokens: 900,
    response_format: { type: 'json_object' },
  } as any, { label: 'proactive-reasoner', sensitive: true, timeoutMs: 60_000 });
  return res.choices?.[0]?.message?.content ?? '{"candidates":[]}';
}

export async function buildDossier(userId: string, now = new Date()): Promise<(Dossier & { input: EvidenceInput }) | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, timezone: true, coachProfile: true, savedProgram: true, dailyCalorieTarget: true, unitPreference: true } });
  if (!u) return null;
  const tz = u.timezone || 'UTC';
  const today = todayForTz(tz, now);
  const threads = await openThreads(userId);
  const targets = resolveTargets({ savedProgram: u.savedProgram, coachProfile: u.coachProfile, dailyCalorieTarget: u.dailyCalorieTarget });
  const input = await loadEvidenceInput(userId, today, threads, targets?.proteinG ?? null);
  const unit: 'lb' | 'kg' = u.unitPreference === 'metric' ? 'kg' : 'lb';
  const evidence = buildEvidence(input, unit);
  const profile = await readProfile(userId).catch(() => null) as any;
  const profileLines: string[] = [];
  if (profile?.values) for (const [k, v] of Object.entries(profile.values as Record<string, unknown>)) if (v != null && v !== '' && !/weight|height|age|gender|sex/i.test(k)) profileLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`.slice(0, 120));
  if (Array.isArray(profile?.injuries) && profile.injuries.length) profileLines.push(`injuries: ${profile.injuries.map((i: any) => i.text ?? i.area ?? JSON.stringify(i)).join('; ')}`.slice(0, 200));
  const recentRows = await prisma.proactiveEvent.findMany({ where: { userId, createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) }, channel: { in: ['chat', 'push'] } }, orderBy: { createdAt: 'desc' }, take: 20 });
  const blob = (() => { try { return JSON.parse(u.coachProfile ?? '{}'); } catch { return {}; } })();
  const since14 = input.workouts.filter((w) => w.date >= new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10));
  return {
    today, tz, tier: u.tier, profile: profileLines.slice(0, 12), threads, due: dueThreads(threads, today, now), evidence,
    sessions: since14.map((w) => ({ date: w.date, title: w.title ?? 'Workout' })).slice(-14),
    mealDays: [...input.mealDays].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).reverse(),
    checkins: input.checkins.slice(0, 5).map((c) => ({ date: c.date, energy: c.energy, sleepHours: c.sleepHours })),
    recent: recentRows.map((r) => ({ kind: r.kind, topic: r.topic, outcome: r.outcome, createdAt: r.createdAt.toISOString() })),
    sessionCount: input.sessionCount, mealDayCount: input.mealDayCount,
    negatives: Array.isArray(blob.threadNegatives) ? blob.threadNegatives.slice(-8).map((n: any) => String(n.title)) : [],
    input,
  };
}

/** Candidates for one user, verified. Empty when there's nothing to say — or no evidence to say it with. */
export async function reasonForUser(userId: string, opts: { complete?: CompleteFn; now?: Date } = {}): Promise<{ dossier: Dossier; candidates: Candidate[] } | null> {
  const dossier = await buildDossier(userId, opts.now);
  if (!dossier) return null;
  // Nothing to cite and nothing due → don't spend a model call.
  if (!dossier.evidence.length && !dossier.due.length) return { dossier, candidates: [] };
  const raw = await (opts.complete ?? defaultComplete)(REASONER_PROMPT, renderDossier(dossier));
  return { dossier, candidates: verifyCandidates(raw, dossier.evidence, dossier.threads) };
}

export const threadAffects = (t: ThreadRow) => parseList(t.affectsJson);
