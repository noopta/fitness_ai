// Daily training reminder — local notification scheduled with
// expo-notifications. Intentionally CLIENT-side so we don't need a backend
// cron. Direct attack on the 6% week-1 retention finding from the
// user-psychology audit: most users have no reason to come back on day 2.
//
// Default fire time is 08:00 local. The user can later override the hour
// from a settings screen; the scheduling code below is idempotent — calling
// it again replaces the old request.

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REMINDER_ID_KEY = 'daily-reminder:notification-id:v1';
const REMINDER_HOUR_KEY = 'daily-reminder:hour:v1';
const DEFAULT_HOUR = 8;

// Friendly copy bank — rotate-ish so the push doesn't feel like a robot.
// Picked client-side so we don't need a backend round trip.
const COPY = [
  { title: "Today's session is waiting", body: "Anakin queued up your workout — tap to see what's on." },
  { title: 'Time to lift', body: 'Your plan has a session today. Tap to log it in 30s.' },
  { title: 'Quick check-in', body: 'Hit your protein yesterday? Anakin will tell you in one tap.' },
  { title: 'Stay on the program', body: 'Two days a week is what keeps the gains. See today\'s plan.' },
  { title: "What's today's lift?", body: 'Open Anakin to see the prescription — sets, reps, RPE.' },
];

function pickCopy(): { title: string; body: string } {
  const i = (new Date().getDay() + new Date().getDate()) % COPY.length;
  return COPY[i] ?? COPY[0];
}

/**
 * Schedule (or reschedule) the daily reminder for the user's chosen hour.
 * Cancels any prior scheduled reminder first so we never accumulate
 * duplicates across app launches.
 *
 * @returns the scheduled notification id, or null if scheduling failed
 *          (permission denied, etc.).
 */
export async function scheduleDailyReminder(hour: number = DEFAULT_HOUR): Promise<string | null> {
  try {
    // Permission gate — without it the schedule call silently drops.
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return null;

    // Cancel the previous schedule so the new one fully replaces it.
    const prevId = await AsyncStorage.getItem(REMINDER_ID_KEY).catch(() => null);
    if (prevId) {
      await Notifications.cancelScheduledNotificationAsync(prevId).catch(() => {});
    }

    const { title, body } = pickCopy();
    // CalendarTrigger fires daily at HH:00. Expo handles DST + locale
    // automatically. Using minute:0 keeps the notification on the hour so
    // users perceive a predictable rhythm.
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { screen: '/(tabs)/coach', source: 'daily-reminder' },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour,
        minute: 0,
        repeats: true,
      } as any,
    });

    await AsyncStorage.setItem(REMINDER_ID_KEY, id).catch(() => {});
    await AsyncStorage.setItem(REMINDER_HOUR_KEY, String(hour)).catch(() => {});
    return id;
  } catch {
    return null;
  }
}

/** Cancel the daily reminder (used on logout or user opt-out). */
export async function cancelDailyReminder(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(REMINDER_ID_KEY).catch(() => null);
    if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    await AsyncStorage.removeItem(REMINDER_ID_KEY).catch(() => {});
  } catch { /* silent */ }
}

/** Read the user's currently-configured reminder hour (or the default). */
export async function getReminderHour(): Promise<number> {
  const raw = await AsyncStorage.getItem(REMINDER_HOUR_KEY).catch(() => null);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 24 ? n : DEFAULT_HOUR;
}

/**
 * Bootstrap on app launch: if we have permission and no prior schedule,
 * lay down the default 8 AM reminder. Idempotent — repeated calls just
 * reschedule with the existing hour preference.
 */
export async function ensureDailyReminderScheduled(): Promise<void> {
  const hour = await getReminderHour();
  await scheduleDailyReminder(hour);
}
