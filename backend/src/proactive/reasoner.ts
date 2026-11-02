// The reasoner (design A1): the model reads one user's dossier and says what,
// if anything, is worth raising — the morning read, at most 3 items. It can
// only cite evidence by id from the catalog evidence.ts computed; a candidate
// whose evidence isn't there, or isn't about what it asks, is dropped. The
// order is fixed here, not by the model: symptoms and injuries first, then due
// follow-ups, then events, then patterns (Nov 2026 — the model had put protein
// ahead of a due symptom thread). New observations only when the gate's G2
// minimums are met (the gate enforces that — the reasoner just proposes).
//
// The model is GPT Astra (reasoning) since Nov 2026: choosing what matters for
// one person from a dossier is the reasoning-heavy part of the coach.
//
// Nothing here sends anything. deliver.ts does, after gate.ts.

import { PrismaClient } from '@prisma/client';
import { readProfile } from '../agent/profile/coachProfile.js';
import { resolveTargets } from '../services/nutritionTargets.js';
import { todayForTz } from '../services/localDate.js';
import { buildEvidence, loadEvidenceInput, type EvidenceItem, type EvidenceInput } from './evidence.js';
import { openThreads, dueThreads, parseList, type ThreadRow } from './threads.js';

/** The reasoning model behind the morning read, and how hard it thinks. */
export const PROACTIVE_MODEL = process.env.PROACTIVE_MODEL || 'gpt-6-astra';
const PROACTIVE_EFFORT = (['low', 'medium', 'high', 'xhigh', 'max'].includes(process.env.PROACTIVE_REASONING_EFFORT ?? '') ? process.env.PROACTIVE_REASONING_EFFORT : 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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

const REASONER_PROMPT = `You are Anakin, a strength and nutrition coach, writing FIRST to one client this morning: their morning read, up to three short items in chat. You are not in a conversation. Raise only what is specific to this person and worth their attention today; on a quiet day one item, or none, is right.

What matters, in this order:
1. Their body: a DUE symptom thread, an injury or rehab plan that today's training or food should account for. Ask how it is now and offer to adjust ("If it's still stiff, I'll swap today's jumps for the calf work from your rehab plan").
2. Other DUE THREADS: pick each up in their own terms (their quote is in the evidence as thread_<id>).
3. An upcoming event and what it means this week.
4. A pattern in the evidence that calls for one question or one offer: missed sessions against the plan, a stalled lift, a micronutrient that keeps coming up short, meals not logged, a run of hard days with low energy or short sleep.

Rules:
- Each item is about ONE thing, and cites only evidence that is about that thing. A sleep line doesn't go under a question about a missed session; a protein line doesn't go under an injury. Evidence ids only from the EVIDENCE list. Never state a number that isn't there. Never mention HRV or soreness scores.
- A follow-up sets threadId and cites that thread's thread_<id> evidence.
- The question is one or two sentences, ≤ 160 characters, plain words, and offers to DO something concrete.
- Injuries, symptoms, rehab, food and body weight are fine to raise in chat — this is a private conversation with their coach. Be direct and kind.
- pushWhyNow: only for the single most time-sensitive item, only if the client's usual session is within a few hours AND the item changes that session. It is shown on the lock screen, so: plain words, no numbers, nothing about symptoms, injuries, body weight, food or calories ("Before your session today"). Otherwise null.
- primary: the label of the one "yes" option, ≤ 5 words. (The app adds "Not now" and "Stop asking about this".)
- topic: a short key for muting ("achilles", "the fight date", "vitamin d", "bench").
- area: "fuel" for food and nutrients, otherwise "training".
- Don't repeat a topic the client ignored or muted recently (see RECENT), or anything in THE CLIENT SAID THESE WERE WRONG.

Reply with JSON only: {"candidates":[{"kind":"followup"|"checkin","threadId":string|null,"topic":string,"question":string,"primary":string,"evidence":[ids],"pushWhyNow":string|null,"area":"training"|"fuel"}]}. At most 3, most important first. Nothing worth raising → {"candidates":[]}.`;

export function renderDossier(d: Dossier): string {
  const line = (s: string[]) => s.length ? s.join('\n') : '(none)';
  return [
    `TODAY: ${d.today} (${d.tz}) · plan: ${d.tier}`,
    `CLIENT:\n${line(d.profile.map((p) => `- ${p}`))}`,
    `DUE THREADS (check-back is today or past):\n${line(d.due.map((t) => `- id=${t.id} [${t.kind}] ${t.title}${t.read ? ` — ${t.read}` : ''}${t.sourceQuote ? ` (they said: "${t.sourceQuote}")` : ''}`))}`,
    `OTHER OPEN THREADS:\n${line(d.threads.filter((t) => !d.due.some((x) => x.id === t.id)).map((t) => `- id=${t.id} [${t.kind}] ${t.title}${t.checkBackAt ? ` · check back ${t.checkBackAt}` : ''}${t.eventDate ? ` · ${t.eventDate}` : ''}`))}`,
    `EVIDENCE (cite by id; only under an item it's about):\n${line(d.evidence.map((e) => `- ${e.id}${e.area ? ` [${e.area}]` : ''}: ${e.verb} — ${e.text}`))}`,
    `SESSIONS, last 14 days (${d.sessionCount} logged all time):\n${line(d.sessions.map((s) => `- ${s.date} ${s.title}`))}`,
    `MEALS, last 7 logged days (${d.mealDayCount} days all time):\n${line(d.mealDays.map((m) => `- ${m.date} ${Math.round(m.kcal)} kcal · ${Math.round(m.proteinG)} g protein`))}`,
    `CHECK-INS, newest first:\n${line(d.checkins.map((c) => `- ${c.date} energy ${c.energy ?? '–'}/5 · sleep ${c.sleepHours ?? '–'} h`))}`,
    `RECENT REACH-OUTS, last 14 days:\n${line(d.recent.map((r) => `- ${r.createdAt.slice(0, 10)} ${r.kind} · ${r.topic} → ${r.outcome ?? 'no reply yet'}`))}`,
    d.negatives.length ? `THE CLIENT SAID THESE WERE WRONG — don't raise them:\n${line(d.negatives.map((n) => `- ${n}`))}` : '',
  ].filter(Boolean).join('\n\n');
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const STEM = (w: string) => w.slice(0, 5);
const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
/**
 * Pure: is this evidence line about what the candidate asks? The user's own
 * recent words always are (they're the reason to write); a thread's quote is
 * about its thread; any other line needs one of its topics in the candidate's
 * topic or question ("sleep" under a sleep question, not under "stopped early").
 */
export function evidenceRelevant(e: EvidenceItem, c: { topic: string; question: string; threadId: string | null }): boolean {
  if (e.id.startsWith('quote_')) return true;
  if (e.id.startsWith('thread_')) return e.id === `thread_${c.threadId}`;
  const hay = new Set(wordsOf(`${c.topic} ${c.question}`).map(STEM));
  return e.topics.some((t) => wordsOf(t).some((w) => hay.has(STEM(w))));
}

type ThreadLite = Pick<ThreadRow, 'id' | 'status'> & Partial<Pick<ThreadRow, 'kind' | 'title'>>;

/** Pure: the fixed order — body (symptoms, injuries, rehab) → due follow-ups → events → patterns. */
export function candidateRank(c: Candidate, threads: ThreadLite[], dueIds: Set<string>): number {
  const t = c.threadId ? threads.find((x) => x.id === c.threadId) : null;
  const bodyEvidence = c.evidence.some((id) => id === 'rehab_plan' || id.startsWith('injury_'));
  if (t?.kind === 'symptom' || bodyEvidence) return dueIds.has(c.threadId ?? '') ? 0 : 1;
  if (t && dueIds.has(t.id)) return 2;
  if (t?.kind === 'event' || c.evidence.some((id) => id.startsWith('event_'))) return 3;
  if (t) return 4;
  return 5;
}

/** A due symptom thread the model left out still gets asked about — in plain words, with its own quote as the receipt. */
export function symptomFallback(t: Pick<ThreadRow, 'id' | 'title'>, evidence: EvidenceItem[]): Candidate | null {
  const ev = evidence.find((e) => e.id === `thread_${t.id}`);
  if (!ev) return null;
  const what = t.title.replace(/\s*·.*$/, '').trim();
  const lower = what.charAt(0).toLowerCase() + what.slice(1);
  const question = `Checking in on ${lower}. How is it today? If it's still bothering you, I'll adjust today's training around it.`.slice(0, 160);
  return { kind: 'followup', topic: what.toLowerCase().slice(0, 40), threadId: t.id, question, primary: 'Tell you how it is', evidence: [ev.id], pushWhyNow: null, area: 'training' };
}

/**
 * Pure: keep only candidates whose evidence exists, is about what they ask, and
 * whose thread is open — then order them by the fixed priority. Model prose
 * never becomes a receipt.
 */
export function verifyCandidates(raw: unknown, evidence: EvidenceItem[], threads: ThreadLite[], opts: { due?: Pick<ThreadRow, 'id' | 'kind' | 'title'>[] } = {}): Candidate[] {
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
    const threadId = typeof c.threadId === 'string' && open.has(c.threadId) ? c.threadId : null;
    const kind: Candidate['kind'] = threadId ? 'followup' : 'checkin';
    const cited: string[] = Array.isArray(c.evidence) ? [...new Set<string>(c.evidence.map((x: unknown) => String(x)).filter((id: string) => ids.has(id)))] : [];
    // A follow-up always carries its thread's own quote, first.
    if (threadId && ids.has(`thread_${threadId}`) && !cited.includes(`thread_${threadId}`)) cited.unshift(`thread_${threadId}`);
    const ev = cited.filter((id) => evidenceRelevant(evidence.find((e) => e.id === id)!, { topic, question, threadId })).slice(0, 3);
    if (!question || !primary || !topic || !ev.length) continue;
    if (c.kind === 'followup' && !threadId) continue;
    // ≤ 5 words plus a dash clause ("It's soon — I'll give the date"): punctuation isn't a word.
    if (primary.replace(/[—–-]/g, ' ').split(/\s+/).filter(Boolean).length > 7) continue;
    const pushWhyNow = typeof c.pushWhyNow === 'string' && c.pushWhyNow.trim() ? clean(c.pushWhyNow, 80) : null;
    // One item per thread and per topic.
    if (out.some((o) => o.topic === topic || (threadId && o.threadId === threadId))) continue;
    out.push({ kind, topic, threadId, question, primary, evidence: ev, pushWhyNow, area: c.area === 'fuel' ? 'fuel' : 'training' });
  }
  const dueIds = new Set((opts.due ?? []).map((t) => t.id));
  // One fallback at most, and only when nothing in the read already covers their body (one symptom is often several threads).
  if (!out.some((o) => candidateRank(o, threads, dueIds) <= 1)) {
    for (const t of opts.due ?? []) {
      if (t.kind !== 'symptom' || !open.has(t.id)) continue;
      const fb = symptomFallback(t, evidence);
      if (fb) { out.push(fb); break; }
    }
  }
  // Stable sort by the fixed priority; three at most.
  return out.map((c, i) => ({ c, i, r: candidateRank(c, threads, dueIds) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, 3).map((x) => x.c);
}

export type CompleteFn = (system: string, input: string) => Promise<string>;

/**
 * GPT Astra through Chat Completions (reasoning_effort, no temperature;
 * max_completion_tokens includes the reasoning tokens, hence the headroom).
 * If it fails or comes back without JSON, the default OpenAI model answers.
 */
async function defaultComplete(system: string, input: string): Promise<string> {
  const { chatComplete } = await import('../services/chatClient.js');
  const messages = [{ role: 'system' as const, content: system }, { role: 'user' as const, content: input }];
  try {
    const res = await chatComplete({ messages, max_completion_tokens: 8000, response_format: { type: 'json_object' } } as any,
      { label: 'proactive-reasoner', sensitive: true, timeoutMs: 120_000, openaiModel: PROACTIVE_MODEL, reasoningEffort: PROACTIVE_EFFORT });
    const text = res.choices?.[0]?.message?.content;
    if (text && /\{/.test(text) && res.choices?.[0]?.finish_reason !== 'length') return text;
    console.warn(`[proactive] ${PROACTIVE_MODEL} gave no usable JSON (finish=${res.choices?.[0]?.finish_reason}); using the default model`);
  } catch (err: any) {
    console.warn(`[proactive] ${PROACTIVE_MODEL} failed (${err?.message ?? err}); using the default model`);
  }
  const res = await chatComplete({ messages, max_completion_tokens: 900, response_format: { type: 'json_object' } } as any, { label: 'proactive-reasoner', sensitive: true, timeoutMs: 60_000 });
  return res.choices?.[0]?.message?.content ?? '{"candidates":[]}';
}

/** Pure: injuries in the user's words, from both places they're kept (profile and constraints). */
export function injuryLines(profile: any, constraintsText: string | null | undefined): string[] {
  const out: string[] = [];
  const healed = (t: string) => /\b(healed|fully recovered|resolved|no longer|in the past)\b/i.test(t);
  if (Array.isArray(profile?.injuries)) for (const i of profile.injuries) { const t = String(i?.text ?? i?.area ?? (typeof i === 'string' ? i : '')).trim(); if (t && !healed(t)) out.push(t); }
  const c = String(constraintsText ?? '').trim();
  if (c && !healed(c) && /\b(injur|pain|surgery|surgical|tear|torn|rupture|strain|sprain|tendin|tendon|achilles|acl|mcl|meniscus|disc|hernia|fractur|rehab|physio)\w*/i.test(c)) out.push(c.slice(0, 120));
  return out;
}

export async function buildDossier(userId: string, now = new Date()): Promise<(Dossier & { input: EvidenceInput }) | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, timezone: true, coachProfile: true, savedProgram: true, dailyCalorieTarget: true, unitPreference: true, constraintsText: true } });
  if (!u) return null;
  const tz = u.timezone || 'UTC';
  const today = todayForTz(tz, now);
  const threads = await openThreads(userId);
  const targets = resolveTargets({ savedProgram: u.savedProgram, coachProfile: u.coachProfile, dailyCalorieTarget: u.dailyCalorieTarget });
  const profile = await readProfile(userId).catch(() => null) as any;
  const program = (() => { try { return JSON.parse(u.savedProgram ?? 'null'); } catch { return null; } })();
  const input = await loadEvidenceInput(userId, today, threads, targets?.proteinG ?? null, {
    rehab: program?.rehab?.area ? { area: String(program.rehab.area), side: program.rehab.side ?? null, surgeryDate: program.rehab.surgeryDate ?? null } : null,
    injuries: injuryLines(profile, u.constraintsText),
    plannedDaysPerWeek: Number.isFinite(Number(program?.daysPerWeek)) ? Number(program.daysPerWeek) : null,
    microTargets: await microTargetsFor(userId),
  });
  const unit: 'lb' | 'kg' = u.unitPreference === 'metric' ? 'kg' : 'lb';
  const evidence = buildEvidence(input, unit);
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

/** The micronutrients worth watching for this person: their plan's focus list (or the generic one), "meet" targets only. */
async function microTargetsFor(userId: string): Promise<{ key: string; label: string; target: number }[]> {
  try {
    const [{ latestNutritionPlan }, { computeMicroTargets }] = await Promise.all([import('../services/nutritionPlanService.js'), import('../services/microTargetsService.js')]);
    const plan = await latestNutritionPlan(userId).catch(() => null);
    const t = plan?.targets?.targets?.length ? plan.targets : computeMicroTargets({});
    const focus = new Set(t.focus ?? []);
    return t.targets.filter((x) => x.direction === 'meet' && (!focus.size || focus.has(x.key))).map((x) => ({ key: x.key, label: x.label, target: x.target }));
  } catch { return []; }
}

/** Candidates for one user, verified. Empty when there's nothing to say — or no evidence to say it with. */
export async function reasonForUser(userId: string, opts: { complete?: CompleteFn; now?: Date } = {}): Promise<{ dossier: Dossier; candidates: Candidate[] } | null> {
  const dossier = await buildDossier(userId, opts.now);
  if (!dossier) return null;
  // Nothing to cite and nothing due → don't spend a model call.
  if (!dossier.evidence.length && !dossier.due.length) return { dossier, candidates: [] };
  const raw = await (opts.complete ?? defaultComplete)(REASONER_PROMPT, renderDossier(dossier));
  return { dossier, candidates: verifyCandidates(raw, dossier.evidence, dossier.threads, { due: dossier.due }) };
}

export const threadAffects = (t: ThreadRow) => parseList(t.affectsJson);
