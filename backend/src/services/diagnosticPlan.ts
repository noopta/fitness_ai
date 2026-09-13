import { PrismaClient } from '@prisma/client';
import { diagnosticFirstAvailableFor } from './featureFlags.js';

const prisma = new PrismaClient();

// ── Diagnostic-first prescription gate ────────────────────────────────────────
//
// Under the diagnostic-first funnel the free tier gets the diagnosis (what's
// weak and why) but not the prescription (the protocol that fixes it) — the
// paywall sells the fix right after the verdict. The full plan is always
// generated and persisted; only the RESPONSE is stripped, so starting a trial
// unlocks it with a plain refetch, no regeneration (and no second LLM spend).
//
// The strip happens server-side because a client-side gate would ship the
// entire prescription in the JSON for anyone to read in a proxy.

/**
 * Whether this user should receive plans with the prescription stripped.
 * Tier is read fresh from the DB, NOT from the JWT — the JWT's tier is known
 * to go stale across an upgrade, and a just-paid user staring at a still-
 * locked plan is the one outcome this screen must never produce.
 */
export async function prescriptionLockedFor(user: { id: string; email: string | null }): Promise<boolean> {
  if (!diagnosticFirstAvailableFor(user.id, user.email)) return false;
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { tier: true },
  });
  const tier = fresh?.tier ?? 'free';
  return tier !== 'pro' && tier !== 'enterprise';
}

/**
 * The locked response shape: diagnosis and signals intact, prescription
 * replaced by a marker plus just enough of a silhouette to sell it (how many
 * targeted accessories are waiting). Never leaks exercise names or numbers.
 */
export function stripPrescription(plan: any): any {
  if (!plan || typeof plan !== 'object') return plan;
  const {
    bench_day_plan: prescription,
    benchDayPlan: prescriptionCamel,
    // Top-level too, not just nested: generateWorkoutPlan emits
    // progression_rules at the plan root, and the locked card promises them
    // behind the trial — they must not ride along in the free payload.
    // track_next_time stays: it's observational ("watch your bar speed"),
    // not the fix.
    progression_rules: _progressionRules,
    ...rest
  } = plan;
  const accessories = prescription?.accessories ?? prescriptionCamel?.accessories ?? [];
  return {
    ...rest,
    prescription_locked: true,
    prescription_preview: {
      accessory_count: Array.isArray(accessories) ? accessories.length : 0,
    },
  };
}

export function formatPlanAsText(plan: any): string {
  let text = `# ${plan.bench_day_plan.primary_lift.exercise_name} Training Plan\n\n`;
  
  text += `## Diagnosis\n`;
  plan.diagnosis.forEach((d: any) => {
    text += `- **${d.limiterName}** (${Math.round(d.confidence * 100)}% confidence)\n`;
    d.evidence.forEach((e: string) => text += `  - ${e}\n`);
  });
  
  text += `\n## Primary Lift\n`;
  const pl = plan.bench_day_plan.primary_lift;
  text += `**${pl.exercise_name}**: ${pl.sets} sets × ${pl.reps} reps @ ${pl.intensity}, ${pl.rest_minutes}min rest\n`;
  
  text += `\n## Accessories\n`;
  plan.bench_day_plan.accessories.forEach((acc: any) => {
    text += `**${acc.exercise_name}**: ${acc.sets} sets × ${acc.reps} reps\n`;
    text += `  *Why: ${acc.why}*\n\n`;
  });
  
  text += `\n## Progression\n`;
  plan.progression_rules.forEach((rule: string) => text += `- ${rule}\n`);
  
  text += `\n## Track Next Time\n`;
  plan.track_next_time.forEach((item: string) => text += `- ${item}\n`);
  
  return text;
}
