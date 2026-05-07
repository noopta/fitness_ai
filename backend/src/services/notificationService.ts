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
  const msg = milestoneCopy(streak);
  if (!msg) return;
  await sendPushToUser(
    userId,
    `${streak}-day streak 🔥`,
    msg,
    { screen: 'coach', tab: 'overview' }
  );
}

// ─── Streak reinforcement (positive + loss-aversion) ──────────────────────────

type StreakKind = 'workout' | 'nutrition';

const KIND_LABEL: Record<StreakKind, string> = {
  workout: 'workout',
  nutrition: 'nutrition',
};

function milestoneCopy(streak: number): string | null {
  // Varied copy per milestone — habituation kills these notifications fast
  // when every "7-day streak" message reads the same.
  switch (streak) {
    case 3:   return "Three days in a row. Momentum is real.";
    case 7:   return "7 days straight. That's a habit forming.";
    case 14:  return "Two weeks of consistency. Most people quit before this.";
    case 21:  return "21 days — the science says you're rewriting defaults now.";
    case 30:  return "30 days. You're in the top 1% of users.";
    case 60:  return "Two months in. This is your new normal.";
    case 90:  return "90 days. You're a different athlete than the one who started.";
    case 100: return "Triple digits. Anakin is genuinely impressed.";
    case 180: return "Half a year. Keep this up and you'll outwork everyone you know.";
    case 365: return "365 days. A full year. Take a screenshot.";
    default:  return null;
  }
}

/**
 * "About to lose your streak" — fires before midnight on a day the user hasn't
 * logged yet. Pure loss-aversion play; this is the highest-leverage push.
 */
export async function notifyStreakAtRisk(
  userId: string,
  kind: StreakKind,
  streak: number,
): Promise<void> {
  const tab = kind === 'nutrition' ? 'nutrition' : 'overview';
  const titles = [
    `Don't break your ${streak}-day streak`,
    `${streak} days · don't drop it now`,
    `Your streak is on the line`,
  ];
  const bodies = kind === 'workout'
    ? [
        `You haven't logged a workout today. Even a quick session keeps your ${streak}-day streak alive.`,
        `One log saves your ${streak}-day streak. You've come too far to lose it.`,
        `${streak} days of work. Don't let tonight be the gap.`,
      ]
    : [
        `Log your nutrition today to keep your ${streak}-day streak going.`,
        `Your ${streak}-day nutrition streak ends at midnight if you don't log.`,
        `Quick meal log = streak saved.`,
      ];
  const title = titles[streak % titles.length];
  const body = bodies[streak % bodies.length];

  await sendPushToUser(userId, title, body, { screen: 'coach', tab });

  // Stamp the user so we don't double-fire today
  await prisma.user.update({
    where: { id: userId },
    data: { lastStreakAtRiskAt: new Date() },
  }).catch(() => { /* ignore */ });
}

/**
 * Variable-reward surprise — slot-machine-style intermittent reinforcement.
 * Fires on a random ~15% of logs after streak ≥ 5, never on milestone days.
 * Vary copy so it feels rare and fresh.
 */
export async function notifySurpriseReward(
  userId: string,
  kind: StreakKind,
  streak: number,
): Promise<void> {
  const variants = [
    `🎰 Surprise: you've out-logged 87% of users this week.`,
    `🎯 You're ahead of where you were a month ago. Keep going.`,
    `⚡ Anakin noticed: you haven't missed a ${KIND_LABEL[kind]} log in ${streak} days.`,
    `🔥 Quiet flex: ${streak} days, no breaks. Most people would have folded.`,
  ];
  const title = `${streak}-day ${KIND_LABEL[kind]} streak`;
  const body = variants[Math.floor(Math.random() * variants.length)];
  await sendPushToUser(userId, title, body, { screen: 'coach', tab: 'overview' });
}

/** Comeback nudge — user is rebuilding after losing a streak. Endowed progress. */
export async function notifyComeback(
  userId: string,
  kind: StreakKind,
  oldLongest: number,
): Promise<void> {
  const tab = kind === 'nutrition' ? 'nutrition' : 'overview';
  await sendPushToUser(
    userId,
    `Welcome back`,
    `Your old streak peaked at ${oldLongest} days. Day 1 of the next one starts now.`,
    { screen: 'coach', tab },
  );
}

/** New personal best — frames as mastery, not just numbers. */
export async function notifyPersonalBest(
  userId: string,
  kind: StreakKind,
  streak: number,
): Promise<void> {
  const tab = kind === 'nutrition' ? 'nutrition' : 'overview';
  await sendPushToUser(
    userId,
    `New personal best 🏅`,
    `${streak} days — that's a new ${KIND_LABEL[kind]} record for you. Anakin is keeping count.`,
    { screen: 'coach', tab },
  );
}

/**
 * Body-weight progress milestone — fires when the user crosses ±5/10/15+ lbs
 * in their goal direction. Loss-aversion is high once these stack up, so the
 * copy frames the milestone as evidence of compounding work, not a finish line.
 */
export async function notifyWeightProgress(
  userId: string,
  deltaLbs: number,
  direction: 'lose' | 'gain',
): Promise<void> {
  const verb = direction === 'lose' ? 'down' : 'up';
  const titleEmoji = direction === 'lose' ? '📉' : '📈';
  const bodyByMilestone: Record<number, string> = {
    5:  `${deltaLbs} lbs ${verb}. The first milestone is the hardest — and you're past it.`,
    10: `${deltaLbs} lbs ${verb}. Compounding work is paying off. Anakin sees it.`,
    15: `${deltaLbs} lbs ${verb}. Most people quit before this. You didn't.`,
    20: `${deltaLbs} lbs ${verb}. That's a different body composition. Keep going.`,
    25: `${deltaLbs} lbs ${verb}. You've changed your trajectory.`,
    30: `${deltaLbs} lbs ${verb}. Take the win. Then keep stacking.`,
  };
  const body = bodyByMilestone[deltaLbs] ?? `${deltaLbs} lbs ${verb}. Real, measurable progress.`;
  await sendPushToUser(
    userId,
    `${deltaLbs} lbs ${verb} ${titleEmoji}`,
    body,
    { screen: 'coach', tab: 'analytics' },
  );
}

/**
 * Protein-target hit (today) — small reinforce on the first hit of the day so
 * users feel the win immediately. Avoids spamming on every meal log because
 * the route only calls this when the daily total crosses the threshold.
 */
export async function notifyProteinTargetHit(
  userId: string,
  proteinGActual: number,
  proteinGTarget: number,
): Promise<void> {
  await sendPushToUser(
    userId,
    `Protein target hit 💪`,
    `${Math.round(proteinGActual)}g / ${proteinGTarget}g target. Recovery just got a boost.`,
    { screen: 'coach', tab: 'nutrition' },
  );
}

/**
 * Protein-target consistency milestone — fires on a 3/7/14/21/30-day streak of
 * hitting the daily target. Mastery framing, not just numbers.
 */
export async function notifyProteinTargetMilestone(
  userId: string,
  streak: number,
): Promise<void> {
  const bodyByStreak: Record<number, string> = {
    3:  `Three days running. Nutrition consistency is sneaky — it compounds.`,
    7:  `A full week hitting protein target. This is what muscle protein synthesis loves.`,
    14: `Two weeks. You're not "trying" anymore — this is the new default.`,
    21: `21 days. The behavioural-science threshold for habits. You crossed it.`,
    30: `30 days hitting target. Few people stay this consistent on macros. You're one of them.`,
  };
  const body = bodyByStreak[streak] ?? `${streak} consecutive days hitting your protein target.`;
  await sendPushToUser(
    userId,
    `${streak}-day protein streak 💪`,
    body,
    { screen: 'coach', tab: 'nutrition' },
  );
}

/** Freeze-consumed nudge — keeps the safety-net mechanic visible. */
export async function notifyStreakFreezeUsed(
  userId: string,
  kind: StreakKind,
  streak: number,
): Promise<void> {
  const tab = kind === 'nutrition' ? 'nutrition' : 'overview';
  await sendPushToUser(
    userId,
    `Streak freeze used 🧊`,
    `Your ${streak}-day ${KIND_LABEL[kind]} streak is intact — a freeze covered yesterday's miss.`,
    { screen: 'coach', tab },
  );
}

/**
 * Scheduled job — checks all users for at-risk streaks and fires loss-aversion
 * pushes. Called on a cron-ish schedule from index.ts (see scheduleAt).
 */
export async function runStreakAtRiskCheck(): Promise<void> {
  const { findAtRiskStreaks } = await import('./streakService.js');
  const candidates = await findAtRiskStreaks(prisma);
  console.log(`[push] Streak-at-risk: ${candidates.length} candidate(s)`);
  for (const c of candidates) {
    await notifyStreakAtRisk(c.userId, c.kind, c.streak).catch(e =>
      console.error('[push] at-risk push failed:', e),
    );
  }
}
