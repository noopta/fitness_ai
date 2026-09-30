// Nutrition targets & insight (NTP-01…12), body weight (BW-01…03), wellness
// (WEL-01…02), memory (MEM-01…03, 05, 06) and streaks (STK-01…02).

import { registerToolkit } from '../registry.js';
import { defineOp, executeOp, UNDO_DELETE_MS } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, str, numOr, prisma, parseJson } from './kit.js';
import { applyMacroChange } from '../applyTools.js';
import { logBodyWeight, deleteBodyWeight, restoreBodyWeight, removeBodyWeightOn } from '../../services/bodyWeightService.js';
import { upsertCheckin, revertCheckin } from '../../services/wellnessService.js';
import { readMemory, appendMemory, replaceMemory } from '../memory.js';
import { mergeBlobKeys, parseBlob } from '../profile/coachProfile.js';
import { cacheDelete, cacheClearByPrefix } from '../../services/cacheService.js';
import { dayNutrition } from './nutrition.js';
import { bodyWeight, dayLabel, kgTo, toKg, num, plural, shiftDate } from '../cards/format.js';
import type { CardDraft, CardRow } from '../cards/types.js';
import type { ToolCtx } from '../types.js';

const ctxOf = async (userId: string): Promise<ToolCtx> => (await import('../turn.js')).toolCtx(userId);

// ── Ops ──────────────────────────────────────────────────────────────────────
defineOp({
  name: 'nutrition.set_macros',
  run: async (userId, args) => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, dailyCalorieTarget: true } });
    const prev = parseJson<any>(u?.savedProgram, null)?.nutritionPlan?.macros;
    if (!prev) throw new Error('There’s no nutrition plan to change yet.');
    const change = args.change as Record<string, number>;
    const r = await applyMacroChange(userId, change);
    cacheClearByPrefix(`nutrition_profile:${userId}`);
    const lines = Object.keys(change).map((k) => `${LABEL[k]} · ${num(prev[k])}${UNIT[k]} → ${num(r.macros[k as keyof typeof r.macros] as number)}${UNIT[k]}`);
    return { result: r, inverse: { op: 'nutrition.restore_macros', args: { macros: Object.fromEntries(Object.keys(change).map((k) => [k, prev[k]])), dailyCalorieTarget: u?.dailyCalorieTarget ?? null } }, summary: `Targets · ${lines.join('; ')}` };
  },
});
defineOp({
  name: 'nutrition.restore_macros',
  run: async (userId, args) => {
    await applyMacroChange(userId, args.macros as any);
    // applyMacroChange mirrors calories into dailyCalorieTarget; put the user's own value back.
    await prisma.user.update({ where: { id: userId }, data: { dailyCalorieTarget: (args.dailyCalorieTarget as number | null) ?? null } });
    return { inverse: null, summary: 'Targets restored' };
  },
});
const LABEL: Record<string, string> = { calories: 'Calories', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' };
const UNIT: Record<string, string> = { calories: ' kcal', proteinG: ' g', carbsG: ' g', fatG: ' g' };

defineOp({
  name: 'nutrition.generate_plan',
  run: async (userId) => {
    const r: any = await callApi(userId, 'POST', '/nutrition/plan/generate', {});
    return { result: { planId: r.planId, focus: (r.plan?.focusNutrients ?? []).map((f: any) => f.label) }, inverse: r.planId ? { op: 'nutrition.remove_plan', args: { id: r.planId } } : null, summary: 'New nutrition plan saved' };
  },
});
defineOp({
  name: 'nutrition.remove_plan',
  run: async (userId, args) => {
    await prisma.nutritionPlan.deleteMany({ where: { id: String(args.id), userId } });
    cacheClearByPrefix(`nutrition_profile:${userId}`);
    return { inverse: null, summary: 'Previous nutrition plan is current again' };
  },
});

// Gut & nutrition assessment as a Flow: one question per card.
interface Q { key: string; q: string; options: { label: string; value: unknown }[]; typeInstead?: boolean; set: (a: Record<string, any>, v: unknown) => void }
const Q: Q[] = [
  { key: 'mealsPerDay', q: 'How many times do you eat on a typical day?', options: [{ label: '1–2', value: 2 }, { label: '3', value: 3 }, { label: '4–5', value: 5 }, { label: '6 or more', value: 6 }], set: (a, v) => { a.mealsPerDay = v; } },
  { key: 'orderOutPerWeek', q: 'How often do you order takeout or eat out?', options: [{ label: 'Rarely', value: 0 }, { label: '1–2 a week', value: 2 }, { label: '3–5 a week', value: 4 }, { label: 'Most days', value: 7 }], set: (a, v) => { a.orderOutPerWeek = v; } },
  { key: 'bloating', q: 'How often do you feel bloated after eating?', options: [{ label: 'Never', value: 'never' }, { label: 'Sometimes', value: 'sometimes' }, { label: 'Often', value: 'often' }], set: (a, v) => { a.digestion = { ...(a.digestion ?? {}), bloating: v }; } },
  { key: 'regularity', q: 'Are you regular?', options: [{ label: 'Yes', value: 'regular' }, { label: 'Not really', value: 'irregular' }], set: (a, v) => { a.digestion = { ...(a.digestion ?? {}), regularity: v }; } },
  { key: 'intolerances', q: 'Any foods that bother you?', options: [{ label: 'None', value: [] }, { label: 'Dairy', value: ['dairy'] }, { label: 'Gluten', value: ['gluten'] }, { label: 'Beans or onions', value: ['legumes', 'onion'] }], typeInstead: true, set: (a, v) => { a.digestion = { ...(a.digestion ?? {}), intolerances: Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 15) }; } },
  { key: 'afternoonCrashes', q: 'Do you crash in the afternoon?', options: [{ label: 'Most days', value: true }, { label: 'Rarely', value: false }], set: (a, v) => { a.energy = { ...(a.energy ?? {}), afternoonCrashes: v }; } },
  { key: 'caffeinePerDay', q: 'How much coffee or other caffeine a day?', options: [{ label: 'None', value: 0 }, { label: '1–2 drinks', value: 2 }, { label: '3–4', value: 4 }, { label: '5 or more', value: 5 }], set: (a, v) => { a.energy = { ...(a.energy ?? {}), caffeinePerDay: v }; } },
  { key: 'alcoholPerWeek', q: 'Drinks of alcohol a week?', options: [{ label: 'None', value: 0 }, { label: '1–3', value: 2 }, { label: '4–7', value: 6 }, { label: '8 or more', value: 10 }], set: (a, v) => { a.energy = { ...(a.energy ?? {}), alcoholPerWeek: v }; } },
  { key: 'sleepQualityLow', q: 'How do you usually sleep?', options: [{ label: 'Well', value: false }, { label: 'Badly', value: true }], set: (a, v) => { a.sleepQualityLow = v; } },
  { key: 'fermentedPerWeek', q: 'Fermented foods (yogurt, kefir, kimchi) a week?', options: [{ label: 'None', value: 0 }, { label: '1–2', value: 2 }, { label: '3–5', value: 4 }, { label: 'Daily', value: 7 }], set: (a, v) => { a.fermentedPerWeek = v; } },
  { key: 'dietaryStyle', q: 'How do you eat?', options: [{ label: 'Everything', value: 'omnivore' }, { label: 'Pescatarian', value: 'pescatarian' }, { label: 'Vegetarian', value: 'vegetarian' }, { label: 'Vegan', value: 'vegan' }], set: (a, v) => { a.dietaryStyle = v; } },
  { key: 'goals', q: 'What should food do for you most?', options: [{ label: 'More energy', value: ['energy'] }, { label: 'Calmer gut', value: ['gut_comfort'] }, { label: 'Better recovery', value: ['recovery'] }, { label: 'Better sleep', value: ['sleep'] }], set: (a, v) => { a.goals = v; } },
  { key: 'medicalFlags', q: 'Any diagnosed digestive condition?', options: [{ label: 'None', value: [] }, { label: 'IBS', value: ['ibs'] }, { label: 'Reflux', value: ['gerd'] }, { label: 'Coeliac or IBD', value: ['celiac_or_ibd'] }], typeInstead: true, set: (a, v) => { a.medicalFlags = Array.isArray(v) ? v : [String(v).slice(0, 120)]; } },
];
function flowCard(step: number, answers: Record<string, any>, done: [string, string][]): CardDraft {
  const q = Q[step];
  return {
    fn: 'NTP-04', pattern: 'flow', rule: 'change_undo', meta: { label: `Gut and nutrition · ${step + 1} of ${Q.length}` },
    step: { i: step + 1, n: Q.length, done: done.slice(-3) },
    ask: { q: q.q, options: q.options.map((o) => o.label), typeInstead: !!q.typeInstead },
    actions: [{ id: 'pause', label: 'Pause', kind: 'secondary' }],
    pending: { answer: { op: 'assessment.answer', args: { step, answers, done }, valueKey: 'value' }, actions: { pause: { kind: 'dismiss', line: 'Paused — say “carry on with my gut questions” to resume' } } },
  };
}
defineOp({
  name: 'assessment.answer',
  run: async (userId, args) => {
    const step = Number(args.step);
    const answers = { ...(args.answers as Record<string, any>) };
    const q = Q[step];
    const idx = typeof args.optionIndex === 'number' ? args.optionIndex : -1;
    const value = idx >= 0 && q.options[idx] ? q.options[idx].value : args.value;
    q.set(answers, value);
    const done = [...(args.done as [string, string][]), [q.q.replace(/\?$/, ''), String(args.value)]] as [string, string][];
    if (step + 1 < Q.length) return { result: { nextCard: flowCard(step + 1, answers, done) }, inverse: null, summary: `Answered · ${q.key}` };
    await callApi(userId, 'POST', '/nutrition/assessment', answers);
    const nextCard: CardDraft = {
      fn: 'NTP-04', pattern: 'setting', rule: 'change_undo', meta: { label: 'Gut and nutrition · done' },
      rows: done.slice(-4).map(([k, v]) => ({ key: k, value: v })), note: 'Saved. Your plan builds from these answers and what you log.',
      actions: [{ id: 'build', label: 'Build my nutrition plan', kind: 'primary', client: { action: 'send_message', args: { text: 'Build my nutrition plan from my answers.' } } }],
    };
    return { result: { nextCard }, inverse: null, summary: 'Gut assessment saved' };
  },
});

defineOp({
  name: 'weight.log',
  run: async (userId, args) => {
    const r = await logBodyWeight(userId, { date: String(args.date), weightKg: Number(args.weightKg), notes: args.notes ? String(args.notes) : undefined });
    await prisma.user.update({ where: { id: userId }, data: { weightKg: Number(args.weightKg) } }).catch(() => {});
    return { result: { entry: r.entry, warnings: r.warnings }, inverse: r.before ? { op: 'weight.restore', args: { row: r.before } } : { op: 'weight.remove_on', args: { date: String(args.date) } }, summary: `Weigh-in · ${String(args.display)}` };
  },
});
defineOp({ name: 'weight.restore', run: async (userId, args) => { await restoreBodyWeight(userId, args.row); return { inverse: null, summary: 'Weigh-in restored' }; } });
defineOp({ name: 'weight.remove_on', run: async (userId, args) => { await removeBodyWeightOn(userId, String(args.date)); return { inverse: null, summary: 'Weigh-in removed' }; } });
defineOp({
  name: 'weight.delete', undoMs: UNDO_DELETE_MS,
  run: async (userId, args) => {
    const row = await deleteBodyWeight(userId, String(args.id));
    if (!row) throw new Error('That weigh-in is already gone.');
    return { inverse: { op: 'weight.restore', args: { row } }, summary: `Removed weigh-in · ${dayLabel(row.date)}` };
  },
});
// Inline correction of a weigh-in value on the Logged card (user's unit).
defineOp({
  name: 'weight.edit',
  run: async (userId, args) => {
    const unit = (args.unit as 'metric' | 'imperial') ?? 'imperial';
    const kg = toKg(unit, Number(args.value));
    const r = await logBodyWeight(userId, { date: String(args.date), weightKg: kg });
    return { result: { display: bodyWeight(unit, kg) }, inverse: r.before ? { op: 'weight.restore', args: { row: r.before } } : null, summary: `Weigh-in corrected · ${bodyWeight(unit, kg)}` };
  },
});

defineOp({
  name: 'wellness.log',
  run: async (userId, args) => {
    const r = await upsertCheckin(userId, args.input as any);
    return { result: { checkin: r.checkin }, inverse: { op: 'wellness.revert', args: { date: (args.input as any).date, before: r.before } }, summary: `Check-in · sleep ${(args.input as any).sleepHours} h` };
  },
});
defineOp({ name: 'wellness.revert', run: async (userId, args) => { await revertCheckin(userId, String(args.date), args.before ?? null); return { inverse: null, summary: 'Check-in undone' }; } });

defineOp({
  name: 'memory.add',
  run: async (userId, args) => {
    const before = await readMemory(userId);
    await appendMemory(userId, String(args.note));
    return { inverse: { op: 'memory.set', args: { notes: before } }, summary: `Noted · ${String(args.note).slice(0, 80)}` };
  },
});
defineOp({
  name: 'memory.set',
  run: async (userId, args) => {
    const before = await readMemory(userId);
    await replaceMemory(userId, args.notes as string[]);
    cacheDelete(`userctx:${userId}`);
    return { inverse: { op: 'memory.set', args: { notes: before } }, summary: String(args.summary ?? 'Memory updated') };
  },
});

// ── Tools ────────────────────────────────────────────────────────────────────
export const HEALTH_TOOLS = [
  tool({
    name: 'read_nutrition_plan', kind: 'read', core: true, fn: 'NTP-01',
    description: 'The user’s nutrition targets (calories, protein, carbs, fat), why, projected weight change, and their gut / micronutrient plan if they have one.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Nutrition plan' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
      const np = parseJson<any>(u?.savedProgram, null)?.nutritionPlan ?? null;
      const gut: any = await callApi(userId, 'GET', '/nutrition/plan').catch(() => null);
      return { macros: np?.macros ?? null, rationale: np?.rationale ?? null, outcomes: np?.expectedOutcomes ?? null, gutPlan: gut ? { summary: gut.plan?.summary, focus: (gut.plan?.focusNutrients ?? []).map((f: any) => f.label), generatedAt: gut.generatedAt } : null };
    },
    card: (_i, r, ctx) => {
      if (!r.macros) return { fn: 'NTP-01', pattern: 'glance', rule: 'show', meta: { label: 'Targets' }, empty: 'No targets yet — they come with your program.' };
      const wk = r.outcomes?.weeklyWeightChangeLb;
      return { fn: 'NTP-01', pattern: 'glance', rule: 'show', meta: { label: 'Daily targets', open: { page: 'fuel' } },
        hero: { value: num(r.macros.calories), unit: 'kcal' },
        rows: [{ key: 'Protein', value: `${num(r.macros.proteinG)} g` }, { key: 'Carbs', value: `${num(r.macros.carbsG)} g` }, { key: 'Fat', value: `${num(r.macros.fatG)} g` },
          ...(wk != null ? [{ key: 'Projected', value: `${wk > 0 ? '+' : '−'}${bodyWeight(ctx.unit, Math.abs(wk) * 0.45359237)} a week` }] : []),
          ...(r.gutPlan?.focus?.length ? [{ key: 'Focus nutrients', value: r.gutPlan.focus.slice(0, 3).join(', ') }] : [])],
        ...(r.rationale ? { why: String(r.rationale).slice(0, 220) } : {}),
        actions: [{ id: 'change', label: 'Change', kind: 'secondary', client: { action: 'send_message', args: { text: 'I want to change my macro targets.' } } }] };
    },
  }),
  tool({
    name: 'propose_macro_change', kind: 'propose', core: true, fn: 'NTP-02',
    description: 'Propose new daily targets the user asked for (absolute values: calories, proteinG, carbsG, fatG — only what changes). The card shows old → new and the projected weekly change; the user applies it. Undo restores the old targets.',
    input_schema: schema({ calories: { type: 'number' }, proteinG: { type: 'number' }, carbsG: { type: 'number' }, fatG: { type: 'number' }, why: { type: 'string' } }),
    receipt: () => ({ verb: 'Proposed', text: 'New targets' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
      const np = parseJson<any>(u?.savedProgram, null)?.nutritionPlan;
      if (!np?.macros) throw new Error('There’s no nutrition plan to change yet.');
      const change = Object.fromEntries(['calories', 'proteinG', 'carbsG', 'fatG'].filter((k) => numOr(input[k]) != null).map((k) => [k, Math.round(numOr(input[k])!)]));
      if (!Object.keys(change).length) throw new Error('Say which targets to change.');
      const tdee = np.expectedOutcomes?.tdee;
      const kcal = (change.calories ?? np.macros.calories) as number;
      return { change, before: np.macros, weeklyLb: tdee ? Math.round((((kcal - tdee) * 7) / 3500) * 10) / 10 : null, why: str(input.why) };
    },
    card: (_i, r, ctx) => ({
      fn: 'NTP-02', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · daily targets', open: { page: 'fuel' } },
      diff: Object.keys(r.change).map((k) => ({ key: LABEL[k], from: `${num(r.before[k])}${UNIT[k]}`, to: `${num(r.change[k])}${UNIT[k]}` })),
      why: [r.why, r.weeklyLb != null ? `Projected ${r.weeklyLb > 0 ? '+' : '−'}${bodyWeight(ctx.unit, Math.abs(r.weeklyLb) * 0.45359237)} a week.` : ''].filter(Boolean).join(' '),
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
      entity: 'nutrition:targets',
      pending: { actions: { apply: { op: 'nutrition.set_macros', args: { change: r.change } }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'start_nutrition_assessment', kind: 'set', fn: 'NTP-04',
    description: 'Start the 13-question gut and nutrition assessment (one question per card; answers save at the end and feed the nutrition plan).',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Started', text: 'Gut and nutrition questions' }),
    execute: async () => ({ steps: Q.length }),
    card: () => flowCard(0, {}, []),
  }),
  tool({
    name: 'propose_nutrition_plan', kind: 'propose', fn: 'NTP-05',
    description: 'Build or refresh the user’s gut and micronutrient plan (focus nutrients, gut protocol, supplements, sources) from their assessment, diet and recent logs. Suggest the assessment first if they haven’t done it. Applies on tap; the old plan stays in history and Undo brings it back.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Proposed', text: 'Nutrition plan' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
      const has = !!parseBlob(u?.coachProfile).nutrition;
      const cur: any = await callApi(userId, 'GET', '/nutrition/plan').catch(() => null);
      return { hasAssessment: has, current: cur ? (cur.plan?.focusNutrients ?? []).map((f: any) => f.label) : null };
    },
    card: (_i, r) => r.hasAssessment
      ? { fn: 'NTP-05', pattern: 'proposal', rule: 'propose', meta: { label: r.current ? 'Refresh nutrition plan' : 'Build nutrition plan', open: { page: 'fuelplan' } },
          rows: [{ key: 'From', value: 'Your answers, diet and the last 7 days of logs' }, ...(r.current ? [{ key: 'Current focus', value: r.current.slice(0, 3).join(', ') }] : [])],
          why: 'Focus nutrients, a gut protocol and where food alone falls short, with sources.',
          actions: [{ id: 'apply', label: r.current ? 'Refresh plan' : 'Build plan', kind: 'primary' }, { id: 'keep', label: 'Not now', kind: 'secondary' }],
          pending: { actions: { apply: { op: 'nutrition.generate_plan', args: {}, line: 'Plan saved' }, keep: { kind: 'keep' } } } }
      : { fn: 'NTP-05', pattern: 'glance', rule: 'show', meta: { label: 'Nutrition plan' }, empty: 'It builds from 13 quick questions first.', actions: [{ id: 'start', label: 'Answer the questions', kind: 'primary', client: { action: 'send_message', args: { text: 'Start my gut and nutrition questions.' } } }] },
  }),
  tool({
    name: 'read_micro_status', kind: 'read', fn: 'NTP-06',
    description: 'Micronutrients for a day (default today) against targets: each nutrient’s % of target and status, focus nutrients first.',
    input_schema: schema({ date: { type: 'string' } }),
    receipt: () => ({ verb: 'Computed', text: 'Micronutrients' }),
    execute: async (input, userId) => callApi(userId, 'GET', `/nutrition/micros/daily${/^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? `?date=${str(input.date)}` : ''}`),
    card: (_i, r: any) => {
      const list = [...(r.nutrients ?? [])].sort((a: any, b: any) => Number(b.focus) - Number(a.focus) || a.pct - b.pct).slice(0, 8);
      if (!r.mealsLogged) return { fn: 'NTP-06', pattern: 'glance', rule: 'show', meta: { label: 'Micronutrients' }, empty: 'Log a meal and your nutrients fill in.' };
      return { fn: 'NTP-06', pattern: 'glance', rule: 'show', meta: { label: 'Micronutrients · today', open: { page: 'micros' } },
        bars: { v: list.map((n: any) => Math.min(150, n.pct)), labels: list.map((n: any) => n.label), hi: list.findIndex((n: any) => n.status !== 'ok') },
        rows: list.map((n: any) => ({ key: n.label, value: `${n.pct}%`, sub: `${num(n.actual, 1)} of ${num(n.target, 1)} ${n.unit}${n.direction === 'limit' ? ' limit' : ''}`, mark: n.status === 'ok' ? undefined : 'chg' as const })),
        note: 'Estimates, ±30%.' };
    },
  }),
  tool({
    name: 'read_gut_week', kind: 'read', fn: 'NTP-07',
    description: 'The 7-day gut score: fiber, plant variety (count toward 30), fermented foods, ultra-processed foods and meal rhythm.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Computed', text: 'Gut week' }),
    execute: async (_i, userId) => callApi(userId, 'GET', '/nutrition/gut/week'),
    card: (_i, r: any) => ({ fn: 'NTP-07', pattern: 'glance', rule: 'show', meta: { label: `Gut week · ${r.days} ${r.days === 1 ? 'day' : 'days'} logged`, open: { page: 'gut' } },
      hero: { value: String(r.overall ?? '—'), unit: 'of 100' },
      rows: [{ key: 'Plants this week', value: `${r.plantCount} of ${r.plantTarget}` }, ...(r.pillars ?? []).map((p: any) => ({ key: p.label, value: `${p.score}`, sub: p.detail, mark: p.status === 'ok' ? undefined : 'chg' as const }))],
      note: 'Estimates, ±30%.' }),
  }),
  tool({
    name: 'read_nutrition_profile', kind: 'read', fn: 'NTP-08',
    description: 'How the user’s diet affects their body. view: overview (systems — recovery, energy, sleep, mood, cognition — and the top food move), system (one system’s drivers; pass systemId), nutrient (one nutrient: current vs target, why, sources; pass key), meal (per-ingredient breakdown; pass mealId), trend (coverage over 7 or 30 days). range today | 7d | 30d.',
    input_schema: schema({ view: { type: 'string', enum: ['overview', 'system', 'nutrient', 'meal', 'trend'] }, range: { type: 'string', enum: ['today', '7d', '30d'] }, systemId: { type: 'string' }, key: { type: 'string' }, mealId: { type: 'string' } }),
    receipt: (i) => ({ verb: 'Computed', text: i.view === 'nutrient' ? `Nutrient · ${str(i.key)}` : i.view === 'system' ? `System · ${str(i.systemId)}` : 'Diet and your body' }),
    execute: async (input, userId) => {
      const range = ['today', '7d', '30d'].includes(str(input.range)) ? str(input.range) : '7d';
      const view = str(input.view) || 'overview';
      const path = view === 'system' ? `/nutrition-profile/effect/${encodeURIComponent(str(input.systemId))}?range=${range}`
        : view === 'nutrient' ? `/nutrition-profile/nutrient/${encodeURIComponent(str(input.key))}?range=${range}`
        : view === 'meal' ? `/nutrition-profile/meal/${encodeURIComponent(str(input.mealId))}`
        : view === 'trend' ? `/nutrition-profile/trend?range=${range === 'today' ? '7d' : range}`
        : `/nutrition-profile?range=${range}`;
      return { view, range, data: await callApi(userId, 'GET', path) };
    },
    card: (_i, r): CardDraft => {
      const d: any = r.data;
      if (r.view === 'overview') {
        if (!d.hasData) return { fn: 'NTP-08', pattern: 'glance', rule: 'show', meta: { label: 'Diet and your body' }, empty: 'Log a few meals and this fills in.' };
        return { fn: 'NTP-08', pattern: 'glance', rule: 'show', meta: { label: `Diet and your body · ${r.range === 'today' ? 'today' : r.range}`, open: { page: 'systems' } }, hero: { value: String(d.profileScore ?? '—'), unit: 'score' },
          rows: (d.systems ?? []).map((s: any) => ({ key: s.name, value: String(s.score), sub: s.driver })), ...(d.topMove ? { why: `${d.topMove.title}. ${d.topMove.mechanism}` } : {}) };
      }
      if (r.view === 'system') return { fn: 'NTP-08', pattern: 'glance', rule: 'show', meta: { label: d.name ?? 'System', open: { page: 'sys', params: { id: d.systemId } } }, hero: { value: String(d.score ?? '—'), unit: 'score' }, rows: (d.drivers ?? []).slice(0, 6).map((x: any) => ({ key: x.label, value: `${x.pct}%`, mark: x.status === 'ok' ? undefined : 'chg' as const })), ...(d.summary ? { why: d.summary } : {}) };
      if (r.view === 'nutrient') return { fn: 'NTP-09', pattern: 'glance', rule: 'show', meta: { label: d.label ?? 'Nutrient', open: { page: 'mic', params: { key: d.key } } }, hero: { value: `${d.pct ?? '—'}%`, unit: 'of target' }, rows: [{ key: 'Now', value: `${d.current} ${d.unit}` }, { key: 'Target', value: `${d.target} ${d.unit}` }, ...(d.sources ?? []).slice(0, 4).map((s: any) => ({ key: s.food, value: s.amount }))], ...(d.why ? { why: String(d.why).slice(0, 240) } : {}) };
      if (r.view === 'meal') return { fn: 'NTP-11', pattern: 'glance', rule: 'show', meta: { label: d.name ?? 'Meal' }, rows: (d.ingredients ?? []).slice(0, 10).map((x: any) => ({ key: x.name, value: (x.chips ?? []).slice(0, 2).join(', ') || '—' })) };
      return { fn: 'NTP-12', pattern: 'glance', rule: 'show', meta: { label: `Coverage · ${d.range}` }, line: (d.series ?? []).map((x: any) => x.coveragePct ?? 0), rows: (d.consistency ?? []).slice(0, 5).map((x: any) => ({ key: x.label, value: `${x.pctDaysOnTarget}% of days` })) };
    },
  }),
  tool({
    name: 'read_food_recommendations', kind: 'read', fn: 'NTP-10',
    description: 'Up to 8 foods that would close the user’s nutrient gaps, each with a serving and why. The card can log one.',
    input_schema: schema({ range: { type: 'string', enum: ['today', '7d', '30d'] } }),
    receipt: () => ({ verb: 'Computed', text: 'Foods for your gaps' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const d: any = await callApi(userId, 'GET', `/nutrition-profile/recommendations?range=${['today', '7d', '30d'].includes(str(input.range)) ? str(input.range) : '7d'}`);
      return { recs: (d.recommendations ?? []).slice(0, 6), date: ctx.today };
    },
    card: (_i, r) => r.recs.length
      ? { fn: 'NTP-10', pattern: 'glance', rule: 'show', meta: { label: 'Foods to close your gaps' },
          rows: r.recs.map((x: any, i: number) => ({ key: x.name, value: x.serving, sub: x.gain ?? x.mechanism, action: `log${i}` })),
          actions: r.recs.slice(0, 4).map((x: any, i: number) => ({ id: `log${i}`, label: `Log ${x.name}`.slice(0, 32), kind: 'secondary' as const, client: { action: 'send_message' as const, args: { text: `Log ${x.prefill?.name ?? x.name}.` } } })) }
      : { fn: 'NTP-10', pattern: 'glance', rule: 'show', meta: { label: 'Foods to close your gaps' }, empty: 'No gaps to close — nice.' },
  }),

  // ── Body weight ──
  tool({
    name: 'log_body_weight', kind: 'log', core: true, fn: 'BW-01',
    description: 'Log a weigh-in in the user’s unit (one per day — a second one that day replaces the first). Log it the moment they say it.',
    input_schema: schema({ weight: { type: 'number' }, date: { type: 'string' }, notes: { type: 'string' } }, ['weight']),
    receipt: (i) => ({ verb: 'Logged', text: `Weigh-in · ${i.weight}` }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today;
      const kg = toKg(ctx.unit, Number(input.weight));
      const change = await executeOp(userId, 'weight.log', { date, weightKg: kg, notes: str(input.notes) || null, display: bodyWeight(ctx.unit, kg) });
      const r = change.result as any;
      return { logged: change.summary, date, weightKg: kg, warnings: r.warnings, _change: change };
    },
    card: async (_i, r, ctx) => {
      const logs = await prisma.bodyWeightLog.findMany({ where: { userId: ctx.userId, date: { gte: shiftDate(r.date, -13), lte: r.date } }, orderBy: { date: 'asc' }, select: { date: true, weightKg: true } });
      const last7 = logs.filter((l) => l.date > shiftDate(r.date, -7)).map((l) => l.weightKg ?? 0).filter(Boolean);
      const prev7 = logs.filter((l) => l.date <= shiftDate(r.date, -7)).map((l) => l.weightKg ?? 0).filter(Boolean);
      const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const a7 = avg(last7), p7 = avg(prev7);
      return {
        fn: 'BW-01', pattern: 'logged', rule: 'log_undo', meta: { label: `Weigh-in · ${r.date === ctx.today ? 'today' : dayLabel(r.date)}`, open: { page: 'body' } },
        rows: [{ key: 'Weight', value: bodyWeight(ctx.unit, r.weightKg), editable: { field: 'w', kind: 'number' } }, ...(a7 ? [{ key: '7-day average', value: bodyWeight(ctx.unit, a7) }] : [])],
        line: logs.map((l) => Math.round((kgTo(ctx.unit, l.weightKg ?? 0) ?? 0) * 10) / 10),
        ...(a7 && p7 ? { note: `${a7 < p7 ? 'Down' : 'Up'} ${bodyWeight(ctx.unit, Math.abs(a7 - p7))} on the week.` } : {}),
        ...(r.warnings?.length ? { why: r.warnings[0] } : {}),
        pending: { edits: { w: { op: 'weight.edit', args: { date: r.date, unit: ctx.unit }, valueKey: 'value', parse: 'number' } } },
        undoLine: 'Undone — weigh-in removed',
      };
    },
  }),
  tool({
    name: 'read_body_weight_trend', kind: 'read', core: true, fn: 'BW-02',
    description: 'Body-weight trend over a window (default 30 days, up to 180): weigh-ins, weekly change, projection.',
    input_schema: schema({ days: { type: 'number' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Weight trend' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const days = Math.min(180, Math.max(7, Math.round(numOr(input.days, 30)!)));
      const logs = await prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: shiftDate(ctx.today, -days) } }, orderBy: { date: 'asc' }, select: { id: true, date: true, weightKg: true } });
      const pts = logs.filter((l) => l.weightKg);
      let perWeekKg: number | null = null;
      if (pts.length >= 4) {
        const n = pts.length, xs = pts.map((p) => new Date(p.date).getTime() / 86400000), ys = pts.map((p) => p.weightKg!);
        const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
        const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0));
        perWeekKg = slope * 7;
      }
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { goalWeightKg: true } });
      return { days, entries: pts.map((p) => ({ id: p.id, date: p.date, weightKg: p.weightKg })), perWeekKg, goalWeightKg: u?.goalWeightKg ?? null };
    },
    card: (_i, r, ctx) => {
      if (!r.entries.length) return { fn: 'BW-02', pattern: 'glance', rule: 'show', meta: { label: 'Weight' }, empty: 'No weigh-ins yet.', rows: [{ key: 'Log today', value: ctx.unit === 'metric' ? 'kg' : 'lb', editable: { field: 'w', kind: 'number' } }], pending: { edits: { w: { op: 'weight.edit', args: { date: ctx.today, unit: ctx.unit }, valueKey: 'value', parse: 'number' } } } };
      const last = r.entries[r.entries.length - 1];
      return {
        fn: 'BW-02', pattern: 'glance', rule: 'show', meta: { label: `Weight · ${r.days} days`, open: { page: 'body' } },
        hero: { value: bodyWeight(ctx.unit, last.weightKg).replace(/ (kg|lb)$/, ''), unit: ctx.unit === 'metric' ? 'kg' : 'lb', ...(r.perWeekKg != null ? { delta: `${r.perWeekKg < 0 ? '−' : '+'}${(kgTo(ctx.unit, Math.abs(r.perWeekKg)) ?? 0).toFixed(1)} a week` } : {}) },
        line: r.entries.map((e: any) => Math.round((kgTo(ctx.unit, e.weightKg) ?? 0) * 10) / 10),
        rows: [{ key: 'Weigh-ins', value: String(r.entries.length) }, ...(r.goalWeightKg ? [{ key: 'Goal', value: bodyWeight(ctx.unit, r.goalWeightKg) }] : [])],
      };
    },
  }),
  tool({
    name: 'delete_body_weight', kind: 'confirm', fn: 'BW-03',
    description: 'Remove a weigh-in (by date, default the latest). Undo for 30 seconds.',
    input_schema: schema({ date: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Weigh-in to remove' }),
    execute: async (input, userId) => {
      const row = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date))
        ? await prisma.bodyWeightLog.findFirst({ where: { userId, date: str(input.date) } })
        : await prisma.bodyWeightLog.findFirst({ where: { userId }, orderBy: { date: 'desc' } });
      if (!row) throw new Error('No weigh-in on that date.');
      const ctx = await ctxOf(userId);
      return { id: row.id, date: row.date, display: bodyWeight(ctx.unit, row.weightKg) };
    },
    card: (_i, r) => ({ fn: 'BW-03', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Remove weigh-in' }, lose: { items: [`${r.display} on ${dayLabel(r.date)}`] },
      actions: [{ id: 'delete', label: 'Remove', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }],
      pending: { actions: { delete: { op: 'weight.delete', args: { id: r.id }, status: 'deleted', line: 'Removed · Undo' }, keep: { kind: 'keep' } } } }),
  }),

  // ── Wellness ──
  tool({
    name: 'log_wellness', kind: 'log', core: true, fn: 'WEL-01',
    description: 'Log a check-in (one per day; a second replaces the first): sleepHours, mood 1–5, energy 1–5, stress 1–10 (1–3 fresh, 4–6 moderate, 7–10 fatigued). Estimate missing ones from what they said. If they haven’t given sleep, ask with ask_checkin instead.',
    input_schema: schema({ sleepHours: { type: 'number' }, mood: { type: 'number' }, energy: { type: 'number' }, stress: { type: 'number' }, date: { type: 'string' } }, ['sleepHours']),
    receipt: () => ({ verb: 'Logged', text: 'Check-in' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const clamp = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(numOr(v, d)!)));
      const inputRow = { date: /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today, sleepHours: Math.min(24, Math.max(0, numOr(input.sleepHours, 7)!)), mood: clamp(input.mood, 1, 5, 3), energy: clamp(input.energy, 1, 5, 3), stress: clamp(input.stress, 1, 10, 4) };
      const change = await executeOp(userId, 'wellness.log', { input: inputRow });
      return { logged: change.summary, ...inputRow, _change: change };
    },
    card: (_i, r) => ({ fn: 'WEL-01', pattern: 'logged', rule: 'log_undo', meta: { label: 'Check-in', open: { page: 'you' } },
      rows: [{ key: 'Sleep', value: `${num(r.sleepHours, 1)} h` }, { key: 'Energy', value: `${r.energy} of 5` }, { key: 'Mood', value: `${r.mood} of 5` }, { key: 'Stress', value: `${r.stress} of 10` }],
      ...(r.sleepHours < 6 ? { actions: [{ id: 'lighter', label: 'Go easier today', kind: 'secondary', client: { action: 'send_message', args: { text: 'I slept badly. Make today lighter.' } } }] } : {}), undoLine: 'Undone — check-in removed' }),
  }),
  tool({
    name: 'ask_checkin', kind: 'read', fn: 'WEL-01',
    description: 'Ask how the user slept as tap choices (before a session when there’s no check-in). Their answer comes back as their next message.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Checked', text: 'No check-in today' }),
    execute: async () => ({ ok: true }),
    card: () => ({ fn: 'WEL-01', pattern: 'ask', rule: 'show', ask: { q: 'How did you sleep?', options: ['Under 6 hours', '6–7 hours', '7 or more'], typeInstead: true }, why: 'A short night makes today a lighter day, not a test.', pending: { answer: { asMessage: 'I slept {answer} last night.' } } }),
  }),
  tool({
    name: 'read_wellness', kind: 'read', core: true, fn: 'WEL-02',
    description: 'Recent check-ins (default 14): sleep, energy, mood, stress (stress is 1–10).',
    input_schema: schema({ limit: { type: 'number' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Check-ins' }),
    refine: (r) => r?.checkins?.[0] ? `Wellness — sleep ${r.checkins[0].sleepHours} h` : null,
    execute: async (input, userId) => ({ checkins: await prisma.wellnessCheckin.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: Math.min(30, Math.max(1, numOr(input.limit, 14)!)), select: { date: true, sleepHours: true, energy: true, mood: true, stress: true } }) }),
    card: (_i, r) => {
      const c = [...r.checkins].reverse();
      if (!c.length) return { fn: 'WEL-02', pattern: 'glance', rule: 'show', meta: { label: 'Check-ins' }, empty: 'No check-ins yet.' };
      const avg = (k: string) => c.reduce((n: number, x: any) => n + x[k], 0) / c.length;
      return { fn: 'WEL-02', pattern: 'glance', rule: 'show', meta: { label: `Check-ins · ${plural(c.length, 'day')}` }, hero: { value: num(avg('sleepHours'), 1), unit: 'h sleep a night' },
        bars: { v: c.map((x: any) => x.sleepHours), labels: c.map((x: any) => dayLabel(x.date).slice(0, 3)), hi: c.findIndex((x: any) => x.sleepHours < 6) },
        rows: [{ key: 'Energy', value: `${num(avg('energy'), 1)} of 5` }, { key: 'Stress', value: `${num(avg('stress'), 1)} of 10` }] };
    },
  }),

  // ── Memory ──
  tool({
    name: 'read_memory', kind: 'read', fn: 'MEM-01',
    description: 'What you (Anakin) remember about the user — durable notes. Each can be forgotten from the card.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'What I remember' }),
    execute: async (_i, userId) => ({ notes: await readMemory(userId) }),
    card: (_i, r) => {
      const notes = [...(r.notes as string[])].reverse().slice(0, 12);
      if (!notes.length) return { fn: 'MEM-01', pattern: 'glance', rule: 'show', meta: { label: 'What I remember' }, empty: 'Nothing yet. Tell me anything worth keeping.' };
      return { fn: 'MEM-01', pattern: 'glance', rule: 'show', meta: { label: 'What I remember', open: { page: 'memory' } },
        rows: notes.map((n, i) => ({ key: n, action: `forget${i}` })),
        actions: notes.slice(0, 6).map((n, i) => ({ id: `forget${i}`, label: `Forget: ${n}`.slice(0, 40), kind: 'secondary' as const })),
        pending: { actions: Object.fromEntries(notes.map((n, i) => [`forget${i}`, { op: 'memory.set', args: { notes: (r.notes as string[]).filter((x) => x !== n), summary: `Forgot · ${n.slice(0, 60)}` }, line: `Forgot · ${n.slice(0, 40)}` }])) } };
    },
  }),
  tool({
    name: 'remember', kind: 'log', core: true, fn: 'MEM-02',
    description: 'Save a durable fact about the user (a goal, preference, constraint, schedule) in one short third-person sentence. Not for transient details.',
    input_schema: schema({ note: { type: 'string' } }, ['note']),
    receipt: (i) => ({ verb: 'Noted', text: str(i.note).slice(0, 60) }),
    execute: async (input, userId) => {
      const note = str(input.note).slice(0, 240);
      if (!note) throw new Error('Nothing to remember.');
      const change = await executeOp(userId, 'memory.add', { note });
      return { saved: note, _change: change };
    },
    card: (_i, r) => ({ fn: 'MEM-02', pattern: 'logged', rule: 'log_undo', meta: { label: 'Noted', open: { page: 'memory' } }, rows: [{ key: r.saved }], undoLine: 'Undone — forgotten' }),
  }),
  tool({
    name: 'forget', kind: 'log', fn: 'MEM-03',
    description: 'Forget or correct something you remembered ("forget that I have a bad knee", "I don’t train mornings any more"). Pass the text to match; pass replaceWith to correct it instead.',
    input_schema: schema({ match: { type: 'string' }, replaceWith: { type: 'string' } }, ['match']),
    receipt: (i) => ({ verb: 'Forgot', text: str(i.match).slice(0, 60) }),
    execute: async (input, userId) => {
      const notes = await readMemory(userId);
      const q = str(input.match).toLowerCase();
      const words = q.split(/\s+/).filter((w) => w.length > 3);
      const hits = notes.filter((n) => n.toLowerCase().includes(q) || (words.length && words.every((w) => n.toLowerCase().includes(w))));
      if (!hits.length) return { notFound: true, notes };
      const next = notes.filter((n) => !hits.includes(n));
      if (str(input.replaceWith)) next.push(str(input.replaceWith).slice(0, 240));
      const change = await executeOp(userId, 'memory.set', { notes: next, summary: `${str(input.replaceWith) ? 'Corrected' : 'Forgot'} · ${hits[0].slice(0, 60)}` });
      return { forgot: hits, replacedWith: str(input.replaceWith) || null, _change: change };
    },
    card: (_i, r) => r.notFound
      ? { fn: 'MEM-03', pattern: 'glance', rule: 'show', meta: { label: 'What I remember' }, empty: 'I don’t have that saved.' }
      : { fn: 'MEM-03', pattern: 'logged', rule: 'change_undo', meta: { label: r.replacedWith ? 'Corrected' : 'Forgotten', open: { page: 'memory' } }, rows: [...r.forgot.map((n: string) => ({ key: n, mark: 'del' as const })), ...(r.replacedWith ? [{ key: r.replacedWith, mark: 'add' as const }] : [])], undoLine: 'Undone — remembered again' },
  }),

  // ── Streaks ──
  tool({
    name: 'read_streaks', kind: 'read', fn: 'STK-01',
    description: 'The user’s workout and food-logging streaks, longest streaks, streak freezes left, and this week’s active days.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Streaks' }),
    execute: async (_i, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { currentStreak: true, longestStreak: true, nutritionStreak: true, longestNutritionStreak: true, streakFreezes: true, lastWorkoutDate: true, lastNutritionLogDate: true } });
      const ctx = await ctxOf(userId);
      const week = await prisma.activityLog.findMany({ where: { userId, date: { gte: shiftDate(ctx.today, -6) } }, select: { date: true } });
      return { ...u, activeDaysThisWeek: new Set(week.map((w) => w.date)).size };
    },
    card: (_i, r) => ({ fn: 'STK-01', pattern: 'glance', rule: 'show', meta: { label: 'Streaks', open: { page: 'streak' } }, hero: { value: String(r.currentStreak ?? 0), unit: `day${r.currentStreak === 1 ? '' : 's'} training` },
      rows: [{ key: 'Food logging', value: `${r.nutritionStreak ?? 0} days` }, { key: 'Longest training streak', value: `${r.longestStreak ?? 0} days` }, { key: 'Longest food streak', value: `${r.longestNutritionStreak ?? 0} days` }, { key: 'Freezes left', value: String(r.streakFreezes ?? 0), sub: 'A freeze saves a streak on a missed day.' }, { key: 'Active this week', value: `${r.activeDaysThisWeek} of 7 days` }] }),
  }),
  tool({
    name: 'read_activity', kind: 'read', fn: 'STK-02',
    description: 'The user’s activity calendar for the last year (days with workouts, food logs, check-ins, analyses).',
    input_schema: schema({ days: { type: 'number' } }),
    receipt: () => ({ verb: 'Read', text: 'Activity' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const days = Math.min(365, Math.max(7, Math.round(numOr(input.days, 84)!)));
      const logs = await prisma.activityLog.findMany({ where: { userId, date: { gte: shiftDate(ctx.today, -days + 1) } }, select: { date: true, count: true } });
      const byDate = new Map<string, number>();
      for (const l of logs) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.count);
      const series: number[] = [];
      for (let i = days - 1; i >= 0; i--) series.push(byDate.get(shiftDate(ctx.today, -i)) ?? 0);
      return { days, activeDays: byDate.size, series };
    },
    card: (_i, r) => ({ fn: 'STK-02', pattern: 'glance', rule: 'show', meta: { label: `Activity · ${r.days} days`, open: { page: 'streak' } }, hero: { value: String(r.activeDays), unit: 'active days' }, bars: { v: r.series.slice(-28) } }),
  }),
];

HEALTH_TOOLS.push(tool({
  name: 'query_research', kind: 'read', core: true, fn: 'MEM-06',
  description: 'Search the curated research feed (PubMed, NIH, medical schools, Huberman Lab) for a topic and return a few summaries with sources, to ground an answer in evidence.',
  input_schema: schema({ query: { type: 'string' }, limit: { type: 'number' } }, ['query']),
  receipt: (i) => ({ verb: 'Searched', text: `Research · ${str(i.query)}` }),
  refine: (r) => r?.count != null ? `Research · ${r.count} ${r.count === 1 ? 'source' : 'sources'}` : null,
  execute: async (input) => {
    const q = str(input.query);
    const limit = Math.max(1, Math.min(8, numOr(input.limit, 3)!));
    if (!q) return { query: q, count: 0, results: [] };
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
    const items = await prisma.feedItem.findMany({
      where: { OR: [{ title: { contains: q } }, { summary: { contains: q } }, { tags: { contains: q.toLowerCase() } }, ...words.map((w) => ({ title: { contains: w } }))] },
      orderBy: { fetchedAt: 'desc' }, take: limit, select: { id: true, title: true, summary: true, source: true, url: true },
    });
    return { query: q, count: items.length, results: items };
  },
  card: (_i, r) => r.count ? {
    fn: 'MEM-06', pattern: 'glance', rule: 'show', meta: { label: 'Sources' },
    rows: r.results.map((x: any) => ({ key: x.title, sub: x.source })),
    actions: r.results.slice(0, 3).map((x: any, i: number) => ({ id: `open${i}`, label: `Open: ${x.title}`.slice(0, 36), kind: 'secondary' as const, client: { action: 'open_url' as const, args: { url: x.url } } })),
  } : null,
}));
registerToolkit(HEALTH_TOOLS);
export type { CardRow };
