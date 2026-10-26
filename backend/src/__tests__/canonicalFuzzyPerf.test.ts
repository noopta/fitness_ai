// The fuzzy exercise matcher was made fast (bounded one-row Levenshtein,
// memoized canonicalizeSync) after it blocked the event loop for ~1.3 s per
// strength-profile recompute (Oct 2026). Same answers as the original.

import { describe, it, expect } from 'vitest';
import { SEED, fuzzyMatch, canonicalizeSync, stripQualifiers } from '../services/exerciseCanonical.js';

function naiveLev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}
function naiveFuzzy(stripped: string) {
  let best: string | null = null; let bestDist = Infinity;
  for (const key of Object.keys(SEED)) {
    const d = naiveLev(stripped, key);
    if (d < bestDist && d <= Math.max(2, Math.floor(key.length * 0.3))) { bestDist = d; best = key; }
  }
  return best ? SEED[best] : null;
}

const mutate = (s: string, i: number) => [s.slice(0, i) + s.slice(i + 1), s.slice(0, i) + 'x' + s.slice(i), s + 'es', s.slice(0, i) + 'q' + s.slice(i + 1)];

describe('fuzzy exercise matching', () => {
  it('matches the original algorithm on misspellings of every seed name', () => {
    const inputs = Object.keys(SEED).flatMap((k, n) => mutate(k, n % Math.max(1, k.length))).concat(['zzzz', 'farmers walk', 'bnch prss', 'romanian dl', 'incline db press']);
    for (const s of inputs) expect(fuzzyMatch(s), s).toEqual(naiveFuzzy(s));
  });

  it('remembers a name: the same answer, without redoing the fuzzy work', () => {
    const name = 'Barbel Benchh Pres (paused)';
    const first = canonicalizeSync(name);
    expect(canonicalizeSync(name)).toBe(first);
    expect(first).toEqual(SEED[name.toLowerCase()] ?? SEED[stripQualifiers(name)] ?? naiveFuzzy(stripQualifiers(name)) ?? null);
  });
});
