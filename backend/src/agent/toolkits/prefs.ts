// Preferences & notifications (catalog PRF-01…14): units, food region,
// workout-calorie counting, schedule sharing, notification categories,
// reminder time, timezone, marketing email, consent, and small prefs.

import { parseConsent } from '../consent.js';
import { registerToolkit } from '../registry.js';
import { defineOp, executeOp } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, prisma } from './kit.js';
import { NOTIFICATION_CATEGORIES, parseNotificationPrefs, parseUserPrefs } from '../../services/userPrefs.js';
import { mergeBlobKeys } from '../profile/coachProfile.js';
import { forgetTz } from '../cards/store.js';
import type { CardDraft, CardRow } from '../cards/types.js';

const REGION: Record<string, string> = { global: 'Global', ng: 'Nigeria', gm: 'The Gambia', wa: 'West Africa' };
const onOff = (b: unknown) => (b ? 'On' : 'Off');
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? ' am' : ' pm'}`;

type PrefKey = 'unitPreference' | 'foodRegion' | 'subtractWorkoutBurnFromCalories' | 'scheduleSharing' | 'timezone' | 'saveFormStills' | 'adaptationEnabled' | 'shareTheme';
const LABEL: Record<PrefKey, string> = {
  unitPreference: 'Units', foodRegion: 'Food region', subtractWorkoutBurnFromCalories: 'Count workout calories',
  scheduleSharing: 'Share my training calendar', timezone: 'Timezone', saveFormStills: 'Save form-check stills',
  adaptationEnabled: 'Progression suggestions', shareTheme: 'Share card theme',
};
function display(k: PrefKey, v: unknown): string {
  if (k === 'unitPreference') return v === 'metric' ? 'kg' : 'lb';
  if (k === 'foodRegion') return REGION[String(v)] ?? String(v);
  // true = calories burned in a workout are added to that day's target ("count workout calories").
  if (k === 'subtractWorkoutBurnFromCalories') return v ? 'On' : 'Off';
  if (k === 'shareTheme') return v === 'dark' ? 'Dark' : 'Light';
  if (typeof v === 'boolean') return onOff(v);
  return String(v ?? '—');
}

export async function readPrefs(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: {
    unitPreference: true, foodRegion: true, subtractWorkoutBurnFromCalories: true, scheduleSharing: true, timezone: true,
    prefsJson: true, notificationPrefsJson: true, reengagementOptOut: true, marketingEmailsOptOut: true, coachProfile: true,
  } });
  if (!u) throw new Error('User not found');
  const p = parseUserPrefs(u.prefsJson);
  return {
    prefs: {
      unitPreference: u.unitPreference === 'metric' ? 'metric' : 'imperial', foodRegion: u.foodRegion, subtractWorkoutBurnFromCalories: u.subtractWorkoutBurnFromCalories,
      scheduleSharing: u.scheduleSharing, timezone: u.timezone ?? 'America/New_York', saveFormStills: p.saveFormStills, adaptationEnabled: p.adaptationEnabled, shareTheme: p.shareTheme,
    } as Record<PrefKey, any>,
    notifications: { ...parseNotificationPrefs(u.notificationPrefsJson), nudges: !u.reengagementOptOut, marketingEmails: !u.marketingEmailsOptOut },
    consent: parseConsent(u.coachProfile) as Record<string, boolean>,
  };
}

function normalisePref(k: PrefKey, v: unknown): unknown {
  const s = String(v ?? '').toLowerCase().trim();
  switch (k) {
    case 'unitPreference': if (['kg', 'metric', 'kilograms'].includes(s)) return 'metric'; if (['lb', 'lbs', 'imperial', 'pounds'].includes(s)) return 'imperial'; throw new Error('Units are lb or kg.');
    case 'foodRegion': { const hit = Object.entries(REGION).find(([code, name]) => code === s || name.toLowerCase() === s || (s.includes('nigeria') && code === 'ng') || (s.includes('gambia') && code === 'gm')); if (!hit) throw new Error('Food region is Global, Nigeria, The Gambia or West Africa.'); return hit[0]; }
    case 'timezone': try { new Intl.DateTimeFormat('en-US', { timeZone: String(v) }); return String(v); } catch { throw new Error('Use a timezone like America/New_York or Europe/London.'); }
    case 'shareTheme': if (s === 'dark' || s === 'light') return s; throw new Error('Share card theme is light or dark.');
    default: if (typeof v === 'boolean') return v; if (['true', 'on', 'yes'].includes(s)) return true; if (['false', 'off', 'no'].includes(s)) return false; throw new Error(`${LABEL[k]} is on or off.`);
  }
}

defineOp({
  name: 'pref.set_many',
  run: async (userId, args) => {
    const values = args.values as Partial<Record<PrefKey, unknown>>;
    const { prefs } = await readPrefs(userId);
    const previous: Partial<Record<PrefKey, unknown>> = {};
    const col: Record<string, unknown> = {};
    const json: Record<string, unknown> = {};
    const lines: string[] = [];
    for (const [k0, raw] of Object.entries(values)) {
      const k = k0 as PrefKey;
      if (!(k in LABEL)) throw new Error(`Unknown preference ${k}`);
      const v = normalisePref(k, raw);
      previous[k] = prefs[k];
      lines.push(`${LABEL[k]} · ${display(k, prefs[k])} → ${display(k, v)}`);
      if (k === 'saveFormStills' || k === 'adaptationEnabled' || k === 'shareTheme') json[k] = v; else col[k] = v;
    }
    if (col.unitPreference !== undefined) {
      // The route also kicks off the strength-profile recompute in the new unit.
      await callApi(userId, 'PUT', '/auth/profile', { unitPreference: col.unitPreference });
      delete col.unitPreference;
    }
    if (Object.keys(json).length) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { prefsJson: true } });
      col.prefsJson = JSON.stringify({ ...parseUserPrefs(u?.prefsJson), ...json });
    }
    if (Object.keys(col).length) await prisma.user.update({ where: { id: userId }, data: col as any });
    if (values.timezone !== undefined) forgetTz(userId);
    return { result: { lines }, inverse: { op: 'pref.set_many', args: { values: previous } }, summary: lines.join('; ') };
  },
});

type NotifKey = keyof typeof NOTIFICATION_CATEGORIES | 'nudges' | 'marketingEmails' | 'weeklyEmail' | 'reminderHour';
const NOTIF_LABEL: Record<NotifKey, string> = { ...NOTIFICATION_CATEGORIES, nudges: 'Nudges when I’m away', marketingEmails: 'Blog and update emails', weeklyEmail: 'Weekly summary email', reminderHour: 'Reminder time' };

defineOp({
  name: 'notif.set',
  run: async (userId, args) => {
    const values = args.values as Partial<Record<NotifKey, unknown>>;
    const { notifications } = await readPrefs(userId);
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};
    const lines: string[] = [];
    for (const [k0, raw] of Object.entries(values)) {
      const k = k0 as NotifKey;
      if (!(k in NOTIF_LABEL)) throw new Error(`Unknown notification setting ${k}`);
      previous[k] = (notifications as any)[k];
      if (k === 'reminderHour') {
        const h = Number(raw);
        if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('Reminder hour is 0–23.');
        next[k] = h; lines.push(`Reminder time · ${hourLabel(Number(previous[k]))} → ${hourLabel(h)}`);
      } else {
        const on = typeof raw === 'boolean' ? raw : ['true', 'on', 'yes'].includes(String(raw).toLowerCase());
        lines.push(`${NOTIF_LABEL[k]} · ${onOff(previous[k])} → ${onOff(on)}`);
        if (k === 'nudges') data.reengagementOptOut = !on;
        else if (k === 'marketingEmails') data.marketingEmailsOptOut = !on;
        else next[k] = on;
      }
    }
    if (Object.keys(next).length) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefsJson: true } });
      data.notificationPrefsJson = JSON.stringify({ ...parseNotificationPrefs(u?.notificationPrefsJson), ...next });
    }
    await prisma.user.update({ where: { id: userId }, data: data as any });
    return { result: { lines }, inverse: { op: 'notif.set', args: { values: previous } }, summary: lines.join('; ') };
  },
});

defineOp({
  name: 'consent.set',
  run: async (userId, args) => {
    const { consent } = await readPrefs(userId);
    const values = args.values as Record<string, boolean>;
    const next = { ...consent };
    const lines: string[] = [];
    for (const [k, v] of Object.entries(values)) {
      if (!['logs', 'health', 'research', 'nutrition'].includes(k)) throw new Error(`Unknown consent ${k}`);
      lines.push(`${CONSENT_LABEL[k]} · ${onOff(consent[k])} → ${onOff(v)}`);
      next[k] = !!v;
    }
    await mergeBlobKeys(userId, { consent: next });
    return { result: { lines }, inverse: { op: 'consent.set', args: { values: Object.fromEntries(Object.keys(values).map((k) => [k, consent[k]])) } }, summary: lines.join('; ') };
  },
});
const CONSENT_LABEL: Record<string, string> = { logs: 'My logs', health: 'My health answers', research: 'Research sources', nutrition: 'My nutrition' };

function changeCard(fn: string, label: string, lines: string[], page: string, note?: string): CardDraft {
  if (lines.length === 1) {
    const [key, rest] = lines[0].split(' · ');
    const [from, to] = (rest ?? '').split(' → ');
    return { fn, pattern: 'setting', rule: 'change_undo', meta: { label, open: { page } }, change: { key, from, to, ...(note ? { note } : {}) }, undoLine: `Undone — back to ${from}` } as CardDraft;
  }
  return { fn, pattern: 'setting', rule: 'change_undo', meta: { label, open: { page } }, rows: lines.map((l) => { const [key, rest] = l.split(' · '); return { key, value: (rest ?? '').split(' → ')[1] ?? rest, sub: `was ${(rest ?? '').split(' → ')[0]}` }; }), ...(note ? { note } : {}) };
}

const PREF_FN: Partial<Record<PrefKey, string>> = { unitPreference: 'PRF-01', foodRegion: 'PRF-02', subtractWorkoutBurnFromCalories: 'PRF-03', scheduleSharing: 'PRF-10', saveFormStills: 'PRF-12', adaptationEnabled: 'PRF-13', shareTheme: 'PRF-14', timezone: 'PRF-06' };

export const PREF_TOOLS = [
  tool({
    name: 'read_preferences', kind: 'read', fn: 'PRF-00',
    description: 'Read the user’s settings: units, food region, workout-calorie counting, schedule sharing, timezone, form-check stills, progression suggestions, share-card theme, every notification category and reminder time, marketing email, and what Anakin may use (consent).',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Preferences' }),
    execute: async (_i, userId) => readPrefs(userId),
    card: (_i, r) => {
      const toggleRow = (key: string, field: string, on: boolean): CardRow => ({ key, toggle: { field, on } });
      const prefCard: CardDraft = {
        fn: 'PRF-00', pattern: 'glance', rule: 'show', meta: { label: 'Preferences', open: { page: 'prefs' } },
        rows: [
          { key: 'Units', value: display('unitPreference', r.prefs.unitPreference) },
          { key: 'Food region', value: display('foodRegion', r.prefs.foodRegion) },
          toggleRow('Count workout calories', 'countBurn', r.prefs.subtractWorkoutBurnFromCalories !== false),
          toggleRow('Share my training calendar', 'scheduleSharing', !!r.prefs.scheduleSharing),
          toggleRow('Progression suggestions', 'adaptationEnabled', !!r.prefs.adaptationEnabled),
          toggleRow('Save form-check stills', 'saveFormStills', !!r.prefs.saveFormStills),
          { key: 'Timezone', value: r.prefs.timezone },
        ],
        pending: { toggles: {
          countBurn: { op: 'pref.toggle', args: { key: 'subtractWorkoutBurnFromCalories' }, valueKey: 'on' },
          scheduleSharing: { op: 'pref.toggle', args: { key: 'scheduleSharing' }, valueKey: 'on' },
          adaptationEnabled: { op: 'pref.toggle', args: { key: 'adaptationEnabled' }, valueKey: 'on' },
          saveFormStills: { op: 'pref.toggle', args: { key: 'saveFormStills' }, valueKey: 'on' },
        } },
      };
      const n = r.notifications as any;
      const notifCard: CardDraft = {
        fn: 'PRF-05', pattern: 'glance', rule: 'show', meta: { label: 'Notifications', open: { page: 'notifications' } },
        rows: [
          ...Object.entries(NOTIFICATION_CATEGORIES).map(([k, label]) => toggleRow(label, k, n[k] !== false)),
          toggleRow('Nudges when I’m away', 'nudges', !!n.nudges),
          toggleRow('Blog and update emails', 'marketingEmails', !!n.marketingEmails),
          { key: 'Reminder time', value: hourLabel(n.reminderHour) },
        ],
        pending: { toggles: Object.fromEntries([...Object.keys(NOTIFICATION_CATEGORIES), 'nudges', 'marketingEmails'].map((k) => [k, { op: 'notif.toggle', args: { key: k }, valueKey: 'on' }])) },
      };
      return [prefCard, notifCard];
    },
  }),
  tool({
    name: 'set_preferences', kind: 'set', fn: 'PRF-01',
    description: 'Change settings the user asked to change: unitPreference (lb or kg), foodRegion (global, Nigeria, The Gambia, West Africa), subtractWorkoutBurnFromCalories (true = calories burned in workouts are added to that day’s calorie target; false = “don’t add my workout calories back”), scheduleSharing (friends can see my training calendar), timezone (IANA name), saveFormStills (18+), adaptationEnabled (progression suggestions), shareTheme (light or dark). Pass only what changes.',
    input_schema: schema({
      unitPreference: { type: 'string', enum: ['lb', 'kg'] }, foodRegion: { type: 'string' }, subtractWorkoutBurnFromCalories: { type: 'boolean' },
      scheduleSharing: { type: 'boolean' }, timezone: { type: 'string' }, saveFormStills: { type: 'boolean' }, adaptationEnabled: { type: 'boolean' }, shareTheme: { type: 'string', enum: ['light', 'dark'] },
    }),
    receipt: () => ({ verb: 'Adjusted', text: 'Preferences' }),
    execute: async (input, userId) => {
      const values = Object.fromEntries(Object.entries(input).filter(([k, v]) => k in LABEL && v !== undefined && v !== null));
      if (!Object.keys(values).length) throw new Error('Say which setting to change.');
      const change = await executeOp(userId, 'pref.set_many', { values });
      return { lines: (change.result as any).lines, keys: Object.keys(values), _change: change };
    },
    card: async (_i, r) => {
      let note: string | undefined;
      if (r.keys.includes('unitPreference')) {
        note = 'Every weight in the app now shows in the new unit.';
      }
      if (r.keys.includes('subtractWorkoutBurnFromCalories')) note = 'Today’s calorie target updates now.';
      if (r.keys.includes('scheduleSharing')) note = 'Friends in Train Together see or stop seeing your training days.';
      return changeCard(PREF_FN[r.keys[0] as PrefKey] ?? 'PRF-01', 'Preferences', r.lines, 'prefs', note);
    },
  }),
  tool({
    name: 'set_notification_prefs', kind: 'set', fn: 'PRF-05',
    description: 'Turn notification categories on or off or change the reminder time, when the user asks: workoutReminders, weeklySummary, milestones (milestones and PRs), social (friends and messages), groupCheckins, partnerSessions, programUpdates, nudges (away / streak-at-risk nudges and Anakin check-ins), marketingEmails (blog and update emails), weeklyEmail, reminderHour (0–23, local time). Pass only what changes. "Stop all notifications" is a phone setting — use open_phone_settings.',
    input_schema: schema({
      workoutReminders: { type: 'boolean' }, weeklySummary: { type: 'boolean' }, milestones: { type: 'boolean' }, social: { type: 'boolean' },
      groupCheckins: { type: 'boolean' }, partnerSessions: { type: 'boolean' }, programUpdates: { type: 'boolean' }, nudges: { type: 'boolean' },
      marketingEmails: { type: 'boolean' }, weeklyEmail: { type: 'boolean' }, reminderHour: { type: 'number' },
    }),
    receipt: () => ({ verb: 'Adjusted', text: 'Notifications' }),
    execute: async (input, userId) => {
      const values = Object.fromEntries(Object.entries(input).filter(([k, v]) => k in NOTIF_LABEL && v !== undefined && v !== null));
      if (!Object.keys(values).length) throw new Error('Say which notifications to change.');
      const change = await executeOp(userId, 'notif.set', { values });
      return { lines: (change.result as any).lines, _change: change };
    },
    card: (input, r) => changeCard(input.reminderHour != null ? 'PRF-06' : input.nudges != null ? 'PRF-04' : input.marketingEmails != null ? 'PRF-08' : input.weeklyEmail != null ? 'PRF-09' : 'PRF-05', 'Notifications', r.lines, 'notifications',
      input.nudges === false ? 'Stops away nudges, streak-at-risk nudges and my check-ins. Reminders and friends’ messages keep coming unless you turn those off too.' : undefined),
  }),
  tool({
    name: 'update_consent', kind: 'set', fn: 'PRF-11',
    description: 'Change what Anakin may use — only when the user explicitly asks, never as your suggestion: logs (their workout and food logs), health (their health answers), research (research sources), nutrition.',
    input_schema: schema({ logs: { type: 'boolean' }, health: { type: 'boolean' }, research: { type: 'boolean' }, nutrition: { type: 'boolean' } }),
    receipt: () => ({ verb: 'Adjusted', text: 'What I may use' }),
    execute: async (input, userId) => {
      const values = Object.fromEntries(Object.entries(input).filter(([k, v]) => ['logs', 'health', 'research', 'nutrition'].includes(k) && typeof v === 'boolean')) as Record<string, boolean>;
      if (!Object.keys(values).length) throw new Error('Say what to allow or stop.');
      const change = await executeOp(userId, 'consent.set', { values });
      return { lines: (change.result as any).lines, _change: change };
    },
    card: (_i, r) => changeCard('PRF-11', 'What I may use', r.lines, 'prefs'),
  }),
];

// Toggle rows on the preference cards: one op per switch.
defineOp({
  name: 'pref.toggle',
  run: async (userId, args) => {
    const key = String(args.key) as PrefKey;
    const on = !!args.on;
    const value = args.invert ? !on : on;
    const r = await (await import('../ops.js')).getOp('pref.set_many')!.run(userId, { values: { [key]: value } });
    return r;
  },
});
defineOp({
  name: 'notif.toggle',
  run: async (userId, args) => (await import('../ops.js')).getOp('notif.set')!.run(userId, { values: { [String(args.key)]: !!args.on } }),
});

registerToolkit(PREF_TOOLS);
