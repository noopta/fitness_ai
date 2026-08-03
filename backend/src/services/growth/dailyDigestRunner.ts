// Orchestrates the daily digest cycle:
//   collect metrics → generate digest + recommendations → persist → deliver.
//
// Idempotent per-day: if a digest already exists for today, returns it
// without regenerating. This lets cron + manual /api/growth/run-now use
// the same path safely.

import { PrismaClient } from '@prisma/client';
import { collectDailyMetrics, type MetricsSnapshot } from './metricsCollector.js';
import { generateDigest, type DigestOutput } from './digestGenerator.js';
import { sendTelegramMessage } from './telegramPublisher.js';

const prisma = new PrismaClient();

function todayKey(): string {
  // Use the actual calendar date the cron fires on (not "yesterday") so
  // there's one digest row per day.
  return new Date().toISOString().slice(0, 10);
}

function formatRecommendationLine(idx: number, r: DigestOutput['recommendations'][0]): string {
  const tierIcon = r.tier === 'auto_ship' ? '🟢' : r.tier === 'spec_only' ? '🟡' : '🔴';
  return `${tierIcon} *${idx + 1}. ${r.title}* (${r.effort})\n${r.description}\n📊 _Metric:_ ${r.targetMetric}\n🔬 _Mechanism:_ ${r.mechanism}\n⚠️ _Risk:_ ${r.risk}\n🧪 _Falsification:_ ${r.falsification}`;
}

function formatTelegramMessage(digest: DigestOutput, modelUsed: string): string {
  const recs = digest.recommendations
    .map((r, i) => formatRecommendationLine(i, r))
    .join('\n\n— — —\n\n');

  return `📊 *Axiom — Daily Growth Digest*

*${digest.headline}*

${digest.body}

— — —

📌 *Recommendations*

${recs}

_Model: ${modelUsed} • Tap a recommendation in the inline buttons to act on it._`;
}

function buildInlineKeyboard(recommendationIds: string[]): Array<Array<{ text: string; callback_data: string }>> {
  // Three buttons per recommendation: approve / park / reject. One row per rec.
  return recommendationIds.map((id, idx) => [
    { text: `✅ ${idx + 1}`, callback_data: `growth:approve:${id}` },
    { text: `⏸`,            callback_data: `growth:park:${id}` },
    { text: `❌`,            callback_data: `growth:reject:${id}` },
  ]);
}

export interface DigestRunResult {
  digestId: string;
  date: string;
  delivered: number;
  errors: string[];
  skippedReason?: 'already_sent';
  recommendationCount: number;
}

export async function runDailyDigest(opts: { force?: boolean } = {}): Promise<DigestRunResult> {
  const date = todayKey();

  // Idempotency — one digest per day unless force=true (manual rerun)
  const existing = await prisma.dailyDigest.findUnique({
    where: { date },
    include: { recommendations: true },
  });
  if (existing && existing.sentToTelegram && !opts.force) {
    return {
      digestId: existing.id,
      date: existing.date,
      delivered: 0,
      errors: [],
      skippedReason: 'already_sent',
      recommendationCount: existing.recommendations.length,
    };
  }

  // 1. Collect metrics
  const snapshot: MetricsSnapshot = await collectDailyMetrics();

  // 2. Generate digest + recommendations via Gemini
  const { output, modelUsed, promptTokens, completionTokens } = await generateDigest(snapshot);

  // 3. Persist
  const digest = await prisma.dailyDigest.upsert({
    where: { date },
    update: {
      metricsJson: JSON.stringify(snapshot),
      digestMarkdown: formatTelegramMessage(output, modelUsed),
      modelUsed,
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
    },
    create: {
      date,
      metricsJson: JSON.stringify(snapshot),
      digestMarkdown: formatTelegramMessage(output, modelUsed),
      modelUsed,
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
    },
  });

  // Replace recommendations for this digest (handles the force=true case
  // cleanly; on the normal first run there's nothing to delete).
  await prisma.recommendation.deleteMany({ where: { digestId: digest.id } });
  const created = await Promise.all(
    output.recommendations.map((r) => prisma.recommendation.create({
      data: {
        digestId: digest.id,
        title: r.title,
        description: r.description,
        targetMetric: r.targetMetric,
        mechanism: r.mechanism,
        effort: r.effort,
        risk: r.risk,
        falsification: r.falsification,
        tier: r.tier,
        status: 'pending',
      },
    })),
  );

  // 4. Deliver to Telegram with inline keyboard for one-tap approve/reject
  const recIds = created.map((r) => r.id);
  const { delivered, errors } = await sendTelegramMessage(
    digest.digestMarkdown,
    {
      parseMode: 'Markdown',
      inlineKeyboard: buildInlineKeyboard(recIds),
    },
  );

  if (delivered > 0) {
    await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { sentToTelegram: true, sentAt: new Date() },
    });
  }

  return {
    digestId: digest.id,
    date: digest.date,
    delivered,
    errors,
    recommendationCount: created.length,
  };
}
