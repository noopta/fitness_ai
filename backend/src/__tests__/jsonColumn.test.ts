// These helpers exist because a bare JSON.parse on a JSON-in-TEXT column is a
// latent 500: SQLite doesn't enforce the shape, so one writer that bypasses
// validation poisons every reader. That is exactly what happened on
// 2026-08-07. The contract under test is simply "never throws".

import { describe, it, expect, vi } from 'vitest';
import {
  parseJsonColumn,
  parseJsonArrayColumn,
  parseJsonObjectColumn,
} from '../services/jsonColumn.js';

describe('parseJsonColumn', () => {
  it('parses well-formed JSON', () => {
    expect(parseJsonColumn('{"a":1}', null)).toEqual({ a: 1 });
    expect(parseJsonColumn('[1,2]', null)).toEqual([1, 2]);
    expect(parseJsonColumn('42', null)).toBe(42);
  });

  it('returns the fallback for an absent column', () => {
    expect(parseJsonColumn(null, 'fb')).toBe('fb');
    expect(parseJsonColumn(undefined, 'fb')).toBe('fb');
    expect(parseJsonColumn('', 'fb')).toBe('fb');
    expect(parseJsonColumn('   ', 'fb')).toBe('fb');
  });

  it('never throws on malformed content — the whole point', () => {
    // The literal payloads from the Aug 7 incident.
    for (const bad of ['Squats - 1', 'Outdoor run, 5.02km in 31 minutes', '{oops', '[1,', 'undefined']) {
      expect(() => parseJsonColumn(bad, null)).not.toThrow();
      expect(parseJsonColumn(bad, 'fb'), bad).toBe('fb');
    }
  });

  it('treats a stored JSON null as absent', () => {
    // Otherwise `null` flows downstream and explodes at the first property read.
    expect(parseJsonColumn('null', 'fb')).toBe('fb');
  });

  it('reports malformed content but stays quiet for empty columns', () => {
    const onMalformed = vi.fn();
    parseJsonColumn('not json', null, onMalformed);
    expect(onMalformed).toHaveBeenCalledOnce();

    onMalformed.mockClear();
    parseJsonColumn(null, null, onMalformed);
    parseJsonColumn('', null, onMalformed);
    expect(onMalformed).not.toHaveBeenCalled();
  });
});

describe('parseJsonArrayColumn', () => {
  it('returns the array when the column holds one', () => {
    expect(parseJsonArrayColumn('[{"name":"Bench"}]')).toEqual([{ name: 'Bench' }]);
  });

  it('returns [] for malformed or absent content', () => {
    expect(parseJsonArrayColumn('Squats - 1')).toEqual([]);
    expect(parseJsonArrayColumn(null)).toEqual([]);
    expect(parseJsonArrayColumn('')).toEqual([]);
  });

  it('returns [] for valid JSON that is not an array', () => {
    // An object would survive JSON.parse and then throw at the first .map(),
    // which is the same crash one frame later.
    expect(parseJsonArrayColumn('{"name":"Bench"}')).toEqual([]);
    expect(parseJsonArrayColumn('42')).toEqual([]);
    expect(parseJsonArrayColumn('"text"')).toEqual([]);
  });

  it('result is always safely iterable', () => {
    for (const raw of [null, '', 'garbage', '{"a":1}', '[1,2]']) {
      expect(() => parseJsonArrayColumn(raw).map(x => x)).not.toThrow();
    }
  });
});

describe('parseJsonObjectColumn', () => {
  it('returns the object when the column holds one', () => {
    expect(parseJsonObjectColumn('{"goal":"strength"}')).toEqual({ goal: 'strength' });
  });

  it('returns null for arrays, scalars, malformed and absent content', () => {
    expect(parseJsonObjectColumn('[1,2]')).toBeNull();
    expect(parseJsonObjectColumn('42')).toBeNull();
    expect(parseJsonObjectColumn('"text"')).toBeNull();
    expect(parseJsonObjectColumn('{oops')).toBeNull();
    expect(parseJsonObjectColumn(null)).toBeNull();
    expect(parseJsonObjectColumn('null')).toBeNull();
  });

  it('supports the `?? {}` pattern used at call sites that dot straight in', () => {
    const prog: any = parseJsonObjectColumn<any>('corrupted') ?? {};
    expect(() => prog.nutritionPlan?.macros).not.toThrow();
    expect(prog.goal).toBeUndefined();
  });
});
