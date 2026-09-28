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
}

const TTL_MS = 6 * 60 * 60 * 1000; // sentence stays fresh for 6h or until a mutation clears it
const MAX_SENTENCE = 110;

/** Plain text, at most two sentences, no markdown — whatever the model did. */
export function tidySentence(raw: string): string {
  let t = String(raw ?? '')
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

function fallbackSentence(ctx: Awaited<ReturnType<typeof assembleContext>>, session: BriefSession | null): string {
  const w = ctx.lastWellness;
  if (session?.isToday) {
    if (w && w.sleepHours < 6) return `${session.name} day, and you slept ${w.sleepHours} hours. I'll hold last week's loads — bar speed will tell us if that was right.`;
    return `${session.name} day. Your last one moved well, so today builds on it.`;
  }
  if (session) return `Rest today. ${session.name} is next — I'll set the loads from your last session.`;
  if (!ctx.profile.goal) return 'Tell me what you\'re working toward and I\'ll build the first week.';
  return 'Nothing scheduled today. Log a meal or ask me anything about the plan.';
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

    const cacheKey = `brief:${userId}:${date}`;
    let sentence = cacheGet<string>(cacheKey) ?? null;
    let source: Brief['source'] = 'agent';
    if (!sentence) {
      try {
        const r = await runAgentTask(userId, 'home_brief');
        sentence = tidySentence(r.reply ?? '') || null;
        if (sentence) cacheSet(cacheKey, sentence, TTL_MS);
      } catch (err: any) {
        console.warn('[brief] home_brief failed, using fallback:', err?.message ?? err);
      }
    }
    if (!sentence) { sentence = fallbackSentence(ctx, session); source = 'fallback'; }

    const suggestions = session?.isToday
      ? [`What's the plan for ${session.name.toLowerCase()} today?`, 'I slept badly — adjust today?', 'Log lunch']
      : ["I can't train tomorrow. Move it?", 'How\'s my deadlift?', 'Log lunch'];

    const checkedInToday = ctx.lastWellness?.date === date;
    const ask = !checkedInToday && session?.isToday
      ? { key: 'sleep', question: 'How did you sleep?', reason: session.name ? `Under 6 hours makes ${session.name.toLowerCase()} a deload, not a test.` : 'Under 6 hours makes today a deload, not a test.', options: ['Under 6 hours', '6–7 hours', '7 or more'] }
      : null;
    const brief: Brief = {
      date, sentence, receipts, session, suggestions, ask,
      weekNumber: schedule?.weekNumber ?? null,
      phaseName: schedule?.phaseName ?? null,
      source,
    };
    res.json(brief);
  } catch (err: any) {
    console.error('[brief] failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to build brief' });
  }
});

export default router;
