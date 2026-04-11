import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
}

// ─── Core send function ───────────────────────────────────────────────────────

export async function sendPushNotification(message: PushMessage): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...message, sound: message.sound ?? 'default' }),
    });
    const json = (await res.json()) as { data: ExpoTicket };
    if (json.data?.status === 'error') {
      console.error('[push] Expo error ticket:', json.data.message);
    }
  } catch (err) {
    console.error('[push] Failed to send notification:', err);
  }
}

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { expoPushToken: true },
  });
  if (!user?.expoPushToken) return;
  await sendPushNotification({ to: user.expoPushToken, title, body, data });
}

// ─── Batch send helpers ───────────────────────────────────────────────────────

/** Send to all users who have a push token. Filter function optional. */
async function sendToAll(
  build: (user: {
    id: string;
    name: string | null;
    coachGoal: string | null;
    savedProgram: string | null;
    programStartDate: Date | null;
    currentStreak: number;
    lastWorkoutDate: string | null;
  }) => { title: string; body: string; data?: Record<string, unknown> } | null
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { expoPushToken: { not: null } },
    select: {
      id: true,
      name: true,
      coachGoal: true,
      savedProgram: true,
      programStartDate: true,
      currentStreak: true,
      lastWorkoutDate: true,
      expoPushToken: true,
    },
  });

  const messages: PushMessage[] = [];
  for (const u of users) {
    const payload = build(u);
    if (!payload || !u.expoPushToken) continue;
    messages.push({ to: u.expoPushToken, ...payload });
  }

  // Send in batches of 100 (Expo limit)
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      console.error('[push] Batch send error:', err);
    }
  }
  console.log(`[push] Sent batch of ${messages.length} notification(s)`);
}

// ─── Scheduled: Nightly contextual notifications ──────────────────────────────
// Runs every night. Sends personalised nudges based on program schedule,
// streak state, and inactivity — one notification per user max per day.

export async function runNightlyNotifications(): Promise<void> {
  console.log('[push] Running nightly notifications...');

  const todayStr = new Date().toISOString().split('T')[0];

  await sendToAll(user => {
    const first = user.name?.split(' ')[0] || 'Coach';

    // Re-engagement: hasn't logged in 3+ days
    if (user.lastWorkoutDate) {
      const last = new Date(user.lastWorkoutDate);
      const daysSince = Math.floor((Date.now() - last.getTime()) / 86400000);
      if (daysSince >= 3 && daysSince <= 7) {
        return {
          title: `${first}, Anakin noticed you've been away`,
          body: `It's been ${daysSince} days since your last session. Even 20 minutes today keeps your momentum going.`,
          data: { screen: 'coach', tab: 'overview' },
        };
      }
    }

    // Streak milestone approaching (6 days = tomorrow is 7)
    if (user.currentStreak === 6) {
      return {
        title: '7-day streak tomorrow 🔥',
        body: `You're on a ${user.currentStreak}-day streak. Log a workout tomorrow to hit your first milestone.`,
        data: { screen: 'coach', tab: 'overview' },
      };
    }

    // Program session reminder: notify only when today is a scheduled training day
    if (user.savedProgram && user.programStartDate) {
      try {
        const program = JSON.parse(user.savedProgram);
        const start = new Date(user.programStartDate);
        start.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayOffset = Math.floor((today.getTime() - start.getTime()) / 86400000);
        if (dayOffset >= 0) {
          const phases = program.phases || [];
          let totalDays = 0;
          for (const phase of phases) {
            const trainingDays: Array<{ day: string; focus: string }> = phase.trainingDays || [];
            const phaseDays = (phase.durationWeeks || 1) * 7;
            if (dayOffset < totalDays + phaseDays) {
              const dayInWeek = dayOffset % 7;
              const session = dayInWeek < trainingDays.length ? trainingDays[dayInWeek] : null;
              if (session) {
                return {
                  title: `Today: ${session.focus}`,
                  body: `Your ${session.day} session is on the schedule today. Anakin has your program ready.`,
                  data: { screen: 'coach', tab: 'program' },
                };
              }
              break;
            }
            totalDays += phaseDays;
          }
        }
      } catch {
        // Malformed program JSON — skip
      }
    }

    return null; // No notification for this user tonight
  });
}

// ─── Scheduled: Weekly summary (runs Sunday evenings) ────────────────────────

export async function runWeeklySummary(): Promise<void> {
  console.log('[push] Running weekly summary notifications...');

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekStart = sevenDaysAgo.toISOString().split('T')[0];

  const users = await prisma.user.findMany({
    where: { expoPushToken: { not: null }, coachOnboardingDone: true },
    select: { id: true, name: true, expoPushToken: true, currentStreak: true },
  });

  for (const user of users) {
    if (!user.expoPushToken) continue;

    // Parallel fetch of this week's data
    const [workoutLogs, nutritionLogs, bwLogs] = await Promise.all([
      prisma.workoutLog.findMany({
        where: { userId: user.id, date: { gte: weekStart } },
        select: { date: true },
      }),
      prisma.nutritionLog.findMany({
        where: { userId: user.id, date: { gte: weekStart } },
        select: { proteinG: true, calories: true },
      }),
      prisma.bodyWeightLog.findMany({
        where: { userId: user.id, date: { gte: weekStart } },
        orderBy: { date: 'asc' },
        select: { weightLbs: true },
      }),
    ]);

    const sessions = workoutLogs.length;
    if (sessions === 0) continue; // No activity — skip summary

    const avgProtein = nutritionLogs.length > 0
      ? Math.round(nutritionLogs.reduce((s, l) => s + l.proteinG, 0) / nutritionLogs.length)
      : null;

    const bwDelta = bwLogs.length >= 2
      ? (bwLogs[bwLogs.length - 1].weightLbs - bwLogs[0].weightLbs).toFixed(1)
      : null;

    const first = user.name?.split(' ')[0] || 'there';
    const parts: string[] = [`${sessions} workout${sessions > 1 ? 's' : ''} logged`];
    if (avgProtein) parts.push(`avg ${avgProtein}g protein`);
    if (bwDelta) parts.push(`weight ${Number(bwDelta) >= 0 ? '+' : ''}${bwDelta} lbs`);
    if (user.currentStreak > 0) parts.push(`${user.currentStreak}-day streak`);

    await sendPushNotification({
      to: user.expoPushToken,
      title: `Your week in review, ${first}`,
      body: parts.join(' · '),
      data: { screen: 'coach', tab: 'analytics' },
    });
  }

  console.log(`[push] Weekly summary sent to ${users.length} user(s)`);
}

// ─── Instant: PR / milestone notification ────────────────────────────────────

export async function notifyNewPR(
  userId: string,
  liftName: string,
  newRM: number,
  unit: 'lbs' | 'kg' = 'lbs'
): Promise<void> {
  await sendPushToUser(
    userId,
    `New PR on ${liftName} 🏆`,
    `Anakin just detected a new estimated 1RM of ${newRM}${unit}. Open your Strength Profile to see the full picture.`,
    { screen: 'strength-profile' }
  );
}

export async function notifyStreakMilestone(
  userId: string,
  streak: number
): Promise<void> {
  const milestones: Record<number, string> = {
    7: "7 days straight. That's a habit forming.",
    14: "2 weeks of consistency. Anakin is impressed.",
    30: "30-day streak. You're in the top 1% of users.",
  };
  const msg = milestones[streak];
  if (!msg) return;
  await sendPushToUser(
    userId,
    `${streak}-day streak 🔥`,
    msg,
    { screen: 'coach', tab: 'overview' }
  );
}
