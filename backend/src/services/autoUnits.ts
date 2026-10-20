// Units follow where the user is, unless they chose (Oct 2026). Saeed, in
// Edmonton, got kg because Canada was on the metric list and only the phone's
// language was read; he talks in pounds. Now the phone's timezone decides
// (North America → lb), re-checked whenever the stored zone changes, and a
// user's own choice (Settings, or asking Anakin) is never overridden.

import { PrismaClient } from '@prisma/client';
import { detectUnitPreference, normalizePreference } from './weightUnits.js';
import { parseUserPrefs } from './userPrefs.js';
import { onTimezoneChange } from './userTimezone.js';
import { cacheDelete } from './cacheService.js';

const prisma = new PrismaClient();

/** Pure: the unit to switch to, or null to leave it (manual choice, or already right). */
export function autoUnitChange(u: { unitPreference: string | null; timezone: string | null; prefsJson: string | null }): 'metric' | 'imperial' | null {
  if (parseUserPrefs(u.prefsJson).unitsManual) return null;
  if (!u.timezone) return null;
  const want = detectUnitPreference({ timezone: u.timezone });
  return want === normalizePreference(u.unitPreference) ? null : want;
}

/** Re-check one user's units against their timezone; returns the new unit when it changed. */
export async function autoAdjustUnits(userId: string): Promise<'metric' | 'imperial' | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, timezone: true, prefsJson: true } });
  if (!u) return null;
  const next = autoUnitChange(u);
  if (!next) return null;
  await prisma.user.update({ where: { id: userId }, data: { unitPreference: next } });
  cacheDelete(`userctx:${userId}`);
  import('../routes/strength.js').then(({ recomputeStrengthProfileInBackground }) => recomputeStrengthProfileInBackground(userId)).catch(() => {});
  return next;
}

/** Mark the user's unit as their own choice (Settings toggle, or asked Anakin). */
export async function markUnitsManual(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { prefsJson: true } });
  const prefs = (() => { try { return u?.prefsJson ? JSON.parse(u.prefsJson) : {}; } catch { return {}; } })();
  if (prefs.unitsManual === true) return;
  await prisma.user.update({ where: { id: userId }, data: { prefsJson: JSON.stringify({ ...prefs, unitsManual: true }) } });
}

let wired = false;
/** Re-check units whenever a user's stored timezone changes (called once at startup). */
export function wireAutoUnits() {
  if (wired) return;
  wired = true;
  onTimezoneChange((userId) => { void autoAdjustUnits(userId).catch((e) => console.warn('[units] auto-adjust failed:', e?.message ?? e)); });
}
