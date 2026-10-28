// "Just today" exercise swaps (Oct 2026): kept on the phone for today's date,
// read by the Today page and the session so both show the lift they chose.
// "Every Monday" goes through the program instead (a swap card they apply).

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayStr } from '../lib/localDate';

const KEY = 'v2.todaySwaps.v1';
type Store = { date: string; swaps: Record<string, string> };
const listeners = new Set<(s: Record<string, string>) => void>();
const norm = (n: string) => String(n ?? '').trim().toLowerCase();

export async function getTodaySwaps(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const s: Store | null = raw ? JSON.parse(raw) : null;
    return s && s.date === todayStr() ? s.swaps : {};
  } catch { return {}; }
}

export async function setTodaySwap(from: string, to: string): Promise<void> {
  const swaps = { ...(await getTodaySwaps()) };
  // Swapping a swapped lift again keeps the original as the key.
  const original = Object.keys(swaps).find((k) => norm(swaps[k]) === norm(from)) ?? norm(from);
  if (norm(to) === original) delete swaps[original]; else swaps[original] = to;
  try { await AsyncStorage.setItem(KEY, JSON.stringify({ date: todayStr(), swaps })); } catch { /* the session still swaps in memory */ }
  listeners.forEach((l) => l(swaps));
}

/** Pure: the name to show / train for a planned exercise today. */
export const swappedName = (swaps: Record<string, string>, name: string): string => swaps[norm(name)] ?? name;

export function useTodaySwaps(): Record<string, string> {
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  useEffect(() => {
    void getTodaySwaps().then(setSwaps);
    listeners.add(setSwaps);
    return () => { listeners.delete(setSwaps); };
  }, []);
  return swaps;
}
