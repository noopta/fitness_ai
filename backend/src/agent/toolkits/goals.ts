// Goals with a date (Oct 2026): a weigh-in, a competition, a race, any
// deadline. The event is stored as structured data (never a note that can be
// cut off), it's in Anakin's context every turn with a countdown, and every
// weight goal is planned the same way for every user: the safest route that
// gets there first, a faster safe one if they want it (one warning), never an
// unsafe one — with the earliest safe date instead (services/goalPace.ts).

import { registerToolkit } from '../registry.js';
import { defineOp, executeOp } from '../ops.js';
import { tool, schema, str, numOr, prisma, UNIT_FIELD, unitArg } from './kit.js';
import { planPace, projectKg, addDays, weeksBetween, ACUTE } from '../../services/goalPace.js';
import { estimateMaintenance } from '../../services/maintenance.js';
import { mifflinBmr, calorieFloorFor, floorProfileFromRow } from '../../services/nutritionSafety.js';
import { bodyWeightKg } from '../../services/weightUnits.js';
import { todayForTz } from '../../services/localDate.js';
import { appendMemory } from '../memory.js';
import type { CardDraft } from '../cards/types.js';

export interface GoalEvent {
  kind: 'weigh_in' | 'competition' | 'race' | 'deadline';
  name: string | null;
  /** The event itself (fight / race / deadline). */
  date: string;
  /** Weigh-in sports: when they weigh in, the limit, and the weight to be at before the acute cut. */
  weighInDate?: string | null;
  limitKg?: number | null;
  walkAroundKg?: number | null;
  /** Days before the weigh-in their acute protocol starts (water loading etc.). */
  acuteStartsDaysOut?: number | null;
  /** Their acute-cut protocol, in their words — theirs and their team's, never scripted by us. */
  acutePlan?: string | null;
  sport?: string | null;
  coach?: string | null;
  setAt: string;
}

const LB = 2.20462;
const parse = (s: string | null | undefined) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const kgIn = (kg: number, unit: 'metric' | 'imperial') => (unit === 'metric' ? `${Math.round(kg * 10) / 10} kg` : `${Math.round(kg * LB * 10) / 10} lb`);
const perWeek = (kg: number, unit: 'metric' | 'imperial') => (unit === 'metric' ? `${Math.round(Math.abs(kg) * 100) / 100} kg/week` : `${Math.round(Math.abs(kg) * LB * 10) / 10} lb/week`);

export function readEvent(coachProfile: string | null): GoalEvent | null {
  const e = parse(coachProfile)?.goalEvent;
  return e && typeof e.date === 'string' ? e : null;
}

/** Everything a weight plan needs for one user, measured where possible. */
export async function goalInputs(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true, heightCm: true, dateOfBirth: true, coachProfile: true, goalWeightKg: true, unitPreference: true, timezone: true } });
  if (!u) throw new Error('User not found');
  const today = todayForTz(u.timezone);
  const from = addDays(today, -35);
  const [bw, meals] = await Promise.all([
    prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: from, lte: today } }, orderBy: { date: 'asc' }, select: { date: true, weightKg: true, weightLbs: true } }),
    prisma.mealEntry.groupBy({ by: ['date'], where: { userId, date: { gte: from, lte: today } }, _sum: { calories: true } }),
  ]);
  const weighIns = bw.map((r) => ({ date: r.date, kg: bodyWeightKg(r) ?? 0 })).filter((r) => r.kg > 0);
  const last7 = weighIns.filter((w) => w.date > addDays(today, -7));
  const currentKg = last7.length ? last7.reduce((s, w) => s + w.kg, 0) / last7.length : weighIns.length ? weighIns[weighIns.length - 1].kg : u.weightKg ?? null;
  const cp = parse(u.coachProfile);
  const fp = floorProfileFromRow(u);
  const maintenance = estimateMaintenance({
    weighIns, intake: meals.map((m) => ({ date: m.date, kcal: m._sum.calories ?? 0 })),
    bmr: mifflinBmr({ ...fp, weightKg: currentKg ?? fp.weightKg }), weightKg: currentKg,
    liftingDays: Number(cp.daysPerWeek) || 3, conditioningDays: Number(cp.conditioningDays) || 0, activityLevel: cp.activityLevel ?? null, today,
  });
  const floor = calorieFloorFor({ ...fp, weightKg: currentKg ?? fp.weightKg });
  return { today, currentKg, unit: (u.unitPreference === 'metric' ? 'metric' : 'imperial') as 'metric' | 'imperial', event: readEvent(u.coachProfile), goalWeightKg: u.goalWeightKg, maintenance, floorKcal: floor.floor, weighInsLogged: weighIns.length };
}

/** For a weigh-in: the date the walk-around weight must be reached (the acute protocol's start). */
export function dietDeadline(e: GoalEvent): string {
  return addDays(e.weighInDate ?? e.date, -(e.acuteStartsDaysOut ?? (e.kind === 'weigh_in' ? 7 : 0)));
}

/**
 * Where a daily intake lands for the user's event / goal date — the line every
 * calorie or macro card carries ("2,400 kcal → about 149 lb by Jan 4, a 2% acute cut").
 */
export async function projectionLine(userId: string, kcal: number): Promise<string | null> {
  try {
    const g = await goalInputs(userId);
    if (!g.currentKg) return null;
    const e = g.event;
    const by = e ? dietDeadline(e) : null;
    if (!by || by <= g.today) return null;
    const kg = projectKg(g.currentKg, kcal, g.maintenance.kcal, g.today, by);
    const target = e?.walkAroundKg ?? (e?.limitKg ? e.limitKg * 1.035 : g.goalWeightKg);
    let line = `At ${Math.round(kcal).toLocaleString()} kcal: about ${kgIn(kg, g.unit)} by ${by}`;
    if (target) line += ` (target ${kgIn(target, g.unit)})`;
    if (e?.limitKg) {
      const acute = (kg - e.limitKg) / kg;
      line += `, leaving a ${Math.max(0, Math.round(acute * 1000) / 10)}% acute cut${acute > ACUTE.warn ? ' — over the ~8% limit' : acute > ACUTE.ok ? ' — above the ~5% that’s manageable' : ''}`;
    }
    return `${line}. Maintenance ${g.maintenance.basis === 'measured' ? 'measured' : 'estimated'} at ~${g.maintenance.kcal.toLocaleString()} kcal.`;
  } catch { return null; }
}

/** The context block: the event, the countdown, the pace it needs, and the re-check rule. */
export async function goalContextLine(userId: string): Promise<string | null> {
  const g = await goalInputs(userId).catch(() => null);
  if (!g?.event) return null;
  const e = g.event;
  const days = Math.round(weeksBetween(g.today, e.weighInDate ?? e.date) * 7);
  const parts = [`${e.name ?? e.kind.replace('_', '-')} on ${e.date}${e.weighInDate ? `, weigh-in ${e.weighInDate}` : ''} (T-${days} days)`];
  if (e.limitKg) parts.push(`limit ${kgIn(e.limitKg, g.unit)}`);
  if (e.walkAroundKg) parts.push(`walk-around target ${kgIn(e.walkAroundKg, g.unit)} by ${dietDeadline(e)} (when their acute protocol starts)`);
  if (g.currentKg) parts.push(`now ${kgIn(g.currentKg, g.unit)} (7-day average, ${g.weighInsLogged} weigh-ins in 5 weeks)`);
  parts.push(`maintenance ~${g.maintenance.kcal} kcal (${g.maintenance.detail})`);
  if (e.acutePlan) parts.push(`their acute protocol (theirs and their team's — support it, never script it): ${e.acutePlan}`);
  return `Event — ${parts.join('; ')}. For any calorie, macro or pace question call plan_weight_goal; re-check the plan against their weigh-in trend every ~2 weeks and when they ask; never say targets stay the same all the way to the event.`;
}

defineOp({
  name: 'goal.set_event',
  run: async (userId, args) => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
    const cp = parse(u?.coachProfile);
    const before = cp.goalEvent ?? null;
    const next = args.event ? { ...(args.event as GoalEvent), setAt: new Date().toISOString() } : null;
    await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify({ ...cp, goalEvent: next }) } });
    return { result: { event: next }, inverse: { op: 'goal.set_event', args: { event: before } }, summary: next ? `Event · ${next.name ?? next.kind} · ${next.weighInDate ?? next.date}` : 'Event cleared' };
  },
});

export const GOAL_TOOLS = [
  tool({
    name: 'set_goal_event', kind: 'set', core: true, fn: 'GOL-01',
    description: 'Save a dated goal: a fight weigh-in, a competition, a race, a wedding — any deadline. For weight-class sports pass weighInDate, limit (the class limit), walkAroundTarget (where they need to be before their acute cut), acuteStartsDaysOut (how many days before the weigh-in their protocol starts) and acutePlan (their protocol in their words — water loading, sodium, etc.), with unit = the unit they used. It is stored whole, shown to you every turn with a countdown, and pinned in memory. Call it the moment they give an event; then plan_weight_goal.',
    input_schema: schema({
      kind: { type: 'string', enum: ['weigh_in', 'competition', 'race', 'deadline'] }, name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD of the event' },
      weighInDate: { type: 'string' }, limit: { type: 'number' }, walkAroundTarget: { type: 'number' }, unit: UNIT_FIELD,
      acuteStartsDaysOut: { type: 'number' }, acutePlan: { type: 'string' }, sport: { type: 'string' }, coach: { type: 'string' }, clear: { type: 'boolean' },
    }),
    receipt: (i) => ({ verb: 'Saved', text: `Event · ${str(i.name) || str(i.kind) || 'goal'}` }),
    execute: async (input, userId) => {
      if (input.clear === true) { const change = await executeOp(userId, 'goal.set_event', { event: null }); return { cleared: true, _change: change }; }
      const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null);
      const date = day(input.date) ?? day(input.weighInDate);
      if (!date) throw new Error('Give the event date as YYYY-MM-DD.');
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const unit = unitArg(input.unit, u?.unitPreference === 'metric' ? 'metric' : 'imperial');
      const toKg = (v: unknown) => (numOr(v) ? (unit === 'metric' ? numOr(v)! : numOr(v)! / LB) : null);
      const event: GoalEvent = {
        kind: (['weigh_in', 'competition', 'race', 'deadline'].includes(str(input.kind)) ? str(input.kind) : day(input.weighInDate) || numOr(input.limit) ? 'weigh_in' : 'deadline') as GoalEvent['kind'],
        name: str(input.name) || null, date, weighInDate: day(input.weighInDate), limitKg: toKg(input.limit), walkAroundKg: toKg(input.walkAroundTarget),
        acuteStartsDaysOut: numOr(input.acuteStartsDaysOut), acutePlan: str(input.acutePlan).slice(0, 4000) || null, sport: str(input.sport) || null, coach: str(input.coach) || null, setAt: '',
      };
      const change = await executeOp(userId, 'goal.set_event', { event });
      // Pinned, whole: the facts a fight week depends on can never age out of memory.
      await appendMemory(userId, `${event.name ?? 'Event'} ${event.weighInDate ? `weigh-in ${event.weighInDate}` : `on ${event.date}`}${event.limitKg ? `, limit ${kgIn(event.limitKg, unit)}` : ''}${event.walkAroundKg ? `, walk-around target ${kgIn(event.walkAroundKg, unit)}` : ''}${event.acutePlan ? `. Their acute protocol: ${event.acutePlan}` : ''}`, { pinned: true }).catch(() => {});
      return { saved: true, event: { ...event, limit: event.limitKg ? kgIn(event.limitKg, unit) : null, walkAround: event.walkAroundKg ? kgIn(event.walkAroundKg, unit) : null, dietDeadline: dietDeadline(event) }, next: 'Call plan_weight_goal and give them the recommended route with its timeline.', _change: change };
    },
    card: (_i, r): CardDraft | null => (r?.saved ? {
      fn: 'GOL-01', pattern: 'setting', rule: 'change_undo', meta: { label: 'Event' },
      rows: [
        { key: r.event.name ?? 'Event', value: r.event.weighInDate ?? r.event.date },
        ...(r.event.limit ? [{ key: 'Limit', value: r.event.limit }] : []),
        ...(r.event.walkAround ? [{ key: 'Walk-around target', value: r.event.walkAround, sub: `by ${r.event.dietDeadline}` }] : []),
      ],
      undoLine: 'Undone — event removed',
    } : null),
  }),
  tool({
    name: 'plan_weight_goal', kind: 'read', core: true, fn: 'GOL-02',
    description: 'Plan a weight goal for ANY user: where they are (7-day average), their maintenance (measured from weigh-ins + logged intake when there is enough, else estimated with all their training counted), and every SAFE pace with its daily calories, the date it gets there and — for weigh-ins — the acute cut it leaves. targetWeight + unit + byDate, or leave them out to use their saved event. Give the recommended route first with its timeline and why; if they want faster and it is listed, warn once with the real cost, then go with their choice; anything not listed is unsafe — never offer it, give the earliest safe date instead.',
    input_schema: schema({ targetWeight: { type: 'number' }, unit: UNIT_FIELD, byDate: { type: 'string' } }),
    receipt: () => ({ verb: 'Computed', text: 'Weight-goal plan' }),
    execute: async (input, userId) => {
      const g = await goalInputs(userId);
      if (!g.currentKg) return { needs: 'Their current weight — ask for it (and log it) first.' };
      const unit = unitArg(input.unit, g.unit);
      const e = g.event;
      const targetKg = numOr(input.targetWeight) ? (unit === 'metric' ? numOr(input.targetWeight)! : numOr(input.targetWeight)! / LB)
        : e?.walkAroundKg ?? (e?.limitKg ? e.limitKg * 1.035 : g.goalWeightKg);
      const byDate = /^\d{4}-\d{2}-\d{2}$/.test(str(input.byDate)) ? str(input.byDate) : e ? dietDeadline(e) : null;
      if (!targetKg || !byDate) return { needs: 'A target weight and a date (or save their event with set_goal_event).' };
      const plan = planPace({ today: g.today, currentKg: g.currentKg, targetKg, byDate, tdee: g.maintenance.kcal, floorKcal: g.floorKcal, weighIn: e?.limitKg ? { limitKg: e.limitKg, date: e.weighInDate ?? e.date } : null });
      const fmt = (o: typeof plan.recommended) => ({
        route: o.label, pace: `${perWeek(o.kgPerWeek, g.unit)} (${Math.round(Math.abs(o.pctPerWeek) * 1000) / 10}% of body weight)`, band: o.band,
        dailyCalories: o.kcal, ...(o.floored ? { flooredAt: 'the safe minimum — slower than the label' } : {}),
        weightOnDate: kgIn(o.kgOnDate, g.unit), reachesTarget: o.reachesOn, ...(o.acuteFraction != null ? { acuteCutLeft: `${Math.round(o.acuteFraction * 1000) / 10}%` } : {}),
      });
      return {
        now: kgIn(g.currentKg, g.unit), target: kgIn(targetKg, g.unit), byDate, weeks: plan.weeks,
        required: { pace: `${perWeek(plan.required.kgPerWeek, g.unit)} (${Math.round(Math.abs(plan.required.pctPerWeek) * 1000) / 10}%/wk)`, band: plan.required.band },
        maintenance: `${g.maintenance.kcal} kcal (${g.maintenance.detail})`,
        recommended: fmt(plan.recommended), safeOptions: plan.options.map(fmt),
        unreachableSafely: plan.unreachableSafely, earliestSafeDate: plan.earliestSafeDate, notes: plan.notes,
        howToAnswer: 'Lead with the recommended route, its daily calories and the date it lands. If they want a faster listed option, give its cost in one sentence (strength/power, recovery, hunger) and then do it. Never offer anything faster than the listed options. For a weigh-in, keep the acute cut at or under ~5% and remind them the acute protocol is theirs and their team’s.',
      };
    },
  }),
];
registerToolkit(GOAL_TOOLS);
