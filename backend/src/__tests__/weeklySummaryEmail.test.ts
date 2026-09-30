import { describe, it, expect } from 'vitest';
import { weeklySummaryEmail } from '../services/emailTemplates.js';

describe('weeklySummaryEmail', () => {
  it('lists only the stats that exist and says how to turn it off', () => {
    const m = weeklySummaryEmail({ name: 'Sam Lee', sessions: 3, avgProtein: 142, bwDelta: -0.4, unit: 'kg', streak: 0 });
    expect(m.subject).toBe('Your week in review, Sam');
    expect(m.text).toContain('Workouts logged: 3');
    expect(m.text).toContain('Body weight: -0.4 kg');
    expect(m.text).not.toContain('Streak');
    expect(m.html).toContain('You › Notifications');
  });
  it('escapes the name', () => {
    const m = weeklySummaryEmail({ name: '<b>x</b>', sessions: 1, avgProtein: null, bwDelta: null, unit: 'lbs', streak: 2 });
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.text).toContain('Streak: 2 days');
  });
});
