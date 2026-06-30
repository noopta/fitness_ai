// Weight-unit helpers for the web app — the single source of truth for kg⇄lb
// conversion + display formatting. Canonical storage is ALWAYS kilograms; we
// convert at the edges based on the user's `unitPreference`.
//
// Pure functions live here; `useUnits()` (below) binds them to the logged-in
// user's preference and provides a setter that persists to the backend.

import { useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';

export type UnitPreference = 'metric' | 'imperial';

/** Exact international avoirdupois pound. */
export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb * KG_PER_LB;

export function normalizePreference(pref: string | null | undefined): UnitPreference {
  return pref === 'metric' ? 'metric' : 'imperial';
}

export function unitLabel(pref: UnitPreference): 'kg' | 'lbs' {
  return pref === 'metric' ? 'kg' : 'lbs';
}

/** Canonical kg → numeric value in the display unit (rounded to `decimals`). */
export function displayWeight(kg: number, pref: UnitPreference, decimals = 0): number {
  const val = pref === 'metric' ? kg : kgToLb(kg);
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

/** Canonical kg → "185 lbs" / "84 kg". Returns '' for null/NaN so callers can omit. */
export function formatWeight(
  kg: number | null | undefined,
  pref: UnitPreference,
  decimals = 0,
): string {
  if (kg == null || !Number.isFinite(kg)) return '';
  return `${displayWeight(kg, pref, decimals)} ${unitLabel(pref)}`;
}

/** User-entered display value → canonical kg. Returns null for non-finite input. */
export function toKg(value: number | null | undefined, pref: UnitPreference): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return pref === 'metric' ? value : lbToKg(value);
}

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

/**
 * Bind unit helpers to the logged-in user's preference. `setUnit` persists the
 * choice to the backend (so it syncs to mobile + drives server-side copy) and
 * refreshes the auth user.
 */
export function useUnits() {
  const { user, refreshUser } = useAuth();
  const pref = normalizePreference(user?.unitPreference);

  const setUnit = useCallback(async (next: UnitPreference) => {
    const bearer = sessionStorage.getItem('liftoff_bearer_token');
    await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ unitPreference: next }),
    });
    await refreshUser();
  }, [refreshUser]);

  return {
    unit: pref,
    label: unitLabel(pref),
    isMetric: pref === 'metric',
    displayWeight: (kg: number, decimals = 0) => displayWeight(kg, pref, decimals),
    formatWeight: (kg: number | null | undefined, decimals = 0) => formatWeight(kg, pref, decimals),
    toKg: (value: number | null | undefined) => toKg(value, pref),
    setUnit,
    toggle: () => setUnit(pref === 'metric' ? 'imperial' : 'metric'),
  };
}
