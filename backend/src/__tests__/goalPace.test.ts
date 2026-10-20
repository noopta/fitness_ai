import { describe, it, expect } from 'vitest';
import { planPace, bandFor, projectKg } from '../services/goalPace.js';

const lb = (x: number) => x / 2.20462;
// Saeed, 20 Oct 2026: 170 lb, needs ~151 lb walk-around by fight-week start
// (Jan 4, water loading begins), weigh-in limit 146 lb on Jan 14.
const saeed = { today: '2026-10-20', currentKg: lb(170), targetKg: lb(151), byDate: '2027-01-04', tdee: 3370, floorKcal: 1700, weighIn: { limitKg: lb(146), date: '2027-01-14' } };

describe('planPace', () => {
  it('Saeed: about 1%/week makes 151 by fight week — the recommended route, with an accurate timeline', () => {
    const p = planPace(saeed);
    expect(p.direction).toBe('loss');
    expect(p.required.band).toBe('aggressive'); // ~1.03%/wk needed
    expect(p.recommended.band).toBe('acceptable'); // 1%/wk lands within ~0.5 lb
    expect(p.recommended.kgOnDate * 2.20462).toBeLessThan(152.5);
    expect(p.recommended.acuteFraction!).toBeLessThan(0.05);
    expect(p.recommended.kcal).toBeGreaterThan(2400);
    expect(p.unreachableSafely).toBe(false);
  });
  it('Saeed: the slow route is shown honestly — it leaves a >5% acute cut', () => {
    const slow = planPace(saeed).options.find((o) => o.band === 'recommended')!;
    expect(slow.acuteFraction!).toBeGreaterThan(0.05);
  });
  it('his own 2 lb/week is aggressive but allowed (warned), not refused', () => {
    expect(bandFor(-(2 / 170))).toBe('aggressive');
  });
  it('2,400 kcal: where he lands depends on his real burn — why calibration from weigh-ins matters', () => {
    // The app's lifting-days estimate (3,024) vs daily MMA counted (~3,370).
    expect(projectKg(lb(170), 2400, 3024, '2026-10-20', '2027-01-04') * 2.20462).toBeGreaterThan(152);
    expect(projectKg(lb(170), 2400, 3370, '2026-10-20', '2027-01-04') * 2.20462).toBeLessThan(150);
  });
  it('"30 lb in 3 days" is never offered — the earliest safe date instead', () => {
    const p = planPace({ ...saeed, targetKg: lb(140), byDate: '2026-10-23', weighIn: null });
    expect(p.unreachableSafely).toBe(true);
    expect(p.required.band).toBe('unsafe');
    expect(p.options.every((o) => o.band !== 'unsafe')).toBe(true);
    expect(p.notes[0]).toMatch(/Not safely reachable/);
    expect(p.earliestSafeDate > '2027-01-15').toBe(true);
  });
  it('never plans under the calorie floor', () => {
    const p = planPace({ today: '2026-10-20', currentKg: 60, targetKg: 52, byDate: '2026-12-01', tdee: 1900, floorKcal: 1200 });
    for (const o of p.options) expect(o.kcal).toBeGreaterThanOrEqual(1200);
    expect(p.options.some((o) => o.floored)).toBe(true);
  });
  it('a gain goal gets lean-gain paces', () => {
    const p = planPace({ today: '2026-10-20', currentKg: 70, targetKg: 72, byDate: '2027-02-01', tdee: 2600, floorKcal: 1500 });
    expect(p.direction).toBe('gain');
    expect(p.recommended.kcal).toBeGreaterThan(2600);
  });
  it('his own 2 lb/week is a safe option with a warning, reaching 151 early', () => {
    const p = planPace({ ...saeed, requestedKgPerWeek: lb(2) });
    expect(p.requested?.band).toBe('aggressive');
    const o = p.requested!.option!;
    expect(o.label).toMatch(/Their pace/);
    expect(p.options).toContain(o);
    expect(o.reachesOn < '2027-01-04').toBe(true);
    expect(p.notes.join(' ')).toMatch(/aggressive but safe.*warn once/);
    expect(p.notes.join(' ')).toMatch(/hold at maintenance/);
  });
  it('a pace over the ceiling is never an option', () => {
    const p = planPace({ ...saeed, requestedKgPerWeek: lb(4) });
    expect(p.requested).toEqual({ option: null, band: 'unsafe' });
    expect(p.options.every((o) => o.band !== 'unsafe')).toBe(true);
    expect(p.notes.join(' ')).toMatch(/not offered/);
  });
});
