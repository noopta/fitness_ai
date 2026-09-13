import { describe, it, expect } from 'vitest';
import { budgetFactor, costPerMeal, isOverBudget, tierMultiplier, type PricedAmount } from '../engine/budget.js';
import { nearestMetro, currencyFor, formatMoney, haversineM, DEFAULT_CURRENCY } from '../engine/currency.js';
import { varietyFactor, venueSpreadFactor } from '../engine/foodVariety.js';

const priced = (cents: number, confidence: PricedAmount['confidence'] = 'listed'): PricedAmount =>
  ({ cents, currency: 'CAD', confidence, display: `$${cents / 100}` });

describe('budgetFactor', () => {
  it('does not penalise anything inside budget', () => {
    expect(budgetFactor(priced(1200), 1500)).toBe(1);
    expect(budgetFactor(priced(1500), 1500)).toBe(1);
  });

  it('is soft on a small overshoot and harsh on a large one', () => {
    expect(budgetFactor(priced(1700), 1500)).toBe(0.8);      // 1.13x — stretchable
    expect(budgetFactor(priced(4500), 1500)).toBeLessThan(0.1); // 3x — not an option
  });

  it('cannot be out-argued by a big nutrient gain, because it multiplies', () => {
    // The $45 steak vs $15 budget case: scaled by 0.09, it cannot win.
    const steak = 100 * budgetFactor(priced(4500), 1500);
    const bowl = 40 * budgetFactor(priced(1400), 1500);
    expect(bowl).toBeGreaterThan(steak);
  });

  it('never penalises an unknown price', () => {
    // Punishing unknowns would bury every independent whose menu we could not
    // parse — charging the user for a gap in our data.
    expect(budgetFactor(priced(9999, 'unknown'), 1500)).toBe(1);
  });

  it('is inert with no budget expressed', () => {
    expect(budgetFactor(priced(9999), null)).toBe(1);
    expect(budgetFactor(priced(9999), 0)).toBe(1);
  });
});

describe('costPerMeal', () => {
  it('amortises a grocery basket across the servings it yields', () => {
    // The comparability trap: $40 of groceries is 4 dinners, not one.
    const basket = priced(4000, 'estimated');
    expect(costPerMeal(basket, 4).cents).toBe(1000);
  });

  it('leaves a single-serving takeout price alone', () => {
    expect(costPerMeal(priced(1800), 1).cents).toBe(1800);
  });

  it('lets groceries actually compete once amortised', () => {
    const groceries = costPerMeal(priced(4000, 'estimated'), 4);
    const takeout = priced(1800);
    expect(budgetFactor(groceries, 1500)).toBeGreaterThan(budgetFactor(takeout, 1500));
  });

  it('keeps the estimate hedge in the display', () => {
    expect(costPerMeal(priced(4000, 'estimated'), 4).display).toMatch(/^≈/);
    expect(costPerMeal(priced(4000, 'listed'), 4).display).not.toMatch(/^≈/);
  });

  it('refuses to divide an unknown price into a confident one', () => {
    expect(costPerMeal(priced(0, 'unknown'), 4).confidence).toBe('unknown');
  });
});

describe('isOverBudget', () => {
  it('flags a real overrun and stays quiet otherwise', () => {
    expect(isOverBudget(priced(2000), 1500)).toBe(true);
    expect(isOverBudget(priced(1000), 1500)).toBe(false);
    expect(isOverBudget(priced(9999, 'unknown'), 1500)).toBe(false);
  });
});

describe('price tiers', () => {
  it('scales staples by how expensive the store is, narrowly', () => {
    expect(tierMultiplier('PRICE_LEVEL_INEXPENSIVE')).toBeLessThan(1);
    expect(tierMultiplier('PRICE_LEVEL_EXPENSIVE')).toBeGreaterThan(1);
    expect(tierMultiplier(null)).toBe(1);
    expect(tierMultiplier('GARBAGE')).toBe(1);
  });
});

describe('metro + currency', () => {
  it('resolves a downtown coordinate to its metro', () => {
    expect(nearestMetro(43.6426, -79.3871)?.slug).toBe('toronto-on-ca');
    expect(nearestMetro(51.5074, -0.1278)?.slug).toBe('london-uk');
  });

  it('returns null rather than speaking for an economy it does not know', () => {
    expect(nearestMetro(-33.8688, 151.2093)).toBeNull(); // Sydney, unseeded
  });

  it('derives currency from the ground the user is standing on', () => {
    expect(currencyFor(43.6426, -79.3871)).toBe('CAD');
    expect(currencyFor(40.7580, -73.9855)).toBe('USD');
    expect(currencyFor(51.5074, -0.1278)).toBe('GBP');
    expect(currencyFor(-33.8688, 151.2093)).toBe(DEFAULT_CURRENCY);
  });

  it('measures distance sanely', () => {
    expect(haversineM(43.6532, -79.3832, 43.6532, -79.3832)).toBe(0);
    const torontoToNy = haversineM(43.6532, -79.3832, 40.7128, -74.0060);
    expect(torontoToNy).toBeGreaterThan(540_000);
    expect(torontoToNy).toBeLessThan(580_000);
  });

  it('formats money without pointless decimals', () => {
    expect(formatMoney(1200, 'CAD')).toBe('$12');
    expect(formatMoney(1250, 'CAD')).toBe('$12.50');
    expect(formatMoney(1250, 'GBP')).toBe('£12.50');
    expect(formatMoney(1250, 'XYZ')).toBe('XYZ 12.50');
  });
});

describe('variety', () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

  it('leaves an unseen item untouched', () => {
    expect(varietyFactor('ingredient:salmon', [])).toBe(1);
    expect(varietyFactor('ingredient:salmon', [{ itemKey: 'ingredient:eggs', shownAt: ago(0) }])).toBe(1);
  });

  it('penalises something suggested today, without erasing it', () => {
    const f = varietyFactor('ingredient:salmon', [{ itemKey: 'ingredient:salmon', shownAt: ago(0) }]);
    expect(f).toBeGreaterThanOrEqual(0.35);
    expect(f).toBeLessThan(0.4);
  });

  it('recovers over days, so yesterday is not a life sentence', () => {
    expect(varietyFactor('x', [{ itemKey: 'x', shownAt: ago(1) }])).toBeLessThan(0.65);
    expect(varietyFactor('x', [{ itemKey: 'x', shownAt: ago(3) }])).toBeGreaterThan(0.8);
    expect(varietyFactor('x', [{ itemKey: 'x', shownAt: ago(7) }])).toBeGreaterThan(0.95);
  });

  it('forgives an item the user actually acted on faster than one they ignored', () => {
    const acted = varietyFactor('x', [{ itemKey: 'x', shownAt: ago(2), actedAt: ago(2) }]);
    const ignored = varietyFactor('x', [{ itemKey: 'x', shownAt: ago(2) }]);
    expect(acted).toBeGreaterThan(ignored);
  });

  it('uses the most recent showing when there are several', () => {
    const f = varietyFactor('x', [{ itemKey: 'x', shownAt: ago(10) }, { itemKey: 'x', shownAt: ago(0) }]);
    expect(f).toBeLessThan(0.4);
  });
});

describe('venue spread', () => {
  it('does not penalise the first pick from a venue', () => {
    expect(venueSpreadFactor('place-1', [])).toBe(1);
    expect(venueSpreadFactor('place-1', ['place-2'])).toBe(1);
  });

  it('discounts piling every option onto one shop', () => {
    expect(venueSpreadFactor('place-1', ['place-1'])).toBe(0.75);
    expect(venueSpreadFactor('place-1', ['place-1', 'place-1'])).toBeCloseTo(0.5625);
  });

  it('is inert when a candidate has no venue', () => {
    expect(venueSpreadFactor(null, ['place-1', 'place-1'])).toBe(1);
  });
});
