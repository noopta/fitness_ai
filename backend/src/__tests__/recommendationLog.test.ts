/**
 * Crediting a logged meal to a suggestion. A false match teaches us a
 * suggestion worked when it did not, so most of these are about NOT matching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  foodRecommendationLog: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), createMany: vi.fn() },
}));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));

import { keyTokens, matchLoggedMeal, markActedOn } from '../services/foodFinder/recommendationLog.js';

const shown = (itemKey: string, id = itemKey) => ({ id, itemKey });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.foodRecommendationLog.update.mockResolvedValue({});
});

describe('keyTokens', () => {
  it('recovers the significant words from a meal id', () => {
    expect(keyTokens('meal:plate:wild-salmon+rolled-oats+spinach')).toEqual(['wild', 'salmon', 'oat', 'spinach']);
  });
  it('handles menu and dish ids with a place id in the middle', () => {
    expect(keyTokens('menu:ChIJabc123:grilled-chicken-breast-fillet')).toEqual(['chicken', 'breast', 'fillet']);
    expect(keyTokens('dish:ChIJxyz:salmon-poke-bowl')).toEqual(['salmon', 'poke']);
  });
});

describe('matchLoggedMeal', () => {
  it('credits a meal that clearly matches a recent suggestion', async () => {
    mocks.foodRecommendationLog.findMany.mockResolvedValue([shown('dish:p1:salmon-poke-bowl')]);
    expect(await matchLoggedMeal('u1', 'Salmon poke bowl')).toBe('dish:p1:salmon-poke-bowl');
    expect(mocks.foodRecommendationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dish:p1:salmon-poke-bowl' } }));
  });

  it('does not credit a single shared word', async () => {
    // "chicken" alone would match half of everything anyone eats.
    mocks.foodRecommendationLog.findMany.mockResolvedValue([shown('menu:p1:grilled-chicken-breast-fillet')]);
    expect(await matchLoggedMeal('u1', 'Chicken caesar wrap')).toBeNull();
    expect(mocks.foodRecommendationLog.update).not.toHaveBeenCalled();
  });

  it('needs most of the suggestion, not just any overlap', async () => {
    mocks.foodRecommendationLog.findMany.mockResolvedValue([shown('meal:bowl:wild-salmon+rolled-oats+spinach+ground-flaxseed')]);
    // salmon + spinach = 2 of 6 significant words.
    expect(await matchLoggedMeal('u1', 'Salmon and spinach')).toBeNull();
  });

  it('picks the best match when several suggestions overlap', async () => {
    mocks.foodRecommendationLog.findMany.mockResolvedValue([
      shown('meal:stew:lentils+spinach+broccoli', 'a'),
      shown('meal:plate:wild-salmon+rolled-oats+spinach', 'b'),
    ]);
    expect(await matchLoggedMeal('u1', 'wild salmon, oats and spinach')).toBe('meal:plate:wild-salmon+rolled-oats+spinach');
  });

  it('ignores meal names with nothing to match on', async () => {
    mocks.foodRecommendationLog.findMany.mockResolvedValue([shown('dish:p1:salmon-poke-bowl')]);
    expect(await matchLoggedMeal('u1', 'a bowl')).toBeNull();
    expect(mocks.foodRecommendationLog.findMany).not.toHaveBeenCalled();
  });

  it('never throws into meal logging', async () => {
    mocks.foodRecommendationLog.findMany.mockRejectedValue(new Error('db down'));
    await expect(matchLoggedMeal('u1', 'Salmon poke bowl')).resolves.toBeNull();
  });
});

describe('markActedOn', () => {
  it('reports whether it marked anything', async () => {
    mocks.foodRecommendationLog.findFirst.mockResolvedValueOnce({ id: 'r1' });
    expect(await markActedOn('u1', 'dish:p1:x')).toBe(true);
    mocks.foodRecommendationLog.findFirst.mockResolvedValueOnce(null);
    expect(await markActedOn('u1', 'dish:p1:x')).toBe(false);
  });
});

describe('matchLoggedMeal — plurals', () => {
  it('matches "lentil" in a logged meal to "lentils" in a suggestion', async () => {
    mocks.foodRecommendationLog.findMany.mockResolvedValue([shown('meal:stew:lentils+spinach+broccoli')]);
    expect(await matchLoggedMeal('u1', 'Lentil stew with spinach')).toBe('meal:stew:lentils+spinach+broccoli');
  });
});
