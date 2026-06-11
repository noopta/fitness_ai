// Value-moment paywall triggers. Per the user-psychology audit, pricing is
// viewed many times but rarely converts because the offer comes at the
// wrong moment ("you've hit the rate limit"). These three triggers fire
// the paywall RIGHT AFTER the user just experienced value:
//
//   1. After their first plan is generated (the diagnostic→plan moment)
//   2. After their 3rd logged workout (habit forming)
//   3. After their first protein-goal-hit (positive reinforcement)
//
// Each trigger is one-shot per user (AsyncStorage-gated). If the user
// dismisses, the next trigger gets its shot at a different value moment.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Analytics } from './analytics';

const KEY = (id: string) => `paywall-shown:v1:${id}`;
const WORKOUT_COUNT_KEY = 'paywall-workout-count:v1';

export type PaywallTrigger =
  | 'post_plan_generated'
  | 'after_3_workouts'
  | 'after_protein_goal_hit';

async function hasShown(id: PaywallTrigger): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY(id))) === '1'; }
  catch { return true; } // fail closed — never re-prompt on storage error
}

async function markShown(id: PaywallTrigger): Promise<void> {
  try { await AsyncStorage.setItem(KEY(id), '1'); } catch { /* silent */ }
}

interface MaybeArgs { tier: string | null | undefined; }

/**
 * Returns true if the calling screen should display the paywall right now.
 * Marks the trigger as shown on a `true` result so we never re-fire it for
 * the same user. Pro / enterprise users always get false — they already
 * have the goods.
 */
export async function maybeShowPostPlanPaywall({ tier }: MaybeArgs): Promise<boolean> {
  if (tier === 'pro' || tier === 'enterprise') return false;
  if (await hasShown('post_plan_generated')) return false;
  await markShown('post_plan_generated');
  Analytics.upgradeTapped?.('value_moment_post_plan' as any);
  return true;
}

export async function maybeShowPostWorkoutPaywall({ tier }: MaybeArgs): Promise<boolean> {
  if (tier === 'pro' || tier === 'enterprise') return false;
  // Increment the workout count locally so we don't have to hit the API
  // every workout-save. AsyncStorage is fine for this — eventual consistency
  // is acceptable for a paywall trigger.
  let count = 0;
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_COUNT_KEY);
    count = raw ? parseInt(raw, 10) || 0 : 0;
  } catch { /* default 0 */ }
  count += 1;
  try { await AsyncStorage.setItem(WORKOUT_COUNT_KEY, String(count)); } catch {}

  if (count < 3) return false;
  if (await hasShown('after_3_workouts')) return false;
  await markShown('after_3_workouts');
  Analytics.upgradeTapped?.('value_moment_after_3_workouts' as any);
  return true;
}

export async function maybeShowProteinHitPaywall({ tier }: MaybeArgs): Promise<boolean> {
  if (tier === 'pro' || tier === 'enterprise') return false;
  if (await hasShown('after_protein_goal_hit')) return false;
  await markShown('after_protein_goal_hit');
  Analytics.upgradeTapped?.('value_moment_protein_hit' as any);
  return true;
}

/** Test helper — wipes all paywall-shown gates so the next trigger fires. */
export async function resetAllPaywallGates(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEY('post_plan_generated')).catch(() => {}),
    AsyncStorage.removeItem(KEY('after_3_workouts')).catch(() => {}),
    AsyncStorage.removeItem(KEY('after_protein_goal_hit')).catch(() => {}),
    AsyncStorage.removeItem(WORKOUT_COUNT_KEY).catch(() => {}),
  ]);
}
