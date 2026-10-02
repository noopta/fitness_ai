import { describe, it, expect } from 'vitest';
import {
  COPY, STATUS_LABEL, countByStatus, createApi, dayHeading, engagementAltText, filterClients, groupByDay,
  initials, mergePages, reasonLine, relativeDay, sparklinePoints, timelinePath,
  type Client, type TimelineEvent,
} from '../src';

const client = (over: Partial<Client>): Client => ({
  id: 'c1', name: 'Maya Okafor', initials: 'MO', email: 'maya@example.com', status: 'onPlan', channel: 'app',
  program: { blockLabel: 'Strength', week: 3, weeks: 8, goal: 'Squat 100 kg' },
  engagement8w: [5, 6, 7, 7, 8, 8, 9, 9], engagementTrend: 'rising', joinedAt: '2026-08-01T00:00:00.000Z',
  contraindications: [], ...over,
});

const event = (id: string, at: string): TimelineEvent => ({ id, clientId: 'c1', kind: 'workout', at, title: 'Workout', body: '' });

describe('format', () => {
  it('builds initials from name, then email', () => {
    expect(initials('Maya Okafor')).toBe('MO');
    expect(initials('Maya Ada Okafor')).toBe('MO');
    expect(initials('Dami')).toBe('DA');
    expect(initials(null, 'kofi@example.com')).toBe('K');
    expect(initials(null, null)).toBe('?');
  });

  it('describes days relative to the viewer', () => {
    const now = new Date(2026, 9, 2, 9, 0);
    expect(relativeDay(new Date(2026, 9, 2, 6, 0).toISOString(), now)).toBe('Today');
    expect(relativeDay(new Date(2026, 9, 1, 23, 0).toISOString(), now)).toBe('Yesterday');
    expect(relativeDay(new Date(2026, 8, 29, 12, 0).toISOString(), now)).toBe('3 days ago');
    expect(relativeDay(new Date(2026, 8, 20, 12, 0).toISOString(), now)).toBe('20 Sep');
    expect(relativeDay(new Date(2025, 8, 20, 12, 0).toISOString(), now)).toBe('20 Sep 2025');
    expect(relativeDay(undefined, now)).toBeNull();
    expect(dayHeading(new Date(2026, 8, 28, 12, 0).toISOString(), now)).toBe('Mon 28 Sep');
  });

  it('maps a series onto sparkline points inside the box', () => {
    expect(sparklinePoints([0, 10], 72, 24)).toBe('2,22 70,2');
    expect(sparklinePoints([5], 72, 24)).toBe('36,12');
    expect(sparklinePoints([], 72, 24)).toBe('');
    // Out-of-range values are clamped, not drawn outside the box.
    expect(sparklinePoints([-3, 14], 72, 24)).toBe('2,22 70,2');
  });

  it('gives sparklines a text alternative', () => {
    expect(engagementAltText('falling', 8)).toBe('Engagement falling over 8 weeks');
  });
});

describe('roster', () => {
  const clients = [
    client({ id: 'a', name: 'Maya Okafor', status: 'support', statusReason: 'No session logged in 9 days' }),
    client({ id: 'b', name: 'Dami Bello', email: 'dami@example.com', status: 'new', program: null }),
    client({ id: 'c', name: 'Jordan Lee', email: null }),
  ];

  it('counts every status, including empty ones', () => {
    expect(countByStatus(clients)).toEqual({ all: 3, support: 1, new: 1, onPlan: 1, paused: 0 });
  });

  it('filters by status and by name, email or goal', () => {
    expect(filterClients(clients, 'support', '').map((c) => c.id)).toEqual(['a']);
    expect(filterClients(clients, 'all', 'dami@').map((c) => c.id)).toEqual(['b']);
    expect(filterClients(clients, 'all', '  SQUAT ').map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterClients(clients, 'paused', '')).toEqual([]);
  });

  it('prefers the status reason, then program position', () => {
    expect(reasonLine(clients[0])).toBe('No session logged in 9 days');
    expect(reasonLine(clients[2])).toBe('Strength · week 3 of 8');
    expect(reasonLine(clients[1])).toBeNull();
  });
});

describe('timeline', () => {
  it('groups newest-first events by local day', () => {
    const now = new Date(2026, 9, 2, 20, 0);
    const days = groupByDay([
      event('1', new Date(2026, 9, 2, 18, 0).toISOString()),
      event('2', new Date(2026, 9, 2, 7, 0).toISOString()),
      event('3', new Date(2026, 9, 1, 7, 0).toISOString()),
    ], now);
    expect(days.map((d) => [d.heading, d.events.map((e) => e.id)])).toEqual([['Today', ['1', '2']], ['Yesterday', ['3']]]);
  });

  it('merges pages without repeating an event', () => {
    const a = event('1', '2026-10-02T10:00:00.000Z');
    const b = event('2', '2026-10-01T10:00:00.000Z');
    expect(mergePages([{ events: [a, b], nextCursor: 'x' }, { events: [b], nextCursor: null }]).map((e) => e.id)).toEqual(['1', '2']);
  });
});

describe('api', () => {
  it('builds timeline paths with kind and cursor', () => {
    expect(timelinePath('c 1', [], null)).toBe('/personal-training/clients/c%201/timeline');
    expect(timelinePath('c1', ['workout', 'checkin'], '2026-10-01T00:00:00.000Z|workout:9'))
      .toBe('/personal-training/clients/c1/timeline?kind=workout%2Ccheckin&cursor=2026-10-01T00%3A00%3A00.000Z%7Cworkout%3A9');
  });

  it('sends invites as app-mode and omits an empty email', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createApi(async (path, init) => { calls.push([path, init]); return {}; });
    await api.invite();
    await api.invite('dami@example.com');
    expect(calls[0]).toEqual(['/personal-training/clients/invite', { method: 'POST', body: '{"mode":"app"}' }]);
    expect(JSON.parse((calls[1][1] as { body: string }).body)).toEqual({ mode: 'app', email: 'dami@example.com' });
  });
});

describe('copy', () => {
  it('never says "at risk" and uses no exclamation marks or emoji', () => {
    expect(STATUS_LABEL.support).toBe('Might need support');
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'function') strings.push(String((v as (...a: unknown[]) => string)('x')));
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(COPY); walk(STATUS_LABEL);
    for (const s of strings) {
      expect(s).not.toMatch(/!/);
      expect(s.toLowerCase()).not.toMatch(/at risk|churn/);
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

import { BRIEFING_STREAM_PATH, anakinMessagePath, createEventParser } from '../src';

describe('streamed endpoints', () => {
  it('parses frames split across chunks and skips a malformed one', () => {
    const seen: unknown[] = [];
    const feed = createEventParser((e) => seen.push(e));
    feed('data: {"type":"status","text":"Reading"}\n\ndata: {"ty');
    expect(seen).toEqual([{ type: 'status', text: 'Reading' }]);
    feed('pe":"done"}\n\ndata: not json\n\ndata: {"type":"x"}\n\n');
    expect(seen).toEqual([{ type: 'status', text: 'Reading' }, { type: 'done' }, { type: 'x' }]);
  });

  it('builds stream paths', () => {
    expect(BRIEFING_STREAM_PATH).toBe('/personal-training/briefing/today/stream');
    expect(anakinMessagePath(null)).toBe('/personal-training/anakin/threads/new/messages');
    expect(anakinMessagePath('t 1')).toBe('/personal-training/anakin/threads/t%201/messages');
  });
});
