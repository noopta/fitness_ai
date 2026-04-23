// ─── Re-engagement Detection & Nudge Service ──────────────────────────────────
// Runs nightly. Detects users who have fallen off and sends shame/reality-check
// push notifications based on workout gaps, nutrition gaps, and app inactivity.

import { PrismaClient } from '@prisma/client';
import { sendPushNotification } from './notificationService.js';
import {
  getWorkoutMissMessage,
  getNutritionMissMessage,
  getInactivityMessage,
  getJunkFoodMessage,
  isJunkFood,
} from '../messages/reengagement.js';

export { isJunkFood, getJunkFoodMessage };

const prisma = new PrismaClient();

const NUDGE_COOLDOWN_HOURS = 48; // don't re-send same category within this window

function hoursSince(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / 3_600_000;
}

function daysSince(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / 86_400_000;
}

// ─── Main nightly check ───────────────────────────────────────────────────────

export async function runReengagementCheck(): Promise<void> {
  console.log('[reengagement] Starting nightly check...');

  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().split('T')[0];
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);

  // Fetch users who have push tokens, haven't opted out, and have logged at least once
  const users = await prisma.user.findMany({
    where: {
      expoPushToken: { not: null },
      reengagementOptOut: false,
    },
    select: {
      id: true,
      name: true,
      expoPushToken: true,
      lastActiveAt: true,
      lastWorkoutNudgeAt: true,
      lastNutritionNudgeAt: true,
      lastInactivityNudgeAt: true,
    },
  });

  let nudgesSent = 0;

  for (const user of users) {
    if (!user.expoPushToken) continue;
    const firstName = user.name?.split(' ')[0] || 'there';

    // ── 1. Check app inactivity (3+ days, no activity of any kind) ────────────
    if (
      hoursSince(user.lastInactivityNudgeAt) > NUDGE_COOLDOWN_HOURS &&
      daysSince(user.lastActiveAt) >= 3
    ) {
      const days = Math.floor(daysSince(user.lastActiveAt));
      const msg = getInactivityMessage(days, firstName);
      await sendPushNotification({
        to: user.expoPushToken,
        title: msg.title,
        body: msg.body,
        data: { screen: 'coach' },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { lastInactivityNudgeAt: new Date() },
      });
      nudgesSent++;
      continue; // one nudge per user per night
    }

    // ── 2. Check workout gap (2+ days since last workout log) ─────────────────
    if (hoursSince(user.lastWorkoutNudgeAt) > NUDGE_COOLDOWN_HOURS) {
      const lastWorkout = await prisma.activityLog.findFirst({
        where: { userId: user.id, type: 'workout' },
        orderBy: { date: 'desc' },
        select: { date: true },
      });

      if (lastWorkout) {
        const lastDate = new Date(lastWorkout.date + 'T00:00:00');
        const days = Math.floor(daysSince(lastDate));

        if (days >= 2) {
          const msg = getWorkoutMissMessage(days, firstName);
          await sendPushNotification({
            to: user.expoPushToken,
            title: msg.title,
            body: msg.body,
            data: { screen: 'history' },
          });
          await prisma.user.update({
            where: { id: user.id },
            data: { lastWorkoutNudgeAt: new Date() },
          });
          nudgesSent++;
          continue;
        }
      }
    }

    // ── 3. Check nutrition gap (2+ days since last nutrition log) ─────────────
    if (hoursSince(user.lastNutritionNudgeAt) > NUDGE_COOLDOWN_HOURS) {
      const lastNutrition = await prisma.activityLog.findFirst({
        where: { userId: user.id, type: 'nutrition' },
        orderBy: { date: 'desc' },
        select: { date: true },
      });

      if (lastNutrition) {
        const lastDate = new Date(lastNutrition.date + 'T00:00:00');
        const days = Math.floor(daysSince(lastDate));

        if (days >= 2) {
          const msg = getNutritionMissMessage(days, firstName);
          await sendPushNotification({
            to: user.expoPushToken,
            title: msg.title,
            body: msg.body,
            data: { screen: 'coach', tab: 'Nutrition' },
          });
          await prisma.user.update({
            where: { id: user.id },
            data: { lastNutritionNudgeAt: new Date() },
          });
          nudgesSent++;
          continue;
        }
      }
    }
  }

  console.log(`[reengagement] Done. Sent ${nudgesSent} nudge(s) to ${users.length} user(s) checked.`);
}

// ─── Instant: junk food shame push ────────────────────────────────────────────
// Max one junk food push per user per 6 hours — prevents multiple nudges
// if they log several junk items in the same session.

const JUNK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const junkSentAt = new Map<string, number>(); // userId → timestamp

export async function sendJunkFoodShame(
  userId: string,
  mealName: string,
  calories: number,
): Promise<void> {
  try {
    const lastSent = junkSentAt.get(userId) ?? 0;
    if (Date.now() - lastSent < JUNK_COOLDOWN_MS) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true, name: true, reengagementOptOut: true },
    });
    if (!user?.expoPushToken || user.reengagementOptOut) return;

    junkSentAt.set(userId, Date.now());

    const firstName = user.name?.split(' ')[0] || 'there';
    const msg = getJunkFoodMessage(mealName, Math.round(calories), firstName);

    await sendPushNotification({
      to: user.expoPushToken,
      title: msg.title,
      body: msg.body,
      data: { screen: 'coach', tab: 'Nutrition' },
    });
    console.log(`[reengagement] Junk food shame sent to user ${userId} for "${mealName}" (${Math.round(calories)} kcal)`);
  } catch (err) {
    console.error('[reengagement] Junk food shame error:', err);
  }
}
