// Onboarding test accounts — verifies that the allowlist is the only thing
// that can trigger a wipe, that a reset actually blanks the state the
// cold-start gates read, that identity and tier survive it, and that a
// failing reset never costs the tester their sign-in.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// featureFlags reads env at module load, so this must run before the static
// imports below evaluate.
vi.hoisted(() => {
  process.env.ONBOARDING_TEST_ACCOUNTS = 'onboarding.test@axiomtraining.io, u-by-id';
});

const { prismaUser, prismaSession, prismaFeatureUsage, prismaAgentConversation,
        prismaAgentMemory, prismaNutritionPlan, prismaAdaptationProposal } = vi.hoisted(() => ({
  prismaUser: { update: vi.fn().mockResolvedValue({}) },
  prismaSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  prismaFeatureUsage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  prismaAgentConversation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  prismaAgentMemory: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  prismaNutritionPlan: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  prismaAdaptationProposal: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
}));

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUser;
    this.session = prismaSession;
    this.featureUsage = prismaFeatureUsage;
    this.agentConversation = prismaAgentConversation;
    this.agentMemory = prismaAgentMemory;
    this.nutritionPlan = prismaNutritionPlan;
    this.adaptationProposal = prismaAdaptationProposal;
  });
  return { PrismaClient };
});

const { isOnboardingTestAccount } = await import('../services/featureFlags.js');
const { resetOnboardingTestAccount } = await import('../services/onboardingTestReset.js');

beforeEach(() => {
  vi.clearAllMocks();
  prismaUser.update.mockResolvedValue({});
});

describe('isOnboardingTestAccount', () => {
  it('matches an allowlisted email, case-insensitively', () => {
    expect(isOnboardingTestAccount('any-id', 'onboarding.test@axiomtraining.io')).toBe(true);
    expect(isOnboardingTestAccount('any-id', 'Onboarding.Test@AxiomTraining.io')).toBe(true);
  });

  it('matches an allowlisted user id', () => {
    expect(isOnboardingTestAccount('u-by-id', null)).toBe(true);
  });

  it('is false for everyone else', () => {
    expect(isOnboardingTestAccount('someone-else', 'real.user@example.com')).toBe(false);
    expect(isOnboardingTestAccount('someone-else', null)).toBe(false);
  });

  // The whole point of having no global switch: there must be no env value
  // that turns "wipe this account on login" on for the whole user base.
  it('has no global on-switch', () => {
    process.env.ONBOARDING_TEST_ACCOUNTS_ENABLED = '1';
    expect(isOnboardingTestAccount('someone-else', 'real.user@example.com')).toBe(false);
    delete process.env.ONBOARDING_TEST_ACCOUNTS_ENABLED;
  });
});

describe('resetOnboardingTestAccount', () => {
  it('does nothing at all for a non-allowlisted user', async () => {
    const reset = await resetOnboardingTestAccount('someone-else', 'real.user@example.com');
    expect(reset).toBe(false);
    expect(prismaUser.update).not.toHaveBeenCalled();
    expect(prismaSession.deleteMany).not.toHaveBeenCalled();
  });

  it('blanks the columns the cold-start gates read', async () => {
    const reset = await resetOnboardingTestAccount('u-1', 'onboarding.test@axiomtraining.io');
    expect(reset).toBe(true);
    const data = prismaUser.update.mock.calls[0][0].data;
    expect(data.coachOnboardingDone).toBe(false);
    expect(data.coachProfile).toBeNull();
    expect(data.savedProgram).toBeNull();
    expect(data.draftProgram).toBeNull();
    expect(data.programStartDate).toBeNull();
    expect(data.coachThreadId).toBeNull();
  });

  it('clears the per-day quotas so the test account cannot rate-limit itself out', async () => {
    await resetOnboardingTestAccount('u-1', 'onboarding.test@axiomtraining.io');
    const data = prismaUser.update.mock.calls[0][0].data;
    expect(data.dailyAnalysisCount).toBe(0);
    expect(data.dailyPhotoScanCount).toBe(0);
    expect(data.agentTurnsCount).toBe(0);
  });

  // Identity must survive or the account stops being signable-in, which would
  // make it a one-shot account rather than a reusable one.
  it('never touches identity or tier', async () => {
    await resetOnboardingTestAccount('u-1', 'onboarding.test@axiomtraining.io');
    const data = prismaUser.update.mock.calls[0][0].data;
    for (const field of ['email', 'hashedPassword', 'googleId', 'appleId', 'emailVerified', 'tier']) {
      expect(data).not.toHaveProperty(field);
    }
  });

  it('deletes the diagnostic and coach artifacts', async () => {
    await resetOnboardingTestAccount('u-1', 'onboarding.test@axiomtraining.io');
    for (const m of [prismaSession, prismaFeatureUsage, prismaAgentConversation,
                     prismaAgentMemory, prismaNutritionPlan, prismaAdaptationProposal]) {
      expect(m.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
    }
  });

  // A failed wipe must degrade to "stale test account", never to "locked out".
  it('swallows a DB failure and reports no reset', async () => {
    prismaUser.update.mockRejectedValueOnce(new Error('db down'));
    await expect(
      resetOnboardingTestAccount('u-1', 'onboarding.test@axiomtraining.io'),
    ).resolves.toBe(false);
  });
});
