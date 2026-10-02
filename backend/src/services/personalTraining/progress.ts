// Progress (handoff §6.5): per-client estimated-1RM trend on a chosen lift,
// adherence, and the plateau call — all from the same rules the briefing uses.

import { displayWeight, unitLabel, type UnitPreference } from '../weightUnits.js';
import type { PracticeData } from './data.js';
import { LIFTS, LIFT_LABEL, fillForward, liftHistory, liftTrend, prEvents, weeklyBest } from './lifts.js';
import type { LiftKey, ProgressResponse, ProgressRow, ProgressStatus } from './types.js';

const DAY_MS = 86_400_000;
const ORDER: Record<ProgressStatus, number> = { regressing: 0, plateau: 1, progressing: 2, noData: 3 };

export function buildProgress(data: PracticeData, lift: LiftKey, weeks: number, pref: UnitPreference): ProgressResponse {
  const now = data.now;
  const windowStart = now.getTime() - weeks * 7 * DAY_MS;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
  const label = LIFT_LABEL[lift];
  let prsThisMonth = 0;

  const rows: ProgressRow[] = data.clients.map((c) => {
    const d = data.byClient.get(c.id)!;
    prsThisMonth += prEvents(d.workouts).filter((e) => e.at.getTime() >= monthStart).length;

    const weekly = weeklyBest(liftHistory(d.workouts, lift), weeks, now);
    const trend = liftTrend(weekly);
    const sessions = d.workouts.filter((w) => w.createdAt.getTime() > windowStart).length;
    const planned = c.sessionsPerWeek * weeks;
    return {
      clientId: c.id,
      client: { id: c.id, name: c.name, initials: c.initials },
      lift: label,
      e1rm: trend.latestKg === null ? null : displayWeight(trend.latestKg, pref),
      series: fillForward(weekly).map((kg) => displayWeight(kg, pref)),
      change: trend.changeKg === null ? null : displayWeight(trend.changeKg, pref),
      adherence: planned ? Math.min(100, Math.round((sessions / planned) * 100)) : 0,
      status: trend.status,
      ...(trend.status === 'noData'
        ? { note: trend.exposures === 0 ? `No ${label.toLowerCase()} logged in the last ${weeks} weeks` : `Only ${trend.exposures} week${trend.exposures === 1 ? '' : 's'} of data; three are needed for a trend` }
        : {}),
    };
  });

  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.client.name.localeCompare(b.client.name));
  return {
    lift,
    lifts: LIFTS.map((l) => ({ key: l.key, label: l.label })),
    weeks,
    unit: unitLabel(pref),
    kpis: {
      progressing: rows.filter((r) => r.status === 'progressing').length,
      plateau: rows.filter((r) => r.status === 'plateau' || r.status === 'regressing').length,
      prsThisMonth,
    },
    rows,
  };
}
