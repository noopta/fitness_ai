import { PrismaClient } from '@prisma/client';
import { isOnboardingTestAccount } from './featureFlags.js';

const prisma = new PrismaClient();

// ── Onboarding test accounts ─────────────────────────────────────────────────
//
// A dedicated account that is brand-new on every sign-in, so the full cold
// start (diagnostic → verdict → paywall → intake) can be exercised repeatedly
// without registering a throwaway email each time.
//
// Why a reset rather than a fresh signup per run: the funnel's own gates are
// keyed to the account AND the device. Registering a new user each time still
// leaves the device-local first-run keys set, so run #2 skips the very screens
// under test. Pinning one account lets /auth/me advertise the reset, which is
// what licenses the client to clear those keys too.
//
// The wipe is scoped to what makes a user "new" to the onboarding funnel. It
// deliberately does NOT touch identity (email, password, oauth ids,
// emailVerified) — the account has to remain signable-in — nor tier, which is
// left to whatever it is so a comped test account can exercise the paid path.

/** Child rows that make the account look "returning" to the cold-start gates. */
async function deleteOnboardingArtifacts(userId: string): Promise<void> {
  // Sessions cascade to DiagnosticTurn, DiagnosticMessage and GeneratedPlan,
  // so the diagnostic history goes with them.
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.featureUsage.deleteMany({ where: { userId } });
  await prisma.agentConversation.deleteMany({ where: { userId } });
  await prisma.agentMemory.deleteMany({ where: { userId } });
  await prisma.nutritionPlan.deleteMany({ where: { userId } });
  await prisma.adaptationProposal.deleteMany({ where: { userId } });
}

/** The User columns that together mean "has already been through onboarding". */
const NEW_USER_STATE = {
  coachOnboardingDone: false,
  coachProfile: null,
  coachGoal: null,
  coachBudget: null,
  coachThreadId: null,
  savedProgram: null,
  draftProgram: null,
  draftProgramAt: null,
  programStartDate: null,
  // Intake answers — re-asked by the interview.
  heightCm: null,
  weightKg: null,
  trainingAge: null,
  equipment: null,
  constraintsText: null,
  bodyCompTag: null,
  dateOfBirth: null,
  dailyCalorieTarget: null,
  username: null,
  avatarBase64: null,
  // Quota counters, so a reset account is never rate-limited out of the
  // flow it exists to test.
  dailyAnalysisCount: 0,
  dailyAnalysisDate: null,
  dailyPhotoScanCount: 0,
  dailyPhotoScanDate: null,
  agentTurnsCount: 0,
  agentTurnsDate: null,
  // Engagement state a brand-new user would not have.
  currentStreak: 0,
  longestStreak: 0,
  lastWorkoutDate: null,
  nutritionStreak: 0,
  longestNutritionStreak: 0,
  lastNutritionLogDate: null,
  streakFreezes: 0,
  typicalWorkoutLogHour: null,
  typicalNutritionLogHour: null,
  welcomeEmailSentAt: null,
  lastActiveAt: null,
  lastWorkoutNudgeAt: null,
  lastNutritionNudgeAt: null,
  lastInactivityNudgeAt: null,
  lastStreakAtRiskAt: null,
  lastSurpriseRewardAt: null,
} as const;

/**
 * Reset an onboarding test account to brand-new, if this user is one.
 *
 * No-op for every normal account — the allowlist check happens here rather
 * than at each call site so a future login path cannot forget it and wipe a
 * real user. Never throws: a failed reset must not cost the tester their
 * login, so it logs and lets the sign-in proceed (a stale test account is a
 * far better outcome than a locked-out one).
 *
 * @returns true if the account was reset.
 */
export async function resetOnboardingTestAccount(
  userId: string,
  email?: string | null,
): Promise<boolean> {
  if (!isOnboardingTestAccount(userId, email)) return false;
  try {
    await deleteOnboardingArtifacts(userId);
    await prisma.user.update({ where: { id: userId }, data: NEW_USER_STATE });
    console.log(`✓ Onboarding test account ${userId} reset to new`);
    return true;
  } catch (err) {
    console.error(`Onboarding test account reset failed for ${userId}:`, err);
    return false;
  }
}
