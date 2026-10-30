// The hourly sweep. For each eligible user whose local clock just turned
// DELIVER_HOUR it: marks yesterday's unanswered reach-outs ignored, runs due
// outcome reports, then the reasoner → gate → delivery for ONE message. Every
// hour it also expires prepared-work cards, runs the weight-cut check and the
// photo retention sweep. Everything is per-user try/catch: one bad user never
// stops the sweep.
//
// PROACTIVE_V2_DRY_RUN=1 records what would have gone out (channel 'dryrun')
// and sends nothing — the silent test the design asks for before launch.

import { PrismaClient } from '@prisma/client';
import { postInitiatedTurn } from '../agent/initiated.js';
import { proactiveAvailableFor, proactiveDryRun, uiV2AvailableFor } from '../services/featureFlags.js';
import { todayForTz } from '../services/localDate.js';
import { resolveTargets } from '../services/nutritionTargets.js';
import { gateCandidate, type GateInput } from './gate.js';
import { getProactivePrefs } from './prefs.js';
import { reasonForUser, type CompleteFn, type Candidate } from './reasoner.js';
import { deliverCandidate, markUnansweredIgnored } from './deliver.js';
import { dueThreads, openThreads, resolveThread, updateThread, type ThreadRow } from './threads.js';
import { buildOutcomeInput, classifyOutcome, outcomeCard, outcomeHeadline, outcomeReceipts } from './outcome.js';
import { currentWeightCutFlag, safetyCard, safetyReceipts } from './safety.js';

const prisma = new PrismaClient();

export const DELIVER_HOUR = 7;

/** Local hour and minute in a zone. Pure. */
export function localClock(tz: string | null | undefined, now = new Date()): { hour: number; minute: number } {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    return { hour: Number(p.hour) % 24, minute: Number(p.minute) };
  } catch { return { hour: now.getUTCHours(), minute: now.getUTCMinutes() }; }
}

export interface EvaluateResult {
  delivered: Candidate | null;
  outcomes: number;
  gated: { candidate: Candidate; allow: boolean; reason: string }[];
  dryRun: boolean;
}

/** Everything the gate needs for one user, loaded once. */
async function gateContext(userId: string, now: Date) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, timezone: true, email: true, savedProgram: true, coachProfile: true, dailyCalorieTarget: true, unitPreference: true } });
  if (!u) return null;
  const tz = u.timezone || 'UTC';
  const clock = localClock(tz, now);
  const [prefs, recentRows, sessions, mealDays] = await Promise.all([
    getProactivePrefs(userId),
    prisma.proactiveEvent.findMany({ where: { userId, createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } }, select: { kind: true, topic: true, threadId: true, channel: true, createdAt: true, outcome: true } }),
    prisma.workoutLog.count({ where: { userId } }),
    prisma.mealEntry.findMany({ where: { userId }, select: { date: true }, distinct: ['date'] }).then((r) => r.length),
  ]);
  return {
    user: u, tz, clock, prefs, sessions, mealDays, today: todayForTz(tz, now),
    recent: recentRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    unit: (u.unitPreference === 'metric' ? 'kg' : 'lb') as 'kg' | 'lb',
  };
}

/** Due experiment threads → an outcome report each (at most one a day, the cap applies). */
async function runOutcomes(userId: string, ctx: NonNullable<Awaited<ReturnType<typeof gateContext>>>, threads: ThreadRow[], now: Date, dryRun: boolean): Promise<number> {
  let posted = 0;
  for (const t of dueThreads(threads, ctx.today, now).filter((t) => t.kind === 'experiment' && t.metricJson)) {
    const input = await buildOutcomeInput(userId, t, ctx.today, ctx.unit).catch(() => null);
    if (!input) continue;
    const gate = gateCandidate({ kind: 'outcome', topic: t.title.toLowerCase(), threadId: t.id, thread: { ignoredCount: t.ignoredCount, mutedUntil: t.mutedUntil?.toISOString() ?? null, status: t.status }, prefs: ctx.prefs, tier: ctx.user.tier, localHour: ctx.clock.hour, localDate: ctx.today, recent: ctx.recent, sessions: ctx.sessions, mealDays: ctx.mealDays }, now);
    if (!gate.allow) { if (gate.closeThread) await resolveThread(userId, t.id, 'Closed — no reply', 'closed', now); continue; }
    const r = classifyOutcome(input);
    const text = outcomeHeadline(input, r);
    const ev = await prisma.proactiveEvent.create({ data: { userId, kind: 'outcome', topic: t.title.toLowerCase(), threadId: t.id, channel: dryRun ? 'dryrun' : 'chat', text, evidenceJson: JSON.stringify(outcomeReceipts(input)) } });
    if (dryRun) { console.log(`[proactive] DRY RUN outcome user=${userId.slice(0, 8)} ${r.state}: ${text}`); posted++; continue; }
    let changeId: string | null = null;
    try { changeId = JSON.parse(t.metricJson!).changeId ?? null; } catch { changeId = null; }
    const ok = await postInitiatedTurn(userId, { text, cards: [outcomeCard(input, r, { threadId: t.id, changeId, eventId: ev.id })], receipts: outcomeReceipts(input) });
    if (ok) {
      posted++;
      ctx.recent.push({ kind: 'outcome', topic: t.title.toLowerCase(), threadId: t.id, channel: 'chat', createdAt: now.toISOString(), outcome: null });
      // Too few sessions: look again in two weeks without asking. Otherwise the card's decision moves the thread.
      await updateThread(userId, t.id, { checkBackAt: r.state === 'too_few' ? addDaysIso(ctx.today, 14) : addDaysIso(ctx.today, 7), status: 'running' });
    }
  }
  return posted;
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One user's morning: ignored → outcomes → reasoner → gate → one delivery. */
export async function evaluateUser(userId: string, opts: { now?: Date; complete?: CompleteFn; dryRun?: boolean } = {}): Promise<EvaluateResult | null> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? proactiveDryRun();
  const ctx = await gateContext(userId, now);
  if (!ctx) return null;
  await markUnansweredIgnored(userId, now);
  const threads = await openThreads(userId);
  const outcomes = await runOutcomes(userId, ctx, threads, now, dryRun);

  const r = await reasonForUser(userId, { complete: opts.complete, now });
  if (!r) return { delivered: null, outcomes, gated: [], dryRun };
  const gated: EvaluateResult['gated'] = [];
  let delivered: Candidate | null = null;
  for (const c of r.candidates) {
    const t = c.threadId ? threads.find((x) => x.id === c.threadId) : null;
    const g: GateInput = {
      kind: c.kind, topic: c.topic, threadId: c.threadId, area: c.area,
      thread: t ? { ignoredCount: t.ignoredCount, mutedUntil: t.mutedUntil?.toISOString() ?? null, status: t.status } : null,
      prefs: ctx.prefs, tier: ctx.user.tier, localHour: ctx.clock.hour, localDate: ctx.today, recent: ctx.recent, sessions: ctx.sessions, mealDays: ctx.mealDays,
    };
    const gate = gateCandidate(g, now);
    gated.push({ candidate: c, allow: gate.allow, reason: gate.reason });
    if (gate.closeThread && t) await resolveThread(userId, t.id, 'Closed — no reply twice', 'closed', now);
    // Live: one message a day. Dry run: record every candidate the gate would have let through.
    if (!gate.allow || (delivered && !dryRun)) continue;
    await deliverCandidate(userId, c, r.dossier.evidence, { dryRun, now, localHour: ctx.clock.hour, localMinute: ctx.clock.minute });
    delivered = delivered ?? c;
    ctx.recent.push({ kind: c.kind, topic: c.topic, threadId: c.threadId, channel: dryRun ? 'dryrun' : 'chat', createdAt: now.toISOString(), outcome: null });
  }
  return { delivered, outcomes, gated, dryRun };
}

/** G3 every hour: the weight-cut check for everyone with weigh-ins. Free users get a screen line only (screens.ts reads the flag live). */
export async function runSafetyChecks(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const users = await prisma.bodyWeightLog.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] });
  let posted = 0;
  for (const { userId } of users) {
    try {
      const ctx = await gateContext(userId, now);
      if (!ctx || !proactiveAvailableFor(userId, ctx.user.email) || !uiV2AvailableFor(userId, ctx.user.email)) continue;
      const threads = await openThreads(userId);
      const event = threads.find((t) => t.kind === 'event' && t.eventDate && t.eventDate >= ctx.today) ?? null;
      const flag = await currentWeightCutFlag(userId, ctx.today, !!event);
      if (!flag) continue;
      // Once per flag state per day; the card replaces itself (entity) so chat never shows two.
      const already = ctx.recent.some((e) => e.kind === 'safety' && e.createdAt.slice(0, 10) === ctx.today);
      if (already) continue;
      const gate = gateCandidate({ kind: 'safety', topic: 'weight cut', prefs: ctx.prefs, tier: ctx.user.tier, localHour: ctx.clock.hour, localDate: ctx.today, recent: ctx.recent, sessions: ctx.sessions, mealDays: ctx.mealDays, acute: flag.acute }, now);
      if (!gate.allow) continue;
      const isPro = ctx.user.tier === 'pro' || ctx.user.tier === 'enterprise';
      const ev = await prisma.proactiveEvent.create({ data: { userId, kind: 'safety', topic: 'weight cut', channel: isPro ? (proactiveDryRun() ? 'dryrun' : 'chat') : 'screen', text: flag.headline } });
      if (!isPro || proactiveDryRun()) { posted++; continue; }
      const eventLabel = event ? `${event.title.replace(/\s*·.*$/, '')} · ${event.eventDate!.slice(5).replace('-', '/')}` : null;
      if (await postInitiatedTurn(userId, { text: `${flag.headline}`, cards: [safetyCard(flag, { coachRuns: ctx.prefs.programOwner !== 'me', eventLabel, eventId: ev.id })], receipts: safetyReceipts(flag, eventLabel) })) posted++;
    } catch (err: any) { console.error(`[proactive] safety check failed for ${userId.slice(0, 8)}:`, err?.message ?? err); }
  }
  return posted;
}

const ranToday = new Map<string, string>();
export function resetSweepForTests() { ranToday.clear(); }

/** Called hourly from index.ts. */
export async function runProactiveHour(now = new Date(), opts: { complete?: CompleteFn } = {}): Promise<{ evaluated: number; delivered: number; outcomes: number; expired: number; safety: number }> {
  const out = { evaluated: 0, delivered: 0, outcomes: 0, expired: 0, safety: 0 };
  if (process.env.AGENT_ENABLED !== 'true') return out;
  try { const { expirePreparedCards } = await import('./prepared.js'); out.expired = await expirePreparedCards(now); } catch (err: any) { console.error('[proactive] expiry failed:', err?.message ?? err); }
  try { const { photoRetentionSweep } = await import('./photos.js'); await photoRetentionSweep(now); } catch (err: any) { console.error('[proactive] photo retention failed:', err?.message ?? err); }
  try { out.safety = await runSafetyChecks(now); } catch (err: any) { console.error('[proactive] safety sweep failed:', err?.message ?? err); }

  const users = await prisma.user.findMany({ where: { tier: { in: ['pro', 'enterprise'] } }, select: { id: true, email: true, timezone: true } });
  for (const u of users) {
    if (!proactiveAvailableFor(u.id, u.email) || !uiV2AvailableFor(u.id, u.email)) continue;
    const tz = u.timezone || 'UTC';
    if (localClock(tz, now).hour !== DELIVER_HOUR) continue;
    const today = todayForTz(tz, now);
    if (ranToday.get(u.id) === today) continue;
    ranToday.set(u.id, today);
    try {
      const r = await evaluateUser(u.id, { now, complete: opts.complete });
      out.evaluated++;
      if (r?.delivered) out.delivered++;
      out.outcomes += r?.outcomes ?? 0;
    } catch (err: any) { console.error(`[proactive] evaluate failed for ${u.id.slice(0, 8)}:`, err?.message ?? err); }
  }
  if (out.evaluated || out.expired || out.safety) console.log(`[proactive] hour: evaluated=${out.evaluated} delivered=${out.delivered} outcomes=${out.outcomes} expired=${out.expired} safety=${out.safety}${proactiveDryRun() ? ' (dry run)' : ''}`);
  return out;
}

/** Fuel's view of whether the user is cutting — the insight stays silent then. */
export async function isCutting(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachGoal: true, savedProgram: true, coachProfile: true, dailyCalorieTarget: true, goalWeightKg: true, weightKg: true } });
  if (!u) return false;
  if (/cut|fat loss|lose|lean|weight loss|shred/i.test(String(u.coachGoal ?? ''))) return true;
  if (u.goalWeightKg && u.weightKg && u.goalWeightKg < u.weightKg - 1) return true;
  const t = resolveTargets({ savedProgram: u.savedProgram, coachProfile: u.coachProfile, dailyCalorieTarget: u.dailyCalorieTarget });
  return !!t && /cut|deficit|loss/i.test(String((t as any).source ?? ''));
}
