// Per-user preferences that aren't flat columns: notification categories,
// reminder hour, and small device-independent settings (saveFormStills,
// adaptationEnabled, shareTheme). JSON on User; defaults are "on".

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const NOTIFICATION_CATEGORIES = {
  workoutReminders: 'Workout reminders',
  weeklySummary: 'Weekly summary',
  milestones: 'Milestones and PRs',
  social: 'Friends and messages',
  groupCheckins: 'Group check-ins',
  partnerSessions: 'Partner sessions',
  programUpdates: 'Program updates',
} as const;
export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export interface NotificationPrefs {
  workoutReminders: boolean; weeklySummary: boolean; milestones: boolean; social: boolean;
  groupCheckins: boolean; partnerSessions: boolean; programUpdates: boolean;
  weeklyEmail: boolean;
  /** Local hour (0–23) for the daily workout reminder. */
  reminderHour: number;
}
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  workoutReminders: true, weeklySummary: true, milestones: true, social: true,
  groupCheckins: true, partnerSessions: true, programUpdates: true, weeklyEmail: false, reminderHour: 20,
};

export interface UserPrefs { saveFormStills: boolean; adaptationEnabled: boolean; shareTheme: 'light' | 'dark' }
export const DEFAULT_USER_PREFS: UserPrefs = { saveFormStills: false, adaptationEnabled: true, shareTheme: 'light' };

const parse = <T>(raw: string | null | undefined, d: T): T => {
  if (!raw) return { ...d };
  try { return { ...d, ...(JSON.parse(raw) as Partial<T>) }; } catch { return { ...d }; }
};
export const parseNotificationPrefs = (raw: string | null | undefined) => parse<NotificationPrefs>(raw, DEFAULT_NOTIFICATION_PREFS);
export const parseUserPrefs = (raw: string | null | undefined) => parse<UserPrefs>(raw, DEFAULT_USER_PREFS);

export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefsJson: true } });
  return parseNotificationPrefs(u?.notificationPrefsJson);
}
export async function getUserPrefs(userId: string): Promise<UserPrefs> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prefsJson: true } });
  return parseUserPrefs(u?.prefsJson);
}

/** Whether a push in this category may go to this user. Unknown user → false. */
export async function pushAllowed(userId: string, category: NotificationCategory): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefsJson: true } }).catch(() => null);
  if (!u) return false;
  return parseNotificationPrefs(u.notificationPrefsJson)[category] !== false;
}
