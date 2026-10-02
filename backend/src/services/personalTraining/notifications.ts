// Trainer notifications (handoff §6.7): three delivery tiers per event type,
// quiet by default. Events are detected by sweeping what clients already log
// — no hooks in the logging paths every user hits — and each one is stored
// once under a stable key, so sweeping the same hour twice is harmless.

import { sendEmail, isMailConfigured } from '../mailService.js';
import { sendPushToUser } from '../notificationService.js';
import { formatWeight, normalizePreference, type UnitPreference } from '../weightUnits.js';
import { prisma } from './db.js';
import { loadPracticeData, type PracticeData } from './data.js';
import { LIFT_LABEL, liftHistory, liftTrend, prEvents, weeklyBest } from './lifts.js';
import { EVENT_TYPES, eventDef, isTier, resolveTier, type TierSettings } from './notificationRules.js';
import { painMention } from './signals.js';
import { hourIn } from './status.js';
import type {
  LiftKey, NotificationFeed, NotificationOverride, NotificationSettings, NotificationSettingsPatch, Tier,
} from './types.js';

const DAY_MS = 86_400_000;

export class SettingsError extends Error {}

export interface DetectedEvent {
  eventType: string;
  clientId: string;
  sourceKey: string;
  at: Date;
  title: string;
  body: string;
}

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};
const preview = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Every notifiable event between `from` and `data.now`. Pure. */
export function detectEvents(data: PracticeData, from: Date, pref: UnitPreference): DetectedEvent[] {
  const now = data.now;
  const inWindow = (d: Date) => d.getTime() > from.getTime() && d.getTime() <= now.getTime();
  const fmt = (kg: number) => formatWeight(kg, pref) ?? '';
  const out: DetectedEvent[] = [];

  for (const c of data.clients) {
    const d = data.byClient.get(c.id)!;
    const push = (eventType: string, sourceKey: string, at: Date, title: string, body: string) =>
      out.push({ eventType, clientId: c.id, sourceKey, at, title, body });

    for (const w of d.workouts) {
      if (!inWindow(w.createdAt)) continue;
      push('workoutLogged', `workout:${w.id}`, w.createdAt, `${c.name} logged a workout`, w.title?.trim() || 'Workout');
      const pain = painMention(w.notes);
      if (pain) push('painReported', `pain:workout:${w.id}`, w.createdAt, `${c.name} reported pain`, `In a workout note: "${preview(pain)}"`);
    }
    for (const e of prEvents(d.workouts)) {
      if (inWindow(e.at)) push('pr', `pr:${e.logId}:${e.lift.toLowerCase()}`, e.at, `${c.name} hit a PR`, `${e.lift}, estimated 1RM ${fmt(e.e1rm)}`);
    }
    for (const w of d.weights) {
      if (inWindow(w.createdAt)) push('bodyweightLogged', `bw:${w.id}`, w.createdAt, `${c.name} logged bodyweight`, '');
    }
    for (const m of d.messages) {
      if (!m.fromClient || !inWindow(m.createdAt)) continue;
      push('messageWaiting', `msg:${m.id}`, m.createdAt, `${c.name} sent a message`, preview(m.body));
      const pain = painMention(m.body);
      if (pain) push('painReported', `pain:msg:${m.id}`, m.createdAt, `${c.name} reported pain`, `In a message: "${preview(pain)}"`);
    }
    for (const k of d.checkIns) {
      if (k.status === 'submitted' && k.submittedAt && inWindow(k.submittedAt)) {
        push('checkInSubmitted', `checkin:${k.id}`, k.submittedAt, `${c.name} submitted a check-in`, preview(k.summary ?? ''));
        let answers: { answer?: string }[] = [];
        try { answers = JSON.parse(k.answersJson ?? '[]'); } catch { /* no signal */ }
        const pain = answers.map((a) => painMention(a.answer)).find(Boolean);
        if (pain) push('painReported', `pain:checkin:${k.id}`, k.submittedAt, `${c.name} reported pain`, `In a check-in: "${preview(pain)}"`);
      }
      if (k.status === 'missed' && inWindow(k.dueAt)) push('missedCheckIn', `missed:${k.id}`, k.dueAt, `${c.name} missed a check-in`, '');
    }
    for (const w of d.wellness) {
      if (inWindow(w.createdAt) && w.stress >= 4 && w.energy <= 2) {
        push('recoveryTrend', `recovery:${w.id}`, w.createdAt, `${c.name} reported high stress and low energy`, `Stress ${w.stress}/5, energy ${w.energy}/5, sleep ${w.sleepHours} h`);
      }
    }
    for (const p of d.proposals) {
      if (inWindow(p.createdAt)) push('anakinSuggestion', `proposal:${p.id}`, p.createdAt, `Axiom suggested a change for ${c.name}`, preview(p.title));
    }
    // The moment a client crosses seven days without a session.
    const anchor = new Date(c.lastSessionAt ?? c.joinedAt);
    const crossed = new Date(anchor.getTime() + 7 * DAY_MS);
    if (inWindow(crossed)) push('noSession7d', `inactive:${c.id}:${anchor.toISOString().slice(0, 10)}`, crossed, `${c.name} has not logged a session in 7 days`, '');

    // State as of now, keyed by week so each fires at most once a week.
    if (c.statusReason?.startsWith('Engagement down')) {
      push('engagementDrop', `engagement:${c.id}:${isoWeek(now)}`, now, `${c.name}'s engagement is falling`, c.statusReason);
    }
    for (const lift of ['squat', 'bench', 'deadlift'] as LiftKey[]) {
      const history = liftHistory(d.workouts, lift);
      const latest = history[history.length - 1];
      if (!latest || now.getTime() - latest.at.getTime() > 14 * DAY_MS) continue;
      const trend = liftTrend(weeklyBest(history, 6, now));
      if (trend.status === 'plateau' && trend.latestKg !== null) {
        push('plateau', `plateau:${c.id}:${lift}:${isoWeek(now)}`, now, `${c.name}'s ${LIFT_LABEL[lift].toLowerCase()} has stalled`, `Estimated 1RM holding at ${fmt(trend.latestKg)}`);
      }
    }
  }
  return out;
}

// ── Settings ─────────────────────────────────────────────────────────────────

interface StoredSettings extends TierSettings {
  channels: { push: boolean; email: boolean };
  quietStart: number;
  quietEnd: number;
}

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try { return json ? (JSON.parse(json) as T) : fallback; } catch { return fallback; }
};

export async function loadSettings(practiceId: string, trainerId: string): Promise<StoredSettings> {
  const row = await prisma.ptNotificationSettings.findUnique({ where: { practiceId_trainerId: { practiceId, trainerId } } });
  const rules = parse<Record<string, Tier>>(row?.rulesJson, {});
  const channels = parse<Partial<{ push: boolean; email: boolean }>>(row?.channelsJson, {});
  return {
    rules: Object.fromEntries(Object.entries(rules).filter(([k, v]) => eventDef(k) && isTier(v))),
    overrides: parse<NotificationOverride[]>(row?.overridesJson, []),
    channels: { push: channels.push !== false, email: channels.email === true },
    quietStart: row?.quietStart ?? 21,
    quietEnd: row?.quietEnd ?? 7,
  };
}

/** Validate and merge a settings change. Throws SettingsError with the reason a change is refused. */
export function applyPatch(current: StoredSettings, patch: NotificationSettingsPatch, clientIds: Set<string>): StoredSettings {
  const next: StoredSettings = { ...current, rules: { ...current.rules }, channels: { ...current.channels } };

  for (const [type, tier] of Object.entries(patch.rules ?? {})) {
    const def = eventDef(type);
    if (!def) throw new SettingsError(`Unknown event type "${type}"`);
    if (!isTier(tier)) throw new SettingsError(`Unknown tier for ${def.label}`);
    if (def.locked && tier === 'timeline') throw new SettingsError(`${def.label} cannot be set to Timeline only. Safety events always reach you.`);
    next.rules[type] = tier;
  }

  if (patch.channels) {
    if (typeof patch.channels.push === 'boolean') next.channels.push = patch.channels.push;
    if (typeof patch.channels.email === 'boolean') next.channels.email = patch.channels.email;
  }

  if (patch.quietHours) {
    const { start, end } = patch.quietHours;
    const ok = (h: unknown) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23;
    if (!ok(start) || !ok(end)) throw new SettingsError('Quiet hours must be whole hours between 0 and 23');
    next.quietStart = start;
    next.quietEnd = end;
  }

  if (patch.overrides) {
    if (!Array.isArray(patch.overrides) || patch.overrides.length > 100) throw new SettingsError('Too many overrides');
    next.overrides = patch.overrides.map((o) => {
      if (!clientIds.has(o.clientId)) throw new SettingsError('An override names someone who is not your client');
      const def = o.eventType === '*' ? undefined : eventDef(o.eventType);
      if (o.eventType !== '*' && !def) throw new SettingsError(`Unknown event type "${o.eventType}"`);
      if (!isTier(o.tier)) throw new SettingsError('Unknown tier in an override');
      if (def?.locked && o.tier === 'timeline') throw new SettingsError(`${def.label} cannot be set to Timeline only. Safety events always reach you.`);
      if (o.expiresAt && Number.isNaN(new Date(o.expiresAt).getTime())) throw new SettingsError('Override expiry is not a valid date');
      return {
        clientId: o.clientId,
        eventType: o.eventType,
        tier: o.tier,
        ...(o.note ? { note: String(o.note).slice(0, 120) } : {}),
        ...(o.expiresAt ? { expiresAt: new Date(o.expiresAt).toISOString() } : {}),
      };
    });
  }
  return next;
}

export async function saveSettings(practiceId: string, trainerId: string, s: StoredSettings) {
  const data = {
    rulesJson: JSON.stringify(s.rules),
    channelsJson: JSON.stringify(s.channels),
    overridesJson: JSON.stringify(s.overrides),
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
  };
  await prisma.ptNotificationSettings.upsert({
    where: { practiceId_trainerId: { practiceId, trainerId } },
    update: data,
    create: { practiceId, trainerId, ...data },
  });
}

/** Settings as the page shows them, with trailing-four-week rates so the estimate is live. */
export function describeSettings(s: StoredSettings, data: PracticeData, pref: UnitPreference): NotificationSettings {
  const month = detectEvents(data, new Date(data.now.getTime() - 28 * DAY_MS), pref);
  const perType = new Map<string, number>();
  for (const e of month) perType.set(e.eventType, (perType.get(e.eventType) ?? 0) + 1);

  const names = new Map(data.clients.map((c) => [c.id, c.name]));
  const rules = EVENT_TYPES.map((def) => ({
    eventType: def.type,
    label: def.label,
    group: def.group,
    tier: resolveTier(s, def.type, null, data.now),
    defaultTier: def.defaultTier,
    ...(def.locked ? { locked: true } : {}),
    perWeek: Math.round(((perType.get(def.type) ?? 0) / 4) * 10) / 10,
  }));
  const tierCounts: Record<Tier, number> = { immediate: 0, briefing: 0, timeline: 0 };
  for (const r of rules) tierCounts[r.tier] += 1;

  // Per-event, so a per-client override that makes everything immediate is counted too.
  const immediate = month.filter((e) => resolveTier(s, e.eventType, e.clientId, data.now) === 'immediate').length;
  return {
    rules,
    tierCounts,
    weeklyEstimate: Math.round(immediate / 4),
    channels: s.channels,
    quietHours: { start: s.quietStart, end: s.quietEnd },
    overrides: s.overrides.map((o) => ({ ...o, clientName: names.get(o.clientId) })),
  };
}

// ── Sweep and delivery ───────────────────────────────────────────────────────

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Record events from the last day and deliver the ones that are 'immediate'. Returns how many were new. */
export async function sweepNotifications(practiceId: string, trainerId: string, now: Date = new Date()): Promise<number> {
  const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { email: true, unitPreference: true, timezone: true } });
  const pref = normalizePreference(trainer?.unitPreference);
  const data = await loadPracticeData(practiceId, trainerId, { now });
  if (data.clients.length === 0) return 0;

  const events = detectEvents(data, new Date(now.getTime() - DAY_MS), pref);
  if (events.length === 0) return 0;
  const existing = await prisma.ptNotification.findMany({
    where: { trainerId, sourceKey: { in: events.map((e) => e.sourceKey) } },
    select: { sourceKey: true },
  });
  const known = new Set(existing.map((e) => e.sourceKey));
  const fresh = events.filter((e) => !known.has(e.sourceKey));
  if (fresh.length === 0) return 0;

  const settings = await loadSettings(practiceId, trainerId);
  const quiet = inQuietHours(hourIn(trainer?.timezone, now), settings.quietStart, settings.quietEnd);
  let created = 0;
  for (const e of fresh) {
    const tier = resolveTier(settings, e.eventType, e.clientId, now);
    try {
      const row = await prisma.ptNotification.create({
        data: { practiceId, trainerId, clientId: e.clientId, eventType: e.eventType, tier, title: e.title, body: e.body, sourceKey: e.sourceKey, at: e.at },
      });
      created += 1;
      if (tier !== 'immediate') continue;
      // Safety events bypass quiet hours; everything else waits in the bell.
      if (quiet && !eventDef(e.eventType)?.locked) continue;
      if (settings.channels.push) {
        sendPushToUser(trainerId, e.title, e.body || 'Open your trainer dashboard', { type: 'personal_training', clientId: e.clientId, eventType: e.eventType }).catch(() => {});
      }
      if (settings.channels.email && trainer?.email && isMailConfigured()) {
        sendEmail({ to: trainer.email, subject: e.title, text: `${e.title}\n\n${e.body}`, html: `<p><strong>${e.title}</strong></p><p>${e.body}</p>` }).catch(() => {});
      }
      await prisma.ptNotification.update({ where: { id: row.id }, data: { pushedAt: now } });
    } catch {
      // Unique (trainerId, sourceKey): another sweep recorded it first.
    }
  }
  return created;
}

export async function notificationFeed(practiceId: string, trainerId: string, now: Date = new Date()): Promise<NotificationFeed> {
  const lastBriefing = await prisma.ptBriefing.findFirst({
    where: { practiceId, trainerId, status: 'ready' },
    orderBy: { date: 'desc' },
    select: { generatedAt: true },
  });
  const heldSince = lastBriefing?.generatedAt ?? new Date(now.getTime() - DAY_MS);
  const [immediate, unread, heldForBriefing, recordedQuietly] = await Promise.all([
    prisma.ptNotification.findMany({
      where: { practiceId, trainerId, tier: 'immediate', at: { gte: new Date(now.getTime() - 14 * DAY_MS) } },
      orderBy: { at: 'desc' },
      take: 30,
    }),
    prisma.ptNotification.count({ where: { practiceId, trainerId, tier: 'immediate', readAt: null } }),
    prisma.ptNotification.count({ where: { practiceId, trainerId, tier: 'briefing', at: { gt: heldSince } } }),
    prisma.ptNotification.count({ where: { practiceId, trainerId, tier: 'timeline', at: { gt: new Date(now.getTime() - DAY_MS) } } }),
  ]);
  return {
    immediate: immediate.map((n) => ({
      id: n.id, clientId: n.clientId, eventType: n.eventType, title: n.title, body: n.body, at: n.at.toISOString(), read: !!n.readAt,
    })),
    unread,
    heldForBriefing,
    recordedQuietly,
  };
}

export async function markRead(practiceId: string, trainerId: string, ids?: string[]) {
  await prisma.ptNotification.updateMany({
    where: { practiceId, trainerId, readAt: null, ...(ids?.length ? { id: { in: ids } } : { tier: 'immediate' }) },
    data: { readAt: new Date() },
  });
}
