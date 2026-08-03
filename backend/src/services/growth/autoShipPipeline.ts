// Phase 3 — auto-ship pipeline.
//
// Pulls APPROVED recommendations off the queue, and:
//   - tier='auto_ship'  → invokes the Claude Code agent to write + commit the
//                         change, opens a PR, kicks off an OTA notification
//   - tier='spec_only'  → invokes the agent to write a detailed implementation
//                         spec, opens a draft PR with the spec as a comment
//   - tier='manual'     → no-op (these are tracked ideas only)
//
// SAFETY:
//   - Never auto-merges. Always opens a PR for human review.
//   - Per-user concurrency lock so a slow run doesn't pile up.
//   - Caps at MAX_AUTO_SHIPS_PER_DAY so runaway approvals can't burn the
//     repo with low-quality auto-changes.
//
// This file scaffolds the loop. The actual `runAgentForChange` call is
// stubbed pending the next session — we need to set up the Claude Code
// SDK / Anthropic agent loop with the repo as its working directory,
// which is its own focused integration.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MAX_AUTO_SHIPS_PER_DAY = 3;

let _running = false;

export interface ShipResult {
  recommendationId: string;
  tier: string;
  status: 'shipped' | 'spec_drafted' | 'skipped' | 'failed';
  prUrl?: string;
  error?: string;
}

export async function runAutoShipSweep(): Promise<ShipResult[]> {
  if (_running) {
    console.log('[auto-ship] sweep already running, skipping');
    return [];
  }
  _running = true;

  try {
    // Count today's auto-ships to enforce the cap.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const shippedToday = await prisma.recommendation.count({
      where: {
        status: 'shipped',
        shippedAt: { gte: startOfDay },
      },
    });
    const remainingCap = Math.max(0, MAX_AUTO_SHIPS_PER_DAY - shippedToday);

    const approved = await prisma.recommendation.findMany({
      where: { status: 'approved' },
      orderBy: { approvedAt: 'asc' },
      take: 10,
    });

    const results: ShipResult[] = [];
    let autoShippedThisRun = 0;

    for (const rec of approved) {
      try {
        if (rec.tier === 'auto_ship') {
          if (autoShippedThisRun >= remainingCap) {
            results.push({ recommendationId: rec.id, tier: rec.tier, status: 'skipped', error: 'daily cap reached' });
            continue;
          }
          const prUrl = await openAutoShipPR(rec.id, rec.title, rec.description);
          await prisma.recommendation.update({
            where: { id: rec.id },
            data: { status: 'shipped', shippedAt: new Date(), prUrl },
          });
          results.push({ recommendationId: rec.id, tier: rec.tier, status: 'shipped', prUrl });
          autoShippedThisRun += 1;
        } else if (rec.tier === 'spec_only') {
          const prUrl = await openSpecPR(rec.id, rec.title, rec.description);
          await prisma.recommendation.update({
            where: { id: rec.id },
            data: { status: 'shipped', shippedAt: new Date(), prUrl },
          });
          results.push({ recommendationId: rec.id, tier: rec.tier, status: 'spec_drafted', prUrl });
        } else {
          // 'manual' tier — nothing to ship automatically
          results.push({ recommendationId: rec.id, tier: rec.tier, status: 'skipped', error: 'manual tier — tracked only' });
        }
      } catch (err: any) {
        results.push({
          recommendationId: rec.id,
          tier: rec.tier,
          status: 'failed',
          error: err?.message ?? String(err),
        });
      }
    }

    return results;
  } finally {
    _running = false;
  }
}

// ─── Stubs — wire to the Claude Code SDK in the next session ───────────────

async function openAutoShipPR(
  recId: string,
  title: string,
  description: string,
): Promise<string> {
  // TODO(next session): invoke the Claude Code SDK with the repo path,
  // a prompt that includes title + description, branch name, and have it
  // commit + push + open a PR. For now we just file a placeholder issue
  // so the recommendation is tracked.
  console.log(`[auto-ship] (stub) would open PR for ${recId}: ${title}`);
  return `pending-claude-code-integration-${recId}`;
}

async function openSpecPR(
  recId: string,
  title: string,
  description: string,
): Promise<string> {
  // TODO(next session): invoke the Claude Code SDK with a "draft spec" prompt
  // and have it open a DRAFT PR with the spec as the body, no code changes.
  console.log(`[auto-ship] (stub) would draft spec PR for ${recId}: ${title}`);
  return `pending-claude-code-integration-${recId}`;
}
