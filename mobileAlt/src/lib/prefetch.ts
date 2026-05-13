// Boot-time prefetch: warm the in-memory caches that the four primary
// tabs read on mount, so by the time the user taps any tab it's already
// served from cache. Fires immediately after auth resolves in
// RootNavigator. All four requests run in parallel — total wall time is
// bound by the slowest single call, not the sum.
//
// Bandwidth cost: roughly 5 MB on cold open (4.7 MB dominated by the
// social feed, even after slim=1). For metered cellular this is real
// money for the user. We'd ideally skip prefetch via NetInfo's
// `isConnectionExpensive` flag, but @react-native-community/netinfo
// isn't installed; adding it is a separate change. Note this as a
// follow-up and move on for now.
//
// Each prefetch is idempotent: if the cache already has a fresh entry,
// the call is a no-op. So an immediate user navigation that triggers
// the screen's own fetch doesn't race-double the work in any harmful
// way — at worst the prefetch result lands first and the screen reads
// from cache; at best the screen's own request wins and the prefetch's
// result is identical.
//
// Errors are swallowed at the per-prefetch boundary so a single 500 on
// (say) /strength/profile doesn't poison the rest. The user can always
// retry by tapping the tab.

import { getCached, setCached } from './cache';
import { socialApi, coachApi, nutritionApi } from './api';
import {
  coachInitCacheKey, COACH_INIT_TTL_MS, fetchCoachInit, type CoachInitCacheShape,
} from './coachData';

const SOCIAL_FEED_TTL_MS    = 30 * 60 * 1000; // mirrors social.tsx
const SOCIAL_FRIENDS_TTL_MS = 30 * 60 * 1000;
const SOCIAL_SAVED_TTL_MS   = 60 * 60 * 1000;
const NUTRITION_PROFILE_TTL_MS = 6 * 60 * 60 * 1000; // mirrors NutritionProfile
const STRENGTH_PROFILE_TTL_MS  = 30 * 60 * 1000;

async function prefetchCoachInit(userId: string, userSavedProgram?: any): Promise<void> {
  const key = coachInitCacheKey(userId);
  if (getCached<CoachInitCacheShape>(key, COACH_INIT_TTL_MS)) return;
  try {
    const next = await fetchCoachInit(userSavedProgram);
    setCached(key, next);
  } catch { /* silent */ }
}

async function prefetchSocialFeed(userId: string): Promise<void> {
  const feedKey = `social:feed:${userId}`;
  if (getCached(feedKey, SOCIAL_FEED_TTL_MS)) return;
  try {
    // includeResearch: true (the default behavior the screen wants on mount)
    const data = await socialApi.getFeed();
    const items = Array.isArray(data) ? data : (data as any).items ?? [];
    const exhausted = !!(data as any)?.exhausted;
    setCached(feedKey, { items, exhausted });
  } catch { /* silent */ }
}

async function prefetchSocialFriends(userId: string): Promise<void> {
  const key = `social:friends:${userId}`;
  if (getCached(key, SOCIAL_FRIENDS_TTL_MS)) return;
  try {
    const list = await socialApi.getFriends();
    if (Array.isArray(list)) setCached(key, list);
  } catch { /* silent */ }
}

async function prefetchSocialSaved(userId: string): Promise<void> {
  const key = `social:saved:${userId}`;
  if (getCached(key, SOCIAL_SAVED_TTL_MS)) return;
  try {
    const data: any = await socialApi.getSavedArticles();
    const ids = Array.isArray(data) ? data.map((a: any) => a?.id).filter(Boolean) : [];
    setCached(key, ids);
  } catch { /* silent */ }
}

async function prefetchNutritionProfile(userId: string): Promise<void> {
  const key = `nutrition:profile:${userId}`;
  if (getCached(key, NUTRITION_PROFILE_TTL_MS)) return;
  try {
    const d: any = await nutritionApi.getProfile();
    if (d?.hasData) setCached(key, d);
  } catch { /* silent */ }
}

async function prefetchStrengthProfile(userId: string): Promise<void> {
  const key = `strength:profile:${userId}`;
  if (getCached(key, STRENGTH_PROFILE_TTL_MS)) return;
  try {
    const d = await coachApi.getStrengthProfile();
    if (d) setCached(key, d);
  } catch { /* silent */ }
}

/**
 * Fire all primary-tab prefetches in parallel. Caller should fire-and-forget;
 * we never throw. Safe to call repeatedly — each prefetch checks cache before
 * making a network call.
 *
 * `userSavedProgram` is the `user.savedProgram` field from AuthContext, used
 * as a fallback when /program returns nothing valid. Optional.
 */
export async function runBootPrefetch(
  userId: string,
  userSavedProgram?: any,
): Promise<void> {
  await Promise.allSettled([
    prefetchCoachInit(userId, userSavedProgram),
    prefetchSocialFeed(userId),
    prefetchSocialFriends(userId),
    prefetchSocialSaved(userId),
    prefetchNutritionProfile(userId),
    prefetchStrengthProfile(userId),
  ]);
}
