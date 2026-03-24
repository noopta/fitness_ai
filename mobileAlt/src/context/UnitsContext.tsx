import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Unit = 'kg' | 'lbs';

interface UnitsContextValue {
  unit: Unit;
  toggleUnit: () => void;
  /** Convert kg value to display value in current unit */
  fromKg: (kg: number) => number;
  /** Convert display value back to kg for storage */
  toKg: (val: number) => number;
  unitLabel: string;
}

const UnitsContext = createContext<UnitsContextValue>({
  unit: 'lbs',
  toggleUnit: () => {},
  fromKg: (kg) => Math.round(kg * 2.2046 * 10) / 10,
  toKg: (val) => val / 2.2046,
  unitLabel: 'lbs',
});

const STORAGE_KEY = '@axiom_weight_unit';

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<Unit>('lbs');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === 'kg' || val === 'lbs') setUnit(val);
    });
  }, []);

  function toggleUnit() {
    setUnit((prev) => {
      const next = prev === 'lbs' ? 'kg' : 'lbs';
      AsyncStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  function fromKg(kg: number): number {
    if (unit === 'lbs') return Math.round(kg * 2.2046 * 10) / 10;
    return Math.round(kg * 10) / 10;
  }

  function toKg(val: number): number {
    if (unit === 'lbs') return val / 2.2046;
    return val;
  }

  return (
    <UnitsContext.Provider value={{ unit, toggleUnit, fromKg, toKg, unitLabel: unit }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitsContext);
}
