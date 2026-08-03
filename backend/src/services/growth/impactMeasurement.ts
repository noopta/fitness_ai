// Phase 4 — impact measurement.
//
// For every recommendation that was shipped (PR merged → status='shipped'):
//   - 7 days after shipping  : snapshot the targetMetric, store as after7dMetricJson
//   - 30 days after shipping : snapshot again, store as after30dMetricJson
//
// We already captured `beforeMetricJson` at the moment of shipping (TODO:
// wire that into the auto-ship pipeline once the Claude Code SDK call lands).
// The compare runs against beforeMetricJson and surfaces a delta in the next
// daily digest — so the LLM can SEE what worked and what didn't and adjust
// its next batch of recommendations. That's the recursion.

import { PrismaClient } from '@prisma/client';
import { collectDailyMetrics } from './metricsCollector.js';

const prisma = new PrismaClient();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface MeasurementResult {
  recommendationId: string;
  window: '7d' | '30d';
  snapshot: any;
}

export async function runImpactSweep(now: Date = new Date()): Promise<MeasurementResult[]> {
  // Pull a fresh metrics snapshot once; we'll attribute the same snapshot to
  // every rec that needs a window measurement today.
  const snapshot = await collectDailyMetrics();
  const snapshotJson = JSON.stringify(snapshot);
  const measured: MeasurementResult[] = [];

  // 7-day window
  const sevenDayCutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const need7d = await prisma.recommendation.findMany({
    where: {
      status: 'shipped',
      shippedAt: { lte: sevenDayCutoff },
      after7dMetricJson: null,
    },
    take: 25,
  });
  for (const rec of need7d) {
    await prisma.recommendation.update({
      where: { id: rec.id },
      data: { after7dMetricJson: snapshotJson, measuredAt: now },
    });
    measured.push({ recommendationId: rec.id, window: '7d', snapshot });
  }

  // 30-day window
  const thirtyDayCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
  const need30d = await prisma.recommendation.findMany({
    where: {
      status: 'shipped',
      shippedAt: { lte: thirtyDayCutoff },
      after30dMetricJson: null,
    },
    take: 25,
  });
  for (const rec of need30d) {
    await prisma.recommendation.update({
      where: { id: rec.id },
      data: { after30dMetricJson: snapshotJson, measuredAt: now },
    });
    measured.push({ recommendationId: rec.id, window: '30d', snapshot });
  }

  return measured;
}

// Helper for the digest generator: returns the "what worked, what didn't"
// payload to embed in the next day's prompt. The LLM uses this to close the
// loop — it sees its own past recommendations + their measured deltas.
export async function getRecentImpactReport(limit = 10) {
  const measured = await prisma.recommendation.findMany({
    where: {
      status: 'shipped',
      OR: [
        { after7dMetricJson: { not: null } },
        { after30dMetricJson: { not: null } },
      ],
    },
    orderBy: { measuredAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      targetMetric: true,
      tier: true,
      shippedAt: true,
      beforeMetricJson: true,
      after7dMetricJson: true,
      after30dMetricJson: true,
    },
  });
  return measured;
}
