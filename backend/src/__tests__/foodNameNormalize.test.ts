// Folding for the global food library. The cases that matter are the ones
// where a user's plain-ASCII typing has to reach a row stored in proper Yoruba
// or Igbo orthography.

import { describe, it, expect } from 'vitest';
import {
  foldFoodName,
  foodNameTokens,
  foldFoodNameStripped,
} from '../services/food/foodNameNormalize.js';

describe('foldFoodName — diacritics', () => {
  it('folds Yoruba dot-below and tone marks to plain ASCII', () => {
    expect(foldFoodName('Ẹ̀bà')).toBe('eba');
    expect(foldFoodName('ọ̀gbọ̀nọ̀')).toBe('ogbono');
    expect(foldFoodName('Ẹ̀fọ́ Rírò')).toBe('efo riro');
    expect(foldFoodName('Àmàlà')).toBe('amala');
  });

  it('folds an accented and an unaccented spelling to the same key', () => {
    // This is the whole point: the row is stored accented, the user types ASCII.
    expect(foldFoodName('Ẹ̀bà')).toBe(foldFoodName('eba'));
    expect(foldFoodName('Ẹ̀fọ́ Rírò')).toBe(foldFoodName('efo riro'));
  });
});

describe('foldFoodName — punctuation and spacing', () => {
  it('turns hyphens and apostrophes into spaces, not nothing', () => {
    expect(foldFoodName('Moi-Moi')).toBe('moi moi');
    expect(foldFoodName('Moin-Moin')).toBe('moin moin');
    expect(foldFoodName("Chef's Special")).toBe('chefs special');
  });

  it('lowercases and collapses whitespace', () => {
    expect(foldFoodName('  EGUSI   soup ')).toBe('egusi soup');
    expect(foldFoodName('Jollof Rice')).toBe('jollof rice');
  });

  it('keeps digits — some product names are legitimately numbered', () => {
    expect(foldFoodName('Maggi 2 cube')).toBe('maggi 2 cube');
  });

  it('handles empty and punctuation-only input without throwing', () => {
    expect(foldFoodName('')).toBe('');
    expect(foldFoodName('   ')).toBe('');
    expect(foldFoodName('!!!')).toBe('');
  });
});

describe('foodNameTokens', () => {
  it('drops filler words', () => {
    expect(foodNameTokens('a plate of jollof rice with chicken'))
      .toEqual(['jollof', 'rice', 'chicken']);
    expect(foodNameTokens('a bowl of egusi soup')).toEqual(['egusi', 'soup']);
  });

  it('KEEPS preparation words — they distinguish real foods', () => {
    // Boiled yam ~116 kcal/100 g vs fried yam ~230. Collapsing these would
    // merge rows that must stay separate.
    expect(foodNameTokens('boiled yam')).toEqual(['boiled', 'yam']);
    expect(foodNameTokens('fried yam')).toEqual(['fried', 'yam']);
    expect(foodNameTokens('boiled yam')).not.toEqual(foodNameTokens('fried yam'));
  });

  it('keeps the dish word — "soup" is part of the identity', () => {
    expect(foodNameTokens('egusi soup')).toContain('soup');
  });
});

describe('foldFoodNameStripped', () => {
  it('is the folded name minus filler', () => {
    expect(foldFoodNameStripped('a plate of jollof rice')).toBe('jollof rice');
    expect(foldFoodNameStripped('Ẹ̀bà')).toBe('eba');
  });
});

describe('collision guard — names that must NOT fold together', () => {
  it('keeps short West African names distinct', () => {
    // These are the pairs that a loose fuzzy threshold would merge. Folding
    // itself must never do it.
    const pairs: Array<[string, string]> = [
      ['eba', 'ewa'],
      ['iru', 'isu'],
      ['ogi', 'ogbono'],
      ['amala', 'akara'],
    ];
    for (const [a, b] of pairs) {
      expect(foldFoodName(a), `${a} vs ${b}`).not.toBe(foldFoodName(b));
    }
  });
});
