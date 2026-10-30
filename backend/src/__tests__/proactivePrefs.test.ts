// Flow F1 (how often Anakin reaches out) and B9 (who runs your program):
// defaults, the frequency → cap map, quiet hours across midnight, mutes.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));

const { parseProactivePrefs, DEFAULT_PROACTIVE_PREFS, FREQUENCY_CAP, inQuietHours, topicMuted, muteTopic, unmuteTopic, muteLabel, inferSessionTime } = await import('../proactive/prefs.js');

describe('F1 · preferences', () => {
  it('defaults to Normal, push for time-sensitive, quiet 22–7, outcome reports on, me running the program', () => {
    const p = parseProactivePrefs(null);
    expect(p).toEqual(DEFAULT_PROACTIVE_PREFS);
    expect(p.frequency).toBe('normal');
    expect(p.programOwner).toBe('me');
    expect(p.photoRetentionDays).toBe(90);
  });
  it('reads prefsJson.proactive and drops bad values', () => {
    const p = parseProactivePrefs(JSON.stringify({ units: 'metric', proactive: { frequency: 'often', quietStart: 99, programOwner: 'someone', photoRetentionDays: 0, sessionTime: '9am', mutedTopics: [{ topic: 'hydration', until: null }, 'junk'] } }));
    expect(p.frequency).toBe('often');
    expect(p.quietStart).toBe(22);
    expect(p.programOwner).toBe('me');
    expect(p.photoRetentionDays).toBe(90);
    expect(p.sessionTime).toBeNull();
    expect(p.mutedTopics).toEqual([{ topic: 'hydration', until: null, mutedAt: '' }]);
  });
  it('maps frequency to the caption\'s caps: Rarely 2/wk · Normal 1/day · Often 2/day', () => {
    expect(FREQUENCY_CAP.rarely).toEqual({ perDay: 1, perWeek: 2 });
    expect(FREQUENCY_CAP.normal.perDay).toBe(1);
    expect(FREQUENCY_CAP.often.perDay).toBe(2);
  });
  it('quiet hours wrap midnight', () => {
    const p = { quietStart: 22, quietEnd: 7 };
    expect(inQuietHours(p, 23)).toBe(true);
    expect(inQuietHours(p, 3)).toBe(true);
    expect(inQuietHours(p, 7)).toBe(false);
    expect(inQuietHours(p, 12)).toBe(false);
    expect(inQuietHours({ quietStart: 13, quietEnd: 15 }, 14)).toBe(true);
    expect(inQuietHours({ quietStart: 8, quietEnd: 8 }, 8)).toBe(false);
  });
  it('mutes a topic for 30 days or forever, case-insensitively, and unmutes', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    let p = muteTopic(DEFAULT_PROACTIVE_PREFS, 'The fight date', null, now);
    expect(topicMuted(p, 'the fight date', now)).toBe(true);
    p = muteTopic(p, 'Recovery', 30, now);
    expect(topicMuted(p, 'recovery', new Date('2026-11-20T00:00:00Z'))).toBe(true);
    expect(topicMuted(p, 'recovery', new Date('2026-12-05T00:00:00Z'))).toBe(false);
    expect(muteLabel(p.mutedTopics[1])).toBe('Until Nov 29');
    expect(muteLabel(p.mutedTopics[0])).toBe('Muted Oct 30 · forever');
    p = unmuteTopic(p, 'the fight date');
    expect(topicMuted(p, 'the fight date', now)).toBe(false);
    expect(p.mutedTopics).toHaveLength(1);
  });
  it('infers the usual session hour from log times (median, an hour earlier), or nothing under 4 logs', () => {
    expect(inferSessionTime([18, 19, 18, 20, 18])).toBe('17:00');
    expect(inferSessionTime([0, 1, 0, 0])).toBe('23:00');
    expect(inferSessionTime([18, 19])).toBeNull();
  });
});
