// Coaching profile (catalog PRO-01…18): everything the intake asked, now
// readable and changeable from chat through the canonical field registry.
// Profile edits are SET (applied at once, Undo). What they imply — a new
// program, new targets — is a separate PROPOSE the card offers as a follow-up.

import { registerToolkit } from '../registry.js';
import { defineOp, executeOp } from '../ops.js';
import { tool, schema, str, numOr, prisma } from './kit.js';
import {
  PROFILE_FIELDS, FIELD_BY_KEY, readProfile, writeFields, displayValue, readInjuries, writeInjuries, restoreInjuries, parseBlob, normaliseValue, type Injury, type ProfileField,
} from '../profile/coachProfile.js';
import { logBodyWeight, restoreBodyWeight, removeBodyWeightOn } from '../../services/bodyWeightService.js';
import { bodyWeight, kgTo, toKg, todayIn } from '../cards/format.js';
import { userTz } from '../cards/store.js';
import type { CardDraft, CardRow } from '../cards/types.js';

// Answers that mean "see a clinician before loading this" (same spirit as the
// v2 onboarding red-flag route).
const RED_FLAG = /(radiat|numb|tingl|chest pain|faint|dizz|shooting|loss of (bladder|bowel)|can.?t bear weight|swollen and hot|night pain)/i;

defineOp({
  name: 'profile.set_fields',
  run: async (userId, args) => {
    const changes = args.changes as Record<string, unknown>;
    const before = (await readProfile(userId)).values;
    const { previous } = await writeFields(userId, changes);
    const lines = Object.keys(changes).map((k) => {
      const fd = FIELD_BY_KEY[k];
      return `${fd.label} · ${displayValue(fd, before[k])} → ${displayValue(fd, safeNorm(fd, changes[k]))}`;
    });
    return { result: { lines, display: lines.length === 1 ? lines[0].split(' → ')[1] : undefined }, inverse: { op: 'profile.set_fields', args: { changes: previous } }, summary: lines.join('; ') };
  },
});
function safeNorm(fd: ProfileField, v: unknown) { try { return normaliseValue(fd, v); } catch { return v; } }

defineOp({
  name: 'profile.injuries',
  run: async (userId, args) => {
    const { previous } = await writeInjuries(userId, args.list as Injury[]);
    return { result: { list: args.list }, inverse: { op: 'profile.injuries_restore', args: { previous } }, summary: String(args.summary ?? 'Injuries updated') };
  },
});
defineOp({
  name: 'profile.injuries_restore',
  run: async (userId, args) => { await restoreInjuries(userId, args.previous as any); return { inverse: null, summary: 'Injuries restored' }; },
});

defineOp({
  name: 'body.set_stats',
  run: async (userId, args) => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { heightCm: true, weightKg: true, goalWeightKg: true, coachProfile: true, unitPreference: true } });
    if (!u) throw new Error('User not found');
    const unit = u.unitPreference === 'metric' ? 'metric' : 'imperial';
    const data: Record<string, unknown> = {};
    const prev: Record<string, unknown> = {};
    const lines: string[] = [];
    const blob = parseBlob(u.coachProfile);
    if (args.heightCm != null) {
      const h = Number(args.heightCm);
      if (!(h >= 120 && h <= 230)) throw new Error('Height looks off — give it in cm (120–230) or feet and inches.');
      prev.heightCm = u.heightCm; data.heightCm = h;
      lines.push(`Height · ${heightLabel(unit, u.heightCm)} → ${heightLabel(unit, h)}`);
    }
    if (args.goalWeightKg !== undefined) {
      const g = args.goalWeightKg == null ? null : Number(args.goalWeightKg);
      prev.goalWeightKg = u.goalWeightKg; data.goalWeightKg = g;
      lines.push(`Goal weight · ${u.goalWeightKg ? bodyWeight(unit, u.goalWeightKg) : 'Not set'} → ${g ? bodyWeight(unit, g) : 'Not set'}`);
    }
    if (args.bodyFatPct != null) {
      const bf = Number(args.bodyFatPct);
      if (!(bf >= 3 && bf <= 70)) throw new Error('Body fat should be a percentage between 3 and 70.');
      prev.bodyFatPct = blob.bodyFat ?? null; blob.bodyFat = String(bf); data.coachProfile = JSON.stringify(blob);
      lines.push(`Body fat · ${prev.bodyFatPct ? `${prev.bodyFatPct}%` : 'Not set'} → ${bf}%`);
    }
    if (Object.keys(data).length) await prisma.user.update({ where: { id: userId }, data: data as any });
    let weighIn: { before: any; date: string } | null = null;
    if (args.weightKg != null) {
      const date = todayIn(await userTz(userId));
      const r = await logBodyWeight(userId, { date, weightKg: Number(args.weightKg) });
      prev.weightKg = u.weightKg;
      await prisma.user.update({ where: { id: userId }, data: { weightKg: Number(args.weightKg) } });
      weighIn = { before: r.before, date };
      lines.push(`Weight · ${u.weightKg ? bodyWeight(unit, u.weightKg) : 'Not set'} → ${bodyWeight(unit, Number(args.weightKg))}`);
    }
    return { result: { lines, unit }, inverse: { op: 'body.restore_stats', args: { prev, weighIn } }, summary: lines.join('; ') };
  },
});
defineOp({
  name: 'body.restore_stats',
  run: async (userId, args) => {
    const prev = args.prev as Record<string, any>;
    const data: Record<string, unknown> = {};
    if ('heightCm' in prev) data.heightCm = prev.heightCm;
    if ('goalWeightKg' in prev) data.goalWeightKg = prev.goalWeightKg;
    if ('weightKg' in prev) data.weightKg = prev.weightKg;
    if ('bodyFatPct' in prev) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
      const blob = parseBlob(u?.coachProfile);
      if (prev.bodyFatPct == null) delete blob.bodyFat; else blob.bodyFat = prev.bodyFatPct;
      data.coachProfile = JSON.stringify(blob);
    }
    if (Object.keys(data).length) await prisma.user.update({ where: { id: userId }, data: data as any });
    const w = args.weighIn as { before: any; date: string } | null;
    if (w) { if (w.before) await restoreBodyWeight(userId, w.before); else await removeBodyWeightOn(userId, w.date); }
    return { inverse: null, summary: 'Body stats restored' };
  },
});

defineOp({
  name: 'profile.restart_intake',
  run: async (userId) => {
    await prisma.user.update({ where: { id: userId }, data: { coachOnboardingDone: false } });
    return { inverse: { op: 'profile.finish_intake', args: {} }, summary: 'Intake reopened' };
  },
});
defineOp({
  name: 'profile.finish_intake',
  run: async (userId) => { await prisma.user.update({ where: { id: userId }, data: { coachOnboardingDone: true } }); return { inverse: null, summary: 'Intake closed' }; },
});

function heightLabel(unit: string, cm: number | null | undefined): string {
  if (!cm) return 'Not set';
  if (unit === 'metric') return `${Math.round(cm)} cm`;
  const inches = cm / 2.54;
  return `${Math.floor(inches / 12)} ft ${Math.round(inches % 12)}`;
}
/** "5 ft 11", "5'11", "180 cm", "71 in" → cm */
function parseHeight(v: unknown): number | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s) return null;
  let m = s.match(/(\d)\s*(?:ft|foot|feet|')\s*(\d{1,2})?/);
  if (m) return Math.round(((Number(m[1]) * 12) + Number(m[2] ?? 0)) * 2.54);
  m = s.match(/([\d.]+)\s*(cm)?$/);
  if (m) { const n = Number(m[1]); return n > 100 ? n : n > 48 ? Math.round(n * 2.54) : null; }
  return null;
}

const FOLLOW_UP: Record<string, { label: string; text: string } | undefined> = {
  program: { label: 'Rebuild my program', text: 'Rebuild my program around what I just changed.' },
  nutrition: { label: 'Adjust my targets', text: 'Adjust my nutrition targets for what I just changed.' },
  both: { label: 'Update my plan', text: 'Update my program and nutrition targets for what I just changed.' },
};
const FIELD_FN: Record<string, string> = {
  goal: 'PRO-02', why: 'PRO-03', pastAttempts: 'PRO-03', obstacle: 'PRO-03', commitment: 'PRO-03', trainingAge: 'PRO-05',
  daysPerWeek: 'PRO-06', sessionMinutes: 'PRO-06', equipment: 'PRO-07', trainingStyle: 'PRO-08', trainingTypes: 'PRO-08', currentRoutine: 'PRO-08',
  dietaryRestrictions: 'PRO-12', allergies: 'PRO-12', nutritionQuality: 'PRO-12', proteinIntake: 'PRO-12', budget: 'PRO-13',
  activityLevel: 'PRO-14', sleep: 'PRO-14', stress: 'PRO-14', typicalDay: 'PRO-14', recoveryPractices: 'PRO-14', accountability: 'PRO-15',
  aestheticGoals: 'PRO-16', sex: 'PRO-04', parq: 'PRO-11', medicalConditions: 'PRO-11', medications: 'PRO-11', hormonal: 'PRO-11',
};

export const PROFILE_TOOLS = [
  tool({
    name: 'read_coaching_profile', kind: 'read', core: true, fn: 'PRO-01',
    description: 'Read everything the user told you in their intake, by field: goal, why, past attempts, obstacle, commitment, experience, days per week, session length, equipment, training style and types, current routine, sex, health screening, conditions, medications, hormonal health, diet, allergies, protein habit, food budget, activity, sleep, stress, typical day, recovery, check-in style, areas to improve — plus height, weight, goal weight, body fat and injuries. Read this before changing any field.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Your profile' }),
    execute: async (_i, userId) => {
      const [{ values, injuries, blob }, u] = await Promise.all([
        readProfile(userId),
        prisma.user.findUnique({ where: { id: userId }, select: { heightCm: true, weightKg: true, goalWeightKg: true, unitPreference: true, dateOfBirth: true } }),
      ]);
      const unit = u?.unitPreference === 'metric' ? 'metric' : 'imperial';
      return {
        fields: Object.fromEntries(PROFILE_FIELDS.map((fd) => [fd.key, { label: fd.label, value: values[fd.key], display: displayValue(fd, values[fd.key]), options: fd.options ? Object.keys(fd.options) : undefined }])),
        body: { height: heightLabel(unit, u?.heightCm), weight: u?.weightKg ? bodyWeight(unit, u.weightKg) : null, goalWeight: u?.goalWeightKg ? bodyWeight(unit, u.goalWeightKg) : null, bodyFat: blob.bodyFat ? `${blob.bodyFat}%` : null },
        injuries: injuries.filter((i) => !i.resolvedAt),
      };
    },
    card: (_i, r) => {
      const groups = ['Goal', 'Training', 'Diet', 'Lifestyle', 'Coaching'] as const;
      const main: CardRow[] = [
        { key: 'Height', value: r.body.height }, { key: 'Weight', value: r.body.weight ?? 'Not set' },
        ...(r.body.goalWeight ? [{ key: 'Goal weight', value: r.body.goalWeight }] : []),
      ];
      for (const g of groups) for (const fd of PROFILE_FIELDS.filter((x) => x.group === g && !x.private)) {
        const f = r.fields[fd.key];
        if (f.display === 'Not set' && !['goal', 'daysPerWeek', 'equipment', 'trainingAge'].includes(fd.key)) continue;
        main.push({ key: fd.label, value: f.display, ...(fd.type === 'text' || fd.type === 'number' ? { editable: { field: fd.key, kind: fd.type === 'number' ? 'number' : 'text' } } : {}) });
      }
      const edits = Object.fromEntries(PROFILE_FIELDS.filter((fd) => fd.type === 'text' || fd.type === 'number').map((fd) => [fd.key, { op: 'profile.set_one', args: { key: fd.key }, valueKey: 'value', parse: fd.type === 'number' ? 'number' as const : 'text' as const }]));
      const cards: CardDraft[] = [{ fn: 'PRO-01', pattern: 'glance', rule: 'show', meta: { label: 'What I know about you', open: { page: 'profile' } }, rows: main, pending: { edits } }];
      const health: CardRow[] = [
        ...r.injuries.map((i: Injury) => ({ key: 'Injury', value: [i.area, i.note].filter(Boolean).join(' — ') })),
        ...PROFILE_FIELDS.filter((fd) => fd.private && r.fields[fd.key].display !== 'Not set').map((fd) => ({ key: fd.label, value: r.fields[fd.key].display })),
      ];
      if (health.length) cards.push({ fn: 'PRO-11', pattern: 'glance', rule: 'show', private: true, meta: { label: 'Private · health', open: { page: 'body' } }, rows: health });
      return cards;
    },
  }),
  tool({
    name: 'update_coaching_profile', kind: 'set', core: true, fn: 'PRO-02',
    description: `Change intake answers the user asked to change. changes = { field: value }. Fields: ${PROFILE_FIELDS.filter((f) => !f.private).map((f) => `${f.key}${f.options ? ` (${Object.keys(f.options).join('|')})` : f.type === 'number' ? ` (${f.min}–${f.max})` : ''}`).join(', ')}. Multi-choice fields take arrays. Health answers use update_health_profile; injuries use update_injuries; height, weight, goal weight and body fat use update_body_stats. A changed goal, schedule or equipment usually needs a program change — the card offers it; don't propose one unless they ask.`,
    input_schema: schema({ changes: { type: 'object', description: 'field → new value' } }, ['changes']),
    receipt: (i) => ({ verb: 'Adjusted', text: Object.keys((i.changes as object) ?? {}).map((k) => FIELD_BY_KEY[k]?.label ?? k).join(', ') || 'Profile' }),
    execute: async (input, userId) => {
      const changes = (input.changes ?? {}) as Record<string, unknown>;
      const keys = Object.keys(changes);
      if (!keys.length) throw new Error('Say which answer to change.');
      for (const k of keys) {
        const fd = FIELD_BY_KEY[k];
        if (!fd) throw new Error(`Unknown field "${k}". Fields: ${PROFILE_FIELDS.map((f) => f.key).join(', ')}.`);
        if (fd.private) throw new Error(`${fd.label} is a health answer — use update_health_profile.`);
      }
      const change = await executeOp(userId, 'profile.set_fields', { changes });
      const affects = [...new Set(keys.map((k) => FIELD_BY_KEY[k].affects).filter(Boolean))];
      return { lines: (change.result as any).lines, keys, affects: affects.includes('both') || (affects.includes('program') && affects.includes('nutrition')) ? 'both' : affects[0] ?? null, _change: change };
    },
    card: (_i, r) => {
      const follow = r.affects ? FOLLOW_UP[r.affects] : undefined;
      const actions = follow ? [{ id: 'follow', label: follow.label, kind: 'secondary' as const, client: { action: 'send_message' as const, args: { text: follow.text } } }] : [];
      if (r.lines.length === 1) {
        const [key, rest] = r.lines[0].split(' · ');
        const [from, to] = (rest ?? '').split(' → ');
        return { fn: FIELD_FN[r.keys[0]] ?? 'PRO-02', pattern: 'setting', rule: 'change_undo', meta: { label: 'Profile', open: { page: 'profile' } }, change: { key, from, to }, actions, undoLine: `Undone — back to ${from}` } as CardDraft;
      }
      return { fn: FIELD_FN[r.keys[0]] ?? 'PRO-02', pattern: 'setting', rule: 'change_undo', meta: { label: 'Profile', open: { page: 'profile' } }, rows: r.lines.map((l: string) => { const [key, rest] = l.split(' · '); const [from, to] = (rest ?? '').split(' → '); return { key, value: to, sub: `was ${from}` }; }), actions };
    },
  }),
  tool({
    name: 'update_body_stats', kind: 'set', fn: 'PRO-04',
    description: 'Change height, current body weight (also logs today’s weigh-in), goal weight, or body-fat percentage when the user states them. Give height as the user said it ("5 ft 11", "180 cm"); weight and goal weight in the user’s unit.',
    input_schema: schema({ height: { type: 'string' }, weight: { type: 'number' }, goalWeight: { type: 'number', description: 'Use 0 to clear.' }, bodyFatPct: { type: 'number' } }),
    receipt: () => ({ verb: 'Adjusted', text: 'Body stats' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const unit = u?.unitPreference === 'metric' ? 'metric' : 'imperial';
      const args: Record<string, unknown> = {};
      if (input.height != null) { const cm = parseHeight(input.height); if (!cm) throw new Error('Give height like "5 ft 11" or "180 cm".'); args.heightCm = cm; }
      if (numOr(input.weight) != null) args.weightKg = toKg(unit, numOr(input.weight)!);
      if (input.goalWeight !== undefined) args.goalWeightKg = numOr(input.goalWeight) ? toKg(unit, numOr(input.goalWeight)!) : null;
      if (numOr(input.bodyFatPct) != null) args.bodyFatPct = numOr(input.bodyFatPct);
      if (!Object.keys(args).length) throw new Error('Say what changed: height, weight, goal weight or body fat.');
      const change = await executeOp(userId, 'body.set_stats', args);
      return { lines: (change.result as any).lines, goal: 'goalWeightKg' in args, _change: change };
    },
    card: async (_i, r, ctx) => {
      const draft: CardDraft = r.lines.length === 1
        ? (() => { const [key, rest] = r.lines[0].split(' · '); const [from, to] = (rest ?? '').split(' → '); return { fn: r.goal ? 'PRO-17' : 'PRO-04', pattern: 'setting', rule: 'change_undo', meta: { label: 'Body', open: { page: 'body' } }, change: { key, from, to }, undoLine: `Undone — back to ${from}` } as CardDraft; })()
        : { fn: 'PRO-04', pattern: 'setting', rule: 'change_undo', meta: { label: 'Body', open: { page: 'body' } }, rows: r.lines.map((l: string) => { const [key, rest] = l.split(' · '); const [from, to] = (rest ?? '').split(' → '); return { key, value: to, sub: `was ${from}` }; }) };
      if (r.goal) {
        // Time estimate at the current 14-day trend.
        const logs = await prisma.bodyWeightLog.findMany({ where: { userId: ctx.userId }, orderBy: { date: 'desc' }, take: 14, select: { date: true, weightKg: true } });
        const u = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { goalWeightKg: true } });
        if (logs.length >= 4 && u?.goalWeightKg) {
          const first = logs[logs.length - 1], last = logs[0];
          const days = Math.max(1, (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000);
          const perWeek = ((last.weightKg ?? 0) - (first.weightKg ?? 0)) / days * 7;
          const left = u.goalWeightKg - (last.weightKg ?? 0);
          if (Math.abs(perWeek) > 0.05 && Math.sign(perWeek) === Math.sign(left)) draft.note = `About ${Math.ceil(Math.abs(left / perWeek))} weeks at your current pace (${kgTo(ctx.unit, Math.abs(perWeek))!.toFixed(1)} ${ctx.unit === 'metric' ? 'kg' : 'lb'} a week).`;
          else draft.note = 'Your recent trend is flat or heading the other way.';
        }
      }
      return draft;
    },
  }),
  tool({
    name: 'update_injuries', kind: 'set', core: true, fn: 'PRO-10',
    description: 'Record a new injury or pain the user reports, or mark one healed. Ask (in words) how long it has hurt and how bad it is if they didn’t say; pass since and severity when known. Red-flag symptoms (radiating pain, numbness, chest pain, dizziness) mean: tell them to see a clinician before loading it. After recording, offer to swap the affected lifts — don’t swap without asking.',
    input_schema: schema({
      add: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', description: 'e.g. "Left shoulder on overhead press"' }, note: { type: 'string' }, since: { type: 'string', description: 'e.g. "2 weeks"' }, severity: { type: 'string', enum: ['mild', 'moderate', 'severe'] } }, required: ['area'] } },
      resolve: { type: 'array', items: { type: 'string' }, description: 'Areas that have healed.' },
    }),
    receipt: (i) => ({ verb: 'Noted', text: Array.isArray(i.add) && i.add.length ? `Injury · ${(i.add as any[])[0].area}` : 'Injury healed' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true, constraintsText: true } });
      const list = readInjuries(parseBlob(u?.coachProfile), u?.constraintsText ?? null);
      const add = (Array.isArray(input.add) ? input.add : []) as Injury[];
      const resolve = (Array.isArray(input.resolve) ? input.resolve : []).map((x) => String(x).toLowerCase());
      const now = new Date().toISOString().slice(0, 10);
      const next = list.map((i) => resolve.some((r) => i.area.toLowerCase().includes(r) || r.includes(i.area.toLowerCase())) ? { ...i, resolvedAt: now } : i);
      for (const a of add) next.push({ area: str(a.area).slice(0, 120), ...(a.note ? { note: str(a.note).slice(0, 300) } : {}), ...(a.since ? { since: str(a.since) } : {}), ...(a.severity ? { severity: a.severity } : {}) });
      const summary = [add.length ? `Added ${add.map((a) => a.area).join(', ')}` : '', resolve.length ? `Healed ${resolve.join(', ')}` : ''].filter(Boolean).join('; ') || 'Injuries updated';
      const change = await executeOp(userId, 'profile.injuries', { list: next, summary });
      const redFlag = add.some((a) => RED_FLAG.test(`${a.area} ${a.note ?? ''}`));
      return { active: next.filter((i) => !i.resolvedAt), added: add, healed: resolve, redFlag, _change: change };
    },
    card: (_i, r) => {
      const draft: CardDraft = {
        fn: 'PRO-10', pattern: 'setting', rule: 'change_undo', private: true, meta: { label: 'Private · injuries', open: { page: 'body' } },
        rows: r.active.map((i: Injury) => ({ key: i.area, value: [i.severity, i.since].filter(Boolean).join(' · ') || 'Active', mark: r.added.some((a: Injury) => a.area === i.area) ? 'add' as const : undefined })),
        actions: r.added.length && !r.redFlag ? [{ id: 'swap', label: 'Swap affected lifts', kind: 'secondary', client: { action: 'send_message', args: { text: `Swap the lifts that load my ${r.added[0].area} for today and the rest of the week.` } } }] : [],
        ...(r.redFlag ? { note: 'That sounds like something to get checked by a physio or doctor before you load it. I’ll keep it out of your sessions until then.' } : {}),
        undoLine: 'Undone',
      };
      if (!r.active.length) draft.empty = 'No active injuries.';
      return draft;
    },
  }),
  tool({
    name: 'update_health_profile', kind: 'set', fn: 'PRO-11',
    description: 'Record health answers the user tells you: parq (screening flags: heart_condition, chest_pain, dizziness, joint_bone, bp_heart_meds, chronic_condition, other_concern, none), medicalConditions (hypertension, type2_diabetes, type1_diabetes, heart_condition, asthma, hypothyroidism, hyperthyroidism, arthritis, osteoporosis, sleep_apnea, chronic_fatigue, anxiety_depression, none), medications (text), hormonal (text). Only on the user’s explicit statement. Any screening flag other than none means advising clinical clearance before hard training.',
    input_schema: schema({ parq: { type: 'array', items: { type: 'string' } }, medicalConditions: { type: 'array', items: { type: 'string' } }, medications: { type: 'string' }, hormonal: { type: 'string' } }),
    receipt: () => ({ verb: 'Noted', text: 'Health answers' }),
    execute: async (input, userId) => {
      const changes = Object.fromEntries(['parq', 'medicalConditions', 'medications', 'hormonal'].filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
      if (!Object.keys(changes).length) throw new Error('Say what changed.');
      const change = await executeOp(userId, 'profile.set_fields', { changes });
      const flags = Array.isArray(input.parq) ? (input.parq as string[]).filter((x) => x !== 'none') : [];
      return { lines: (change.result as any).lines, clearance: flags.length > 0, _change: change };
    },
    card: (_i, r) => ({
      fn: 'PRO-11', pattern: 'setting', rule: 'change_undo', private: true, meta: { label: 'Private · health', open: { page: 'body' } },
      rows: r.lines.map((l: string) => { const [key, rest] = l.split(' · '); return { key, value: (rest ?? '').split(' → ')[1] ?? rest }; }),
      ...(r.clearance ? { note: 'With that on your screening, get cleared by your doctor before hard sessions. I’ll keep intensity moderate until then.' } : {}),
    }),
  }),
  tool({
    name: 'restart_intake', kind: 'confirm', fn: 'PRO-18',
    description: 'The user wants to redo their intake from scratch. Shows what resets (their answers) and what stays (logs, history, program until they build a new one); the tap reopens the intake.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Intake' }),
    execute: async () => ({ ok: true }),
    card: () => ({
      fn: 'PRO-18', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Redo your intake' },
      lose: { items: ['Your intake answers are asked again'], keep: 'Workouts, meals, weigh-ins and your current program stay until you build a new one.' },
      actions: [{ id: 'restart', label: 'Start over', kind: 'destructive' }, { id: 'keep', label: 'Cancel', kind: 'cancel' }],
      pending: { actions: { restart: { op: 'profile.restart_intake', args: {}, line: 'Intake reopened' }, keep: { kind: 'cancel', line: 'Cancelled — nothing changed' } } },
    }),
  }),
];

// Inline edit on the profile glance card: one field at a time.
defineOp({
  name: 'profile.set_one',
  run: async (userId, args) => {
    const key = String(args.key);
    const r = await (await import('../ops.js')).getOp('profile.set_fields')!.run(userId, { changes: { [key]: args.value } });
    return r;
  },
});

registerToolkit(PROFILE_TOOLS);
