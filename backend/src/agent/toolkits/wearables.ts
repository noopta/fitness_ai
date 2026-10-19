// Watch data for Anakin (catalog WR-01…02): recovery against the user's own
// baselines, and the day-by-day picture behind it. The numbers and the status
// come from services/wearables/recovery.ts — Anakin words them, he doesn't
// invent a score. Gated on the 'health' consent like other health reads.

import { registerToolkit } from '../registry.js';
import { tool, schema, numOr } from './kit.js';
import { recoveryFor, watchDays } from '../../services/wearables/recovery.js';
import { dayLabel, num, plural } from '../cards/format.js';

const STATUS: Record<string, string> = {
  ready: 'Ready', normal: 'Normal', low: 'A bit low', strained: 'Strained', check_in: 'Check in on how you feel', unknown: 'Not enough data yet',
};
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;

export const WEARABLE_TOOLS = [
  tool({
    name: 'read_recovery', kind: 'read', fn: 'WR-01',
    description: 'Today\'s recovery from the user\'s watch (Apple Watch, Fitbit): HRV and resting heart rate against their own 28-day baseline, last night\'s sleep against their 2-week average, and training load. Returns a status (ready, normal, low, strained, check_in, unknown) with the numbers behind it. Use before advising on today\'s session, when they say they feel tired or run down, or ask about sleep, HRV or recovery. status check_in means resting HR and HRV moved together the way they do when someone is getting ill: ask how they feel and suggest an easy day — never diagnose. unknown means too little data: say so, don\'t guess.',
    input_schema: schema({ date: { type: 'string', description: 'YYYY-MM-DD, default today' } }),
    receipt: () => ({ verb: 'Checked', text: 'Recovery' }),
    refine: (r) => (r?.status ? `Recovery — ${STATUS[r.status]?.toLowerCase() ?? r.status}` : null),
    execute: async (input, userId) => {
      const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : undefined;
      const r = await recoveryFor(userId, date);
      return { ...r, connected: r.confidence > 0 || r.steps != null };
    },
    card: (_i, r) => {
      if (r.status === 'unknown') return { fn: 'WR-01', pattern: 'glance', rule: 'show', meta: { label: 'Recovery' }, empty: r.connected ? 'Not enough watch data yet — a week of nights gives a baseline.' : 'No watch connected.' };
      const rows = [
        r.hrv ? { key: 'HRV', value: `${num(r.hrv.today, 0)} ms`, sub: `usual ${num(r.hrv.baseline, 0)} ms` } : null,
        r.restingHr ? { key: 'Resting HR', value: `${num(r.restingHr.today, 0)}`, sub: `usual ${num(r.restingHr.baseline, 0)}` } : null,
        r.sleep ? { key: 'Sleep', value: hm(r.sleep.lastNight), sub: `2-week average ${hm(r.sleep.baseline)}` } : null,
        r.load ? { key: 'Training load', value: `${r.load.acuteSets} sets`, sub: `usual ${num(r.load.chronicWeeklySets, 0)} a week` } : null,
      ].filter(Boolean) as any[];
      return { fn: 'WR-01', pattern: 'glance', rule: 'show', meta: { label: `Recovery · ${dayLabel(r.date)}` }, hero: { value: STATUS[r.status] ?? r.status }, rows };
    },
  }),
  tool({
    name: 'read_watch_trends', kind: 'read', fn: 'WR-02',
    description: 'Day-by-day watch data for a window (default 14 days, up to 60): sleep, resting heart rate, HRV, steps, active calories. Use for "how has my sleep been", "am I moving enough", or to look for a pattern across days.',
    input_schema: schema({ days: { type: 'number' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Watch data' }),
    execute: async (input, userId) => {
      const n = Math.min(60, Math.max(3, Math.round(numOr(input.days, 14)!)));
      const days = await watchDays(userId, n);
      return { days: days.map((d) => ({ date: d.date, sleepMinutes: d.sleepMinutes, restingHr: d.restingHr, hrvMs: d.hrvMs, steps: d.steps, activeKcal: d.activeKcal })) };
    },
    card: (_i, r) => {
      const d = r.days as any[];
      if (!d.length) return { fn: 'WR-02', pattern: 'glance', rule: 'show', meta: { label: 'Watch data' }, empty: 'No watch data yet.' };
      const slept = d.filter((x) => x.sleepMinutes != null);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const steps = d.filter((x) => x.steps != null).map((x) => x.steps);
      return {
        fn: 'WR-02', pattern: 'glance', rule: 'show', meta: { label: `Watch · ${plural(d.length, 'day')}` },
        ...(slept.length ? { hero: { value: hm(avg(slept.map((x) => x.sleepMinutes))), unit: 'sleep a night' }, bars: { v: slept.map((x) => Math.round(x.sleepMinutes / 6) / 10), labels: slept.map((x) => dayLabel(x.date).slice(0, 3)), hi: slept.findIndex((x) => x.sleepMinutes < 360) } } : {}),
        rows: steps.length ? [{ key: 'Steps', value: `${num(avg(steps), 0)} a day` }] : [],
      };
    },
  }),
];

registerToolkit(WEARABLE_TOOLS);
