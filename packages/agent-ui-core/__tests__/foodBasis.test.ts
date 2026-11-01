// Barcode → Portion sheet: one model for every source, grams as the only truth.
import { describe, it, expect } from 'vitest';
import {
  amountIn, basisFromProduct, dayImpact, fmtAmount, fmtBarcode, fmtMicro, foundText, gramsFrom, labelColumns, loggedRead, loggedReceipts,
  microRows, parseAmount, portionLogBody, portionText, quickPicks, rulerFor, rulerMarks, rulerTicks, scalePortion, secondaryAmount,
  servingWordFrom, startingGrams, unitOf, whenLogged, type MicroTarget, type ScannedProduct,
} from '../src/foodBasis';

// The handoff's demo product: 150 g container, 140 kcal · 20 P · 9 C · 2.5 F, as per-100 g values.
const yogurt: ScannedProduct = {
  name: 'Greek yogurt, vanilla', brand: 'Oikos', servingSize: '1 container (150 g)', servingQuantityG: 150, source: 'openfoodfacts',
  per100g: { calories: 140 / 1.5, proteinG: 20 / 1.5, carbsG: 9 / 1.5, fatG: 2.5 / 1.5, calciumMg: 200 / 1.5, sodiumMg: 50, sugarG: 4, ironMg: null, fiberG: 0 },
};
const b = basisFromProduct(yogurt, '064420051124');
const again = basisFromProduct({ ...yogurt, source: 'your_foods', originalSource: 'openfoodfacts', yourFood: { lastGrams: 170, lastLoggedAt: '2026-10-27T12:00:00Z' } }, '064420051124');

describe('basisFromProduct', () => {
  it('normalizes per-100 g values to per gram, once', () => {
    expect(b.perGram.kcal * 150).toBeCloseTo(140);
    expect(b.perGram.proteinG * 150).toBeCloseTo(20);
    expect(b.perGram.nutrients.calciumMg * 150).toBeCloseTo(200);
  });
  it('keeps micros, skips nulls, and never treats a macro as a micro', () => {
    expect(b.perGram.nutrients).not.toHaveProperty('ironMg');
    expect(b.perGram.nutrients).not.toHaveProperty('proteinG');
    expect(b.perGram.nutrients).not.toHaveProperty('calories');
    expect(b.perGram.nutrients.sugarG).toBeCloseTo(0.04);
  });
  it('reads every serving field the sources use', () => {
    for (const p of [{ servingQuantityG: 40 }, { servingSizeG: 40 }, { servingGrams: 40 }, { serving: { grams: 40 } }]) {
      expect(basisFromProduct({ name: 'x', per100g: {}, ...p }, '1').servingGrams).toBe(40);
    }
  });
  it('with no serving there is no serving tab, and it starts at 100 g', () => {
    const plain = basisFromProduct({ name: 'Oats', per100g: { calories: 380 } }, '1');
    expect(plain.servingGrams).toBeNull();
    expect(plain.units.map((u) => u.key)).toEqual(['g', 'oz']);
    expect(startingGrams(plain)).toBe(100);
  });
  it('starts at the last amount when seen before, else one serving', () => {
    expect(startingGrams(b)).toBe(150);
    expect(startingGrams(again)).toBe(170);
  });
  it('tells a label from a database, even once it is in Your foods', () => {
    expect(b.fromLabel).toBe(false);
    expect(basisFromProduct({ ...yogurt, source: 'community' }, '1').fromLabel).toBe(true);
    expect(basisFromProduct({ ...yogurt, source: 'your_foods', originalSource: 'community' }, '1').fromLabel).toBe(true);
  });
  it('survives a thin answer', () => {
    const thin = basisFromProduct({}, '1');
    expect(thin.name).toBe('Unknown product');
    expect(scalePortion(thin, 100).kcal).toBe(0);
  });
});

describe('servingWordFrom', () => {
  it('finds the word on a real label', () => {
    expect(servingWordFrom('1 container (150 g)')).toBe('container');
    expect(servingWordFrom('1 bar (40g)')).toBe('bar');
    expect(servingWordFrom('Pouch')).toBe('pouch');
  });
  it('falls back to serving rather than guess', () => {
    for (const s of ['150 g', '2 tbsp (32 g)', '30g', '', null, undefined, '1 cup', 'about 3 pieces (30 g)']) expect(servingWordFrom(s)).toBe('serving');
  });
});

describe('units', () => {
  it('a unit change never changes grams', () => {
    for (const key of ['g', 'oz', 'serving'] as const) {
      const u = unitOf(b, key);
      expect(gramsFrom(amountIn(170, u), u)).toBeCloseTo(170, 1);
    }
  });
  it('totals follow grams exactly and do not round', () => {
    const t = scalePortion(b, 170);
    expect(t.kcal).toBeCloseTo(158.67, 2);
    expect(t.proteinG).toBeCloseTo(22.67, 2);
    expect(t.nutrients.calciumMg).toBeCloseTo(226.67, 2);
    expect(scalePortion(b, -5).kcal).toBe(0);
  });
  it('formats each unit the way the sheet shows it', () => {
    expect(fmtAmount(170.4, 'g')).toBe('170');
    expect(fmtAmount(6, 'oz')).toBe('6.0');
    expect(fmtAmount(1.25, 'serving')).toBe('1.25');
    expect(portionText(150, unitOf(b, 'serving'), 'container')).toBe('1 container');
    expect(portionText(187.5, unitOf(b, 'serving'), 'container')).toBe('1.25 containers');
    expect(portionText(170, unitOf(b, 'g'), 'container')).toBe('170 g');
  });
  it('the conversion beside the hero', () => {
    expect(secondaryAmount(170, b, 'g')).toBe('1.1 containers');
    expect(secondaryAmount(150, b, 'g')).toBe('1 container');
    expect(secondaryAmount(170, b, 'oz')).toBe('170 g');
    expect(secondaryAmount(100, basisFromProduct({ per100g: {} }, '1'), 'g')).toBe('3.5 oz');
  });
  it('typing rejects what is not a number and clamps', () => {
    const g = unitOf(b, 'g');
    expect(parseAmount('abc', g)).toBeNull();
    expect(parseAmount('', g)).toBeNull();
    expect(parseAmount('-20', g)).toBe(0);
    expect(parseAmount('12,5', g)).toBe(12.5);
    expect(parseAmount('99999', g)).toBe(5000);
    expect(parseAmount('2', unitOf(b, 'serving'))).toBe(300);
  });
});

describe('ruler', () => {
  it('matches the handoff scale for each unit', () => {
    expect(rulerFor(b, 'g')).toMatchObject({ step: 1, px: 6, minor: 5, major: 50, max: 600 });
    expect(rulerFor(b, 'oz')).toMatchObject({ step: 0.1, px: 160, minor: 0.1, major: 1, max: 21 });
    expect(rulerFor(b, 'serving')).toMatchObject({ step: 0.25, px: 240, minor: 0.25, major: 1, max: 4 });
  });
  it('grows only when the product needs it, within a limit', () => {
    expect(rulerFor(basisFromProduct({ per100g: {}, servingGrams: 400 }, '1'), 'g').max).toBe(800);
    expect(rulerFor(basisFromProduct({ per100g: {}, yourFood: { lastGrams: 900 } }, '1'), 'g').max).toBe(1150);
    expect(rulerFor(basisFromProduct({ per100g: {}, servingGrams: 5000 }, '1'), 'g').max).toBe(1500);
  });
  it('grams: minor every 5, mid every 25, major and labelled every 50', () => {
    const t = rulerTicks(rulerFor(b, 'g'));
    expect(t).toHaveLength(121);
    expect(t[1]).toEqual({ x: 30, kind: 'minor' });
    expect(t[5]).toEqual({ x: 150, kind: 'mid' });
    expect(t[10]).toEqual({ x: 300, kind: 'major', label: '50' });
    expect(t.at(-1)).toEqual({ x: 3600, kind: 'major', label: '600' });
  });
  it('ounces and containers label as designed, with no float drift', () => {
    const oz = rulerTicks(rulerFor(b, 'oz'));
    expect(oz).toHaveLength(211);
    expect(oz[30]).toEqual({ x: 480, kind: 'major', label: '3.0' });
    expect(oz.filter((t) => t.kind === 'mid')).toHaveLength(0);
    const s = rulerTicks(rulerFor(b, 'serving'));
    expect(s.filter((t) => t.kind === 'major').map((t) => t.label)).toEqual(['0', '1', '2', '3', '4']);
  });
  it('marks closer than 72 pt drop, keeping the first', () => {
    const g = unitOf(again, 'g');
    // 150 g and 170 g are 120 pt apart in grams, so both stay.
    expect(rulerMarks(again, g, rulerFor(again, 'g')).map((m) => m.label)).toEqual(['1 container', 'last']);
    const close = basisFromProduct({ ...yogurt, yourFood: { lastGrams: 155 } }, '1');
    expect(rulerMarks(close, g, rulerFor(close, 'g')).map((m) => m.label)).toEqual(['1 container']);
    expect(rulerMarks(b, g, rulerFor(b, 'g')).find((m) => m.label === 'last')).toBeUndefined();
  });
});

describe('quickPicks', () => {
  it('as designed, in order', () => {
    expect(quickPicks(again)).toEqual([
      { label: '½ container', grams: 75 }, { label: '1 container', grams: 150 }, { label: '100 g', grams: 100 }, { label: 'Last time · 170 g', grams: 170 },
    ]);
  });
  it('two picks on the same grams show once', () => {
    const p = quickPicks(basisFromProduct({ per100g: {}, servingSize: '1 bar', servingGrams: 100, yourFood: { lastGrams: 100 } }, '1'));
    expect(p.map((x) => x.label)).toEqual(['½ bar', '1 bar']);
  });
  it('no serving means no serving picks', () => {
    expect(quickPicks(basisFromProduct({ per100g: {} }, '1')).map((x) => x.label)).toEqual(['50 g', '100 g']);
  });
});

describe('dayImpact', () => {
  const day = { targetKcal: 2450, targetProtein: 170, eatenKcal: 1640, eatenProtein: 132 };
  it('leaves what the handoff shows', () => {
    const d = dayImpact(day, scalePortion(b, 170))!;
    expect(d.over).toBe(false);
    expect(d.kcal).toBe(651);
    expect(d.proteinLeft).toBe(15);
    expect(d.eatenFrac).toBeCloseTo(1640 / 2450);
  });
  it('drops the protein clause at or below zero', () => {
    expect(dayImpact({ ...day, eatenProtein: 170 }, scalePortion(b, 170))!.proteinLeft).toBeNull();
    expect(dayImpact({ ...day, targetProtein: null }, scalePortion(b, 170))!.proteinLeft).toBeNull();
  });
  it('says how far over, and the segment stops at the end of the track', () => {
    const d = dayImpact({ ...day, eatenKcal: 2400 }, { kcal: 170, proteinG: 0 })!;
    expect(d.over).toBe(true);
    expect(d.kcal).toBe(120);
    expect(d.eatenFrac + d.portionFrac).toBeCloseTo(1);
  });
  it('already past target: the bar is full and the segment has no room', () => {
    const d = dayImpact({ ...day, eatenKcal: 3000 }, { kcal: 100, proteinG: 0 })!;
    expect(d.eatenFrac).toBe(1);
    expect(d.portionFrac).toBe(0);
  });
  it('no target hides it', () => {
    expect(dayImpact({ ...day, targetKcal: null }, scalePortion(b, 170))).toBeNull();
    expect(dayImpact({ ...day, targetKcal: 0 }, scalePortion(b, 170))).toBeNull();
  });
});

describe('microRows', () => {
  const targets: MicroTarget[] = [
    { key: 'calciumMg', label: 'Calcium', target: 1000, unit: 'mg', direction: 'min' },
    { key: 'vitaminDIU', label: 'Vitamin D', target: 600, unit: 'IU', direction: 'min', focus: true },
    { key: 'sodiumMg', label: 'Sodium', target: 2300, unit: 'mg', direction: 'limit' },
    { key: 'ironMg', label: 'Iron', target: 18, unit: 'mg', direction: 'min' },
    { key: 'zeroMg', label: 'Zero target', target: 0, unit: 'mg', direction: 'min' },
    { key: 'b12', label: 'Vitamin B12', target: 2.4, unit: 'mcg', direction: 'min' },
  ];
  const n = { calciumMg: 227, vitaminDIU: 90, sodiumMg: 85, b12: 1.02, zeroMg: 5 };
  it('focus first, then biggest share, limits out by default', () => {
    const r = microRows(n, targets);
    expect(r.rows.map((x) => x.key)).toEqual(['vitaminDIU', 'b12', 'calciumMg']);
    expect(r.focus?.pct).toBe(15);
    expect(r.total).toBe(4);
  });
  it('all brings limits in, last, and a limit is never the focus', () => {
    const r = microRows(n, [...targets.slice(0, 2), { ...targets[2], focus: true }], true);
    expect(r.rows.at(-1)).toMatchObject({ key: 'sodiumMg', limit: true, focus: false });
  });
  it('leaves out what this food does not have', () => {
    expect(microRows(n, targets, true).rows.map((x) => x.key)).not.toContain('ironMg');
  });
  it('caps the default list at five', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, target: 10, direction: 'min' }));
    expect(microRows(Object.fromEntries(many.map((m) => [m.key, 1])), many).rows).toHaveLength(5);
  });
  it('amounts: one decimal under 10, integers above, µg for mcg', () => {
    expect(fmtMicro(2.27, 'mcg')).toBe('2.3 µg');
    expect(fmtMicro(226.7, 'mg')).toBe('227 mg');
  });
});

describe('labelColumns', () => {
  it('shows the printed basis, and the toggle never touches the amount', () => {
    expect(labelColumns(b, false)).toMatchObject({ heading: 'Label · per 1 container (150 g)', toggle: 'per 100 g' });
    expect(labelColumns(b, false).values.map((v) => v.value)).toEqual(['140', '20 g', '9 g', '2.5 g']);
    expect(labelColumns(b, true)).toMatchObject({ heading: 'Label · per 100 g', toggle: 'per container' });
    expect(labelColumns(b, true).values[0].value).toBe('93');
  });
  it('no serving means per 100 g with no toggle', () => {
    expect(labelColumns(basisFromProduct({ per100g: { calories: 380 } }, '1'), false)).toMatchObject({ heading: 'Label · per 100 g', toggle: null });
  });
});

describe('words', () => {
  it('formats barcodes', () => {
    expect(fmtBarcode('064420051124')).toBe('0 64420 05112 4');
    expect(fmtBarcode('5449000000996')).toBe('5 449000 000996');
    expect(fmtBarcode('12345678')).toBe('12345678');
  });
  it('says when, in local days', () => {
    const now = new Date(2026, 9, 29, 9);
    expect(whenLogged(new Date(2026, 9, 29, 7).toISOString(), now)).toBe('today');
    expect(whenLogged(new Date(2026, 9, 28, 23).toISOString(), now)).toBe('yesterday');
    expect(whenLogged(new Date(2026, 9, 27, 12).toISOString(), now)).toBe('last Tuesday');
    expect(whenLogged(new Date(2026, 9, 3, 12).toISOString(), now)).toBe('on Oct 3');
    expect(whenLogged(null, now)).toBeNull();
    expect(whenLogged('garbage', now)).toBeNull();
  });
  it('the FOUND receipt, first scan and again', () => {
    expect(foundText(b)).toBe('Open Food Facts · label per 150 g');
    expect(foundText(again, new Date(2026, 9, 29, 9))).toBe('Your foods · logged 170 g last Tuesday');
  });
  it('the confirmation line uses only numbers we have', () => {
    const day = { targetKcal: 2450, targetProtein: 170, eatenKcal: 1640, eatenProtein: 132 };
    expect(loggedRead(scalePortion(b, 170), day)).toBe('23 g of protein in. 15 g to go.');
    expect(loggedRead(scalePortion(b, 170), { ...day, eatenProtein: 170 })).toBe('23 g of protein in. That covers today’s target.');
    expect(loggedRead(scalePortion(b, 170), { ...day, targetProtein: null })).toBe('23 g of protein in.');
    expect(loggedRead({ kcal: 100, proteinG: 0 }, day)).toBe('100 kcal in.');
  });
  it('the confirmation receipts match the handoff', () => {
    expect(loggedReceipts(b, 170, scalePortion(b, 170))).toEqual([
      { verb: 'Logged', text: 'Greek yogurt, vanilla · 170 g — 159 kcal · 23 P · 10 C · 3 F' },
      { verb: 'Saved', text: 'Your foods — next scan starts at 170 g' },
    ]);
  });
});

describe('portionLogBody', () => {
  it('rounds totals only here, and carries the portion and the food', () => {
    const body = portionLogBody(b, 170, 'g', 'snack', '2026-10-29');
    expect(body).toMatchObject({ date: '2026-10-29', mealType: 'snack', name: 'Greek yogurt, vanilla · Oikos', calories: 159, proteinG: 22.7, carbsG: 10.2, fatG: 2.8, source: 'barcode', barcode: '064420051124' });
    expect(body.portion).toEqual({ grams: 170, unit: 'g', unitLabel: 'g' });
    expect(body.ingredients).toEqual(['Greek yogurt, vanilla (170 g)']);
    expect(body.nutrients?.calciumMg).toBeCloseTo(226.67, 1);
    expect(body.foodBasis).toBe(yogurt);
  });
  it('the unit is remembered with its word', () => {
    expect(portionLogBody(b, 187.5, 'serving', 'snack', 'd').portion).toEqual({ grams: 187.5, unit: 'serving', unitLabel: 'container' });
    expect(portionLogBody(b, 170, 'oz', 'snack', 'd').portion.unitLabel).toBe('oz');
  });
  it('the name stays the same at any amount, so a saved food never splits', () => {
    expect(portionLogBody(b, 100, 'g', 's', 'd').name).toBe(portionLogBody(b, 300, 'oz', 's', 'd').name);
  });
  it('sends no nutrients key when the label has none', () => {
    expect(portionLogBody(basisFromProduct({ name: 'x', per100g: { calories: 100 } }, '1'), 100, 'g', 's', 'd')).not.toHaveProperty('nutrients');
  });
});
