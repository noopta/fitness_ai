// The loop asks for a plan card when a reply recommends nutrient amounts
// without one (11 Oct 2026: post-surgery advice that never became trackable).

import { describe, it, expect } from 'vitest';
import { needsPlanCard, needsIntakeLog } from '../agent/nutrientAdvice.js';

describe('needsPlanCard', () => {
  it('catches recommended amounts with no card', () => {
    expect(needsPlanCard('Vitamin C (500–1000 mg/day) drives collagen synthesis.', ['read_nutrition_plan'])).toBe(true);
    expect(needsPlanCard('Add vitamin D3 2000 IU daily — yours is very low.', [])).toBe(true);
    expect(needsPlanCard('Keep omega-3 near 2 g a day.', [])).toBe(true);
  });
  it('is satisfied by a plan card', () => {
    expect(needsPlanCard('Vitamin C 1000 mg a day is on the card.', ['propose_nutrition_plan_change'])).toBe(false);
  });
  it('ignores facts and food talk without a recommendation', () => {
    expect(needsPlanCard('An orange has about 70 mg of vitamin C.', [])).toBe(false);
    expect(needsPlanCard('Logged 2 eggs — 12 g protein. 140 g left today.', ['log_meal'])).toBe(false);
    expect(needsPlanCard('Lean on citrus, peppers and berries at meals.', [])).toBe(false);
  });
});

describe('needsIntakeLog', () => {
  it('a supplement report with no log needs one (20 Oct: magnesium + D3 went unlogged)', () => {
    expect(needsIntakeLog('Took magnesium glycinate 400mg and vitamin D3 5000 IU', [])).toBe(true);
    expect(needsIntakeLog('just had my vitamin c', ['read_nutrition_today'])).toBe(true);
    expect(needsIntakeLog('I ate a chicken wrap and fries', [])).toBe(true);
    expect(needsIntakeLog('had a protein shake after sparring', [])).toBe(true);
  });
  it('logged, asked about, or not food: no', () => {
    expect(needsIntakeLog('Took magnesium 400mg', ['log_meal'])).toBe(false);
    expect(needsIntakeLog('Should I take vitamin D 5000 IU?', [])).toBe(false);
    expect(needsIntakeLog('how much magnesium can I take', [])).toBe(false);
    expect(needsIntakeLog('I had a hard sparring session today', [])).toBe(false);
    expect(needsIntakeLog('<app_note>\n- logged: Ate oats\n</app_note>\nwhat should my next session be?', [])).toBe(false);
  });
});

