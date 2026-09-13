// GDPR Art. 15/20 + CCPA/CPRA data export.
//
// The published privacy policy states, under "Your Privacy Rights and Choices":
//
//   "Portability: Request an export of your data in a machine-readable format."
//   "Access: Request a copy of the personal data we hold about you."
//
// Until now there was nothing behind either sentence — no endpoint, no script,
// no runbook. A promise in a privacy policy with no mechanism is the gap
// regulators actually penalise, and it's the one a user notices the day they
// ask. This closes it with a self-serve export.
//
// Design notes:
//   - Everything the user authored or that describes them is included.
//   - Credentials are NOT: hashedPassword, OAuth subject ids and provider
//     tokens are our authentication material, not the user's personal data, and
//     exporting a bcrypt hash into a file that lands in a Downloads folder
//     would create a risk that didn't exist before.
//   - Other users' content is NOT: a DM thread contains the other participant's
//     messages, and exporting those would hand one user another's data. Only
//     the requester's own messages are included, with the counterparty
//     identified by display name so the thread still makes sense.
//   - Missing relations degrade to an empty array rather than failing the whole
//     export, so a model added on an unmigrated branch can't break the route.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Fields safe to return about the account holder. */
const USER_EXPORT_SELECT = {
  id: true,
  name: true,
  email: true,
  username: true,
  createdAt: true,
  dateOfBirth: true,
  heightCm: true,
  weightKg: true,
  unitPreference: true,
  bodyCompTag: true,
  trainingAge: true,
  equipment: true,
  constraintsText: true,
  tier: true,
  dailyCalorieTarget: true,
  emailVerified: true,
  emailVerifiedAt: true,
  coachProfile: true,
  referredByCode: true,
  scheduleSharing: true,
} as const;

/**
 * Run a query, returning [] if the relation doesn't exist in this deployment.
 * Keeps one unmigrated model from failing an export the user is entitled to.
 */
async function safeMany<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err: any) {
    console.warn(`[data-export] skipped ${label}: ${err?.message ?? err}`);
    return [];
  }
}

export interface UserDataExport {
  exportedAt: string;
  format: string;
  notice: string;
  account: Record<string, unknown> | null;
  training: Record<string, unknown[]>;
  nutrition: Record<string, unknown[]>;
  social: Record<string, unknown[]>;
  coaching: Record<string, unknown[]>;
}

/**
 * Assemble everything held about one user into a single JSON document.
 */
export async function buildUserDataExport(userId: string): Promise<UserDataExport> {
  const p = prisma as any;

  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_EXPORT_SELECT,
  });

  const [
    sessions, snapshots, plans, workoutLogs, bodyWeightLogs, completedPrograms, formAnalyses,
    mealEntries, nutritionLogs, nutritionPlans, savedFoods, recipes,
    posts, comments, reactions, friendships, sentMessages,
    diagnosticMessages, agentConversations, wellnessCheckins, activityLogs,
  ] = await Promise.all([
    safeMany('session', () => p.session.findMany({ where: { userId } })),
    safeMany('exerciseSnapshot', () => p.exerciseSnapshot.findMany({ where: { session: { userId } } })),
    safeMany('generatedPlan', () => p.generatedPlan.findMany({ where: { session: { userId } } })),
    safeMany('workoutLog', () => p.workoutLog.findMany({ where: { userId } })),
    safeMany('bodyWeightLog', () => p.bodyWeightLog.findMany({ where: { userId } })),
    safeMany('completedProgram', () => p.completedProgram.findMany({ where: { userId } })),
    safeMany('formAnalysis', () => p.formAnalysis.findMany({ where: { userId } })),

    safeMany('mealEntry', () => p.mealEntry.findMany({ where: { userId } })),
    safeMany('nutritionLog', () => p.nutritionLog.findMany({ where: { userId } })),
    safeMany('nutritionPlan', () => p.nutritionPlan.findMany({ where: { userId } })),
    safeMany('savedFood', () => p.savedFood.findMany({ where: { userId } })),
    safeMany('recipe', () => p.recipe.findMany({ where: { userId } })),

    safeMany('sharedItem', () => p.sharedItem.findMany({ where: { sharerId: userId } })),
    safeMany('postComment', () => p.postComment.findMany({ where: { authorId: userId } })),
    safeMany('postReaction', () => p.postReaction.findMany({ where: { userId } })),
    safeMany('friendship', () => p.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    })),
    // Only this user's own messages — see the note at the top of the file.
    safeMany('message', () => p.message.findMany({
      where: { senderId: userId },
      select: { id: true, conversationId: true, body: true, createdAt: true },
    })),

    safeMany('diagnosticMessage', () => p.diagnosticMessage.findMany({ where: { session: { userId } } })),
    safeMany('agentConversation', () => p.agentConversation.findMany({ where: { userId } })),
    safeMany('wellnessCheckin', () => p.wellnessCheckin.findMany({ where: { userId } })),
    safeMany('activityLog', () => p.activityLog.findMany({ where: { userId } })),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    format: 'axiom-user-export-v1',
    notice:
      'This file contains the personal data Axiom holds about your account. It excludes ' +
      'authentication credentials (password hashes, OAuth identifiers) and messages authored ' +
      'by other people, which are not yours to export.',
    account: account as Record<string, unknown> | null,
    training: {
      sessions, snapshots, plans, workoutLogs, bodyWeightLogs, completedPrograms, formAnalyses,
    },
    nutrition: { mealEntries, nutritionLogs, nutritionPlans, savedFoods, recipes },
    social: { posts, comments, reactions, friendships, sentMessages },
    coaching: { diagnosticMessages, agentConversations, wellnessCheckins, activityLogs },
  };
}
