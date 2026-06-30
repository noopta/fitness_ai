import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { authApi } from '../lib/api';

type Unit = 'kg' | 'lbs';

// Exact international avoirdupois pound — single source of truth for conversion.
const LB_PER_KG = 1 / 0.45359237;

interface UnitsContextValue {
  unit: Unit;
  /** Toggle and persist to the server (so it syncs to web + server-side copy). */
  toggleUnit: () => void;
  /** Set + persist a specific unit. */
  setUnitPref: (u: Unit) => void;
  /** Convert a canonical kg value to display value in the current unit. */
  fromKg: (kg: number) => number;
  /** Convert a user-entered display value back to canonical kg for storage. */
  toKg: (val: number) => number;
  /** Format a canonical kg value as "185 lbs" / "84 kg" ('' for null/NaN). */
  formatWeight: (kg: number | null | undefined, decimals?: number) => string;
  unitLabel: Unit;
}

function fromKgIn(unit: Unit, kg: number): number {
  if (unit === 'lbs') return Math.round(kg * LB_PER_KG * 10) / 10;
  return Math.round(kg * 10) / 10;
}

const UnitsContext = createContext<UnitsContextValue>({
  unit: 'lbs',
  toggleUnit: () => {},
  setUnitPref: () => {},
  fromKg: (kg) => fromKgIn('lbs', kg),
  toKg: (val) => val / LB_PER_KG,
  formatWeight: (kg) => (kg == null || !Number.isFinite(kg) ? '' : `${fromKgIn('lbs', kg)} lbs`),
  unitLabel: 'lbs',
});

const STORAGE_KEY = '@axiom_weight_unit';

const prefToUnit = (p: string | null | undefined): Unit => (p === 'metric' ? 'kg' : 'lbs');
const unitToPref = (u: Unit): 'metric' | 'imperial' => (u === 'kg' ? 'metric' : 'imperial');

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const { user, refreshUser } = useAuth();
  const [unit, setUnit] = useState<Unit>('lbs');

  // Hydrate priority: AsyncStorage (offline-first, instant) is read on mount;
  // the server preference (source of truth, synced from web/other devices)
  // overrides it whenever the auth user is (re)loaded.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === 'kg' || val === 'lbs') setUnit(val);
    });
  }, []);

  useEffect(() => {
    if (user?.unitPreference === 'metric' || user?.unitPreference === 'imperial') {
      const u = prefToUnit(user.unitPreference);
      setUnit(u);
      AsyncStorage.setItem(STORAGE_KEY, u).catch(() => {});
    }
  }, [user?.unitPreference]);

  const setUnitPref = useCallback((next: Unit) => {
    setUnit(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    // Persist to the backend so it syncs across devices + drives server copy.
    authApi.updateProfile({ unitPreference: unitToPref(next) })
      .then(() => refreshUser())
      .catch(() => { /* offline — AsyncStorage keeps the local choice */ });
  }, [refreshUser]);

  const toggleUnit = useCallback(() => {
    setUnitPref(unit === 'lbs' ? 'kg' : 'lbs');
  }, [unit, setUnitPref]);

  const fromKg = useCallback((kg: number) => fromKgIn(unit, kg), [unit]);
  const toKg = useCallback((val: number) => (unit === 'lbs' ? val / LB_PER_KG : val), [unit]);
  const formatWeight = useCallback(
    (kg: number | null | undefined, _decimals = 0) =>
      kg == null || !Number.isFinite(kg) ? '' : `${fromKgIn(unit, kg)} ${unit}`,
    [unit],
  );

  return (
    <UnitsContext.Provider
      value={{ unit, toggleUnit, setUnitPref, fromKg, toKg, formatWeight, unitLabel: unit }}
    >
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitsContext);
}
