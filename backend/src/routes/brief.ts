// GET /api/coach/brief — the v2 home's opening state.
//
// The agent-first shell opens on Anakin's sentence, never an empty input. This
// endpoint assembles that opening: one sentence, the receipts that back it,
// today's session (if any) and three suggestions. The receipts are real reads
// performed here — the client renders exactly what happened, in the order it
// happened — and the sentence is the `daily_tips` agent task, cached per user
// per day so a home visit is one cheap request, with a deterministic fallback
// when the model is unavailable so home never opens blank.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { assembleContext } from '../agent/context.js';
import { runAgentTask } from '../agent/tasks.js';
import { getCurrentWeekSchedule } from './coach.js';
import { cacheGet, cacheSet } from '../services/cacheService.js';
import type { Receipt } from '../agent/receipts.js';

const router = Router();

interface BriefSession {
  name: string;
  focus: string | null;
  minutes: number | null;
  exerciseCount: number;
  date: string;
  isToday: boolean;
  isLogged: boolean;
}

interface Brief {
  date: string;
  sentence: string;
  receipts: Receipt[];
  session: BriefSession | null;
  suggestions: string[];
  /** An Ask Anakin raises on home when it matters — e.g. no wellness check-in yet today. */
  ask: { key: string; question: string; reason: string; options: string[] } | null;
  weekNumber: number | null;
  phaseName: string | null;
  source: 'agent' | 'fallback';
  /** True while Anakin's line is still being written; the client refetches shortly and cross-fades. */
  pending: boolean;
}

const TTL_MS = 6 * 60 * 60 * 1000; // sentence stays fresh for 6h or until a mutation clears it
const MAX_SENTENCE = 95;

/** Why a brief line would be rejected; empty = valid. Kept pure for tests. */
export function briefViolations(t: string): string[] {
  const v: string[] = [];
  if (!t) v.push('empty');
  if (t.length > 90) v.push(`${t.length} chars`);
  if (/\//.test(t)) v.push('slash');
  if (/[()]/.test(t)) v.push('parentheses');
  if (/~/.test(t)) v.push('tilde');
  if (/[*_`#]/.test(t)) v.push('markdown');
  return v;
}

/** Plain text, at most two sentences, no markdown — whatever the model did. */
export function tidySentence(raw: string): string {
  let t = String(raw ?? '')
    .replace(/\s*\([^)]*\)/g, '')         // parentheticals
    .replace(/[*_`#>]+/g, '')            // markdown emphasis / headings / quotes
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')  // links
    .replace(/\s+/g, ' ')
    .trim();
  // Split on sentence punctuation followed by whitespace — "6.3" is not a boundary.
  const parts = t.split(/(?<=[.!?])\s+/);
  if (parts.length > 1 && parts[0].length >= 40) t = parts[0].trim();
  else if (parts.length > 2) t = parts.slice(0, 2).join(' ').trim();
  if (t.length > MAX_SENTENCE) {
    const cut = t.slice(0, MAX_SENTENCE);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('— '), cut.lastIndexOf(', '));
    t = (end > 80 ? cut.slice(0, end + 1) : cut).trim().replace(/[,—-]$/, '') ;
    if (!/[.!?…]$/.test(t)) t += '…';
  }
  return t;
}

function estimateMinutes(session: any): number | null {
  const ex = Array.isArray(session?.exercises) ? session.exercises.length : 0;
  if (!ex) return null;
  // ~9 min per exercise incl. warm-up + rest — a rough, honest estimate that the
  // live session replaces with the real clock.
  return Math.round(ex * 9 + 8);
}

function pickSession(schedule: any): BriefSession | null {
  const days: any[] = Array.isArray(schedule?.weekDays) ? schedule.weekDays : [];
  const today = days.find((d) => d?.isToday && d?.session);
  const next = today ?? days.find((d) => d?.session && !d?.isLogged && !d?.isPast && !d?.isToday);
  if (!next?.session) return null;
  const s = next.session;
  return {
    name: String(s.name ?? s.day ?? 'Session'),
    focus: s.focus ?? null,
    minutes: estimateMinutes(s),
    exerciseCount: Array.isArray(s.exercises) ? s.exercises.length : 0,
    date: String(next.date ?? ''),
    isToday: !!next.isToday,
    isLogged: !!next.isLogged,
  };
}

/** "Upper Body — Horizontal Push/Pull" → "Upper": the brief never carries the long descriptor. */
export function shortSessionName(raw: string): string {
  const head = String(raw ?? '').split(/[—–·/]|\s-\s/)[0].trim().replace(/\s+body$/i, '').trim();
  const first = head.split(/\s+/)[0] || 'Session';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Deterministic line — always passes briefViolations (≤ 90 chars, no slashes). */
export function fallbackSentence(ctx: { lastWellness?: { sleepHours: number } | null; profile: { goal?: string | null } }, session: BriefSession | null): string {
  const w = ctx.lastWellness;
  const name = session ? shortSessionName(session.name) : '';
  if (session?.isToday) {
    if (w && w.sleepHours < 6) return `${name} day on ${w.sleepHours} hours of sleep. I'll hold last week's loads.`;
    return `${name} day. Your last one moved well, so today builds on it.`;
  }
  if (session) return `Rest today. ${name} is next — I'll set the loads from your last one.`;
  if (!ctx.profile.goal) return 'Tell me what you\'re working toward and I\'ll build the first week.';
  return 'Nothing scheduled today. Log a meal or ask me about the plan.';
}

const inFlight = new Map<string, Promise<void>>();

/** Kick off Anakin's line for today if it isn't cached or already being written. Returns whether one is in flight. */
export function ensureBriefSentence(userId: string, cacheKey: string, write = writeBriefSentence): boolean {
  if (cacheGet<string>(cacheKey) || cacheGet<boolean>(`${cacheKey}:failed`)) return false;
  if (inFlight.has(cacheKey)) return true;
  // A failed write backs off for 10 minutes (the fallback line stands) rather than re-billing every home visit.
  const failed = () => cacheSet(`${cacheKey}:failed`, true, 10 * 60 * 1000);
  const job = write(userId)
    .then((line) => { if (line) cacheSet(cacheKey, line, TTL_MS); else failed(); })
    .catch((err: any) => { failed(); console.warn('[brief] home_brief failed:', err?.message ?? err); })
    .finally(() => { inFlight.delete(cacheKey); });
  inFlight.set(cacheKey, job);
  return true;
}

/** Validator (≤ 90 characters, no slashes/parentheses/~/markdown): one regeneration with the violation named, then the tidied first sentence if that alone passes; else null (the fallback stays). */
export async function writeBriefSentence(userId: string): Promise<string | null> {
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runAgentTask(userId, 'home_brief', attempt ? 'Your last line broke the rules (over 90 characters, or used a slash, parentheses or ~). One sentence, under 90 characters, plain words.' : undefined);
    lastRaw = String(r.reply ?? '').trim();
    if (briefViolations(lastRaw).length === 0) return lastRaw;
    console.warn(`[brief] rejected (${briefViolations(lastRaw).join(', ')}): ${lastRaw.slice(0, 120)}`);
  }
  const first = tidySentence(lastRaw).split(/(?<=[.!?])\s+/)[0];
  return briefViolations(first).length === 0 ? first : null;
}

router.get('/coach/brief', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    const [ctx, schedule] = await Promise.all([
      assembleContext(userId),
      getCurrentWeekSchedule(userId).catch(() => null),
    ]);
    const date = ctx.todayNutrition?.date ?? new Date().toISOString().slice(0, 10);
    const session = pickSession(schedule);

    // Receipts describe the reads that just happened, in order.
    const receipts: Receipt[] = [
      { verb: 'Read', text: 'Program' },
      { verb: 'Pulled', text: schedule?.weekDays ? 'This week' : 'Schedule — none yet' },
    ];
    if (ctx.lastWellness) receipts.push({ verb: 'Pulled', text: `Wellness — sleep ${ctx.lastWellness.sleepHours} h` });
    if (ctx.todayNutrition) receipts.push({ verb: 'Pulled', text: `Nutrition — ${Math.round(ctx.todayNutrition.calories)} kcal so far` });

    // Review #5: never make home wait on the model. A cached line is served
    // as-is; otherwise respond now with the deterministic line and write
    // Anakin's in the background (one in flight per user) — the client
    // polls while `pending` and cross-fades when it lands.
    const cacheKey = `brief:${userId}:${date}`;
    let sentence = cacheGet<string>(cacheKey) ?? null;
    let source: Brief['source'] = 'agent';
    let pending = false;
    if (!sentence) {
      pending = ensureBriefSentence(userId, cacheKey);
      sentence = fallbackSentence(ctx, session);
      source = 'fallback';
    }

    const suggestions = session?.isToday
      ? [`What's the plan for ${shortSessionName(session.name).toLowerCase()} today?`, 'I slept badly — adjust today?', 'Log lunch']
      : ["I can't train tomorrow. Move it?", 'How\'s my deadlift?', 'Log lunch'];

    const checkedInToday = ctx.lastWellness?.date === date;
    const ask = !checkedInToday && session?.isToday
      ? { key: 'sleep', question: 'How did you sleep?', reason: session.name ? `Under 6 hours makes ${shortSessionName(session.name).toLowerCase()} a deload, not a test.` : 'Under 6 hours makes today a deload, not a test.', options: ['Under 6 hours', '6–7 hours', '7 or more'] }
      : null;
    const brief: Brief = {
      date, sentence, receipts, session, suggestions, ask,
      weekNumber: schedule?.weekNumber ?? null,
      phaseName: schedule?.phaseName ?? null,
      source, pending,
    };
    res.json(brief);
  } catch (err: any) {
    console.error('[brief] failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to build brief' });
  }
});

export default router;
