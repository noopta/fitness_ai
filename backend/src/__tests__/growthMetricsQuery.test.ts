import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) {}) }));
vi.mock('../services/stripeService.js', () => ({ stripe: null }));

const { EVENT_METRICS, buildEventMetricsQuery, parseEventMetrics } = await import('../services/growth/metricsCollector.js');

describe('growth digest PostHog metrics', () => {
  it('builds a single query with one column per metric', () => {
    const sql = buildEventMetricsQuery(EVENT_METRICS);
    expect(sql.match(/countIf\(|uniqIf\(/g)).toHaveLength(EVENT_METRICS.length);
    expect(sql).toContain("event IN (");
    expect(sql).toContain('INTERVAL 7 DAY');
  });

  it('scopes the coach boundary metric to coach-labelled client boundaries', () => {
    const sql = buildEventMetricsQuery(EVENT_METRICS.filter((m) => m.key === 'coachBoundary'));
    expect(sql).toContain("properties.boundary_label = 'coach-tab'");
    expect(sql).toContain("'coach:'");
    expect(sql).toContain("properties.$lib != 'posthog-node'");
  });

  it('escapes quotes in event names', () => {
    const sql = buildEventMetricsQuery([{ key: 'x', event: "it's", days: 1, agg: 'count' }]);
    expect(sql).toContain("'it\\'s'");
  });

  it('maps a result row back to keys, keeping real zeros', () => {
    const metrics = EVENT_METRICS.slice(0, 3);
    expect(parseEventMetrics(metrics, [11, 0, '5'])).toEqual({ dau: 11, wau: 0, appOpens: 5 });
  });

  it('yields null (unknown), never 0, when the query failed', () => {
    const out = parseEventMetrics(EVENT_METRICS, null);
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });
});
