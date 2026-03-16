import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateStrengthProfileInsights } from '../services/llmService.js';

const router = Router();
const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse the lower bound of a rep string: "6-8" → 6, "10" → 10 */
function parseLowerReps(repsStr: string): number {
  const match = repsStr.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Epley formula: 1RM = weight × (1 + reps / 30). Returns 0 for reps > 15 (unreliable). */
function epley1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || reps > 15 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30));
}

/** ISO week string: "2026-W10" */
function toWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function kgToLbs(kg: number): number {
  return Math.round(kg * 2.2046);
}

// ─── GET /api/strength/profile ────────────────────────────────────────────────

router.get('/strength/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // All workout logs newest-first
    const logs = await prisma.workoutLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
    });

    // All normalization entries (bulk fetch once)
    const allNorms = await prisma.exerciseNormalization.findMany();
    const normMap = new Map(allNorms.map(n => [n.rawName, n]));

    // ── Per-lift data structures ──────────────────────────────────────────────
    // canonicalName → { date → best1RM }
    const liftDayBest = new Map<string, Map<string, number>>();
    // canonicalName → total tonnage (kg × sets × reps)
    const liftTonnage = new Map<string, number>();
    // canonicalName → norm metadata
    const liftMeta = new Map<string, { category: string; primaryMuscle: string; isCompound: boolean }>();
    // category → total volume for radar
    const categoryVolume = new Map<string, number>();

    for (const log of logs) {
      let exercises: Array<{ name: string; sets: number; reps: string; weightKg?: number | null }>;
      try { exercises = JSON.parse(log.exercises); } catch { continue; }

      for (const ex of exercises) {
        if (!ex.weightKg || ex.weightKg <= 0) continue;

        const norm = normMap.get(ex.name.trim());
        const canonical = norm?.canonicalName ?? ex.name.trim();
        const reps = parseLowerReps(ex.reps);
        const oneRM = epley1RM(ex.weightKg, reps);

        // Store metadata
        if (norm && !liftMeta.has(canonical)) {
          liftMeta.set(canonical, {
            category: norm.category,
            primaryMuscle: norm.primaryMuscle,
            isCompound: norm.isCompound,
          });
        }

        // Track daily best 1RM
        if (oneRM > 0) {
          if (!liftDayBest.has(canonical)) liftDayBest.set(canonical, new Map());
          const dayMap = liftDayBest.get(canonical)!;
          const prev = dayMap.get(log.date) ?? 0;
          if (oneRM > prev) dayMap.set(log.date, oneRM);
        }

        // Tonnage: weightKg × sets × reps
        const tonnage = ex.weightKg * ex.sets * reps;
        liftTonnage.set(canonical, (liftTonnage.get(canonical) ?? 0) + tonnage);

        // Category volume for radar
        const cat = norm?.category ?? 'push';
        categoryVolume.set(cat, (categoryVolume.get(cat) ?? 0) + tonnage);
      }
    }

    // ── Build per-lift summaries ──────────────────────────────────────────────
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyKey = thirtyDaysAgo.toISOString().split('T')[0];

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyKey = sixtyDaysAgo.toISOString().split('T')[0];

    const lifts = Array.from(liftDayBest.entries()).map(([canonical, dayMap]) => {
      const sortedDays = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const current1RM = sortedDays[sortedDays.length - 1]?.[1] ?? 0;

      // Monthly gain: best in last 30 days vs best in 30-60 days ago
      const last30 = sortedDays.filter(([d]) => d >= thirtyKey).map(([, v]) => v);
      const prev30 = sortedDays.filter(([d]) => d >= sixtyKey && d < thirtyKey).map(([, v]) => v);
      const last30Best = last30.length ? Math.max(...last30) : 0;
      const prev30Best = prev30.length ? Math.max(...prev30) : 0;
      const monthlyGainPct = prev30Best > 0
        ? Math.round(((last30Best - prev30Best) / prev30Best) * 100)
        : null;

      // Weekly 1RM series for sparkline/chart (last 8 weeks)
      const weekBest = new Map<string, number>();
      for (const [date, rm] of sortedDays) {
        const wk = toWeekKey(date);
        weekBest.set(wk, Math.max(weekBest.get(wk) ?? 0, rm));
      }
      const weekSeries = Array.from(weekBest.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-8)
        .map(([week, rm]) => ({ week, rm, rmLbs: kgToLbs(rm) }));

      const meta = liftMeta.get(canonical);

      return {
        canonicalName: canonical,
        category: meta?.category ?? 'push',
        primaryMuscle: meta?.primaryMuscle ?? 'unknown',
        isCompound: meta?.isCompound ?? false,
        current1RMkg: current1RM,
        current1RMLbs: kgToLbs(current1RM),
        monthlyGainPct,
        totalTonnageKg: Math.round(liftTonnage.get(canonical) ?? 0),
        sessionCount: sortedDays.length,
        weekSeries,
      };
    });

    // Sort: compound big lifts first, then by session count desc
    lifts.sort((a, b) => {
      if (a.isCompound !== b.isCompound) return a.isCompound ? -1 : 1;
      return b.sessionCount - a.sessionCount;
    });

    // ── Overall Strength Index (0–100) ────────────────────────────────────────
    // Based on bodyweight ratios for the big compound lifts
    const bodyweightKg = user?.weightKg ?? 80;
    const COMPOUND_TARGETS: Record<string, number> = {
      'Bench Press': 1.5,
      'Squat': 2.0,
      'Deadlift': 2.5,
      'Overhead Press': 1.0,
      'Pull-Up': 1.0,
    };
    let indexSum = 0, indexCount = 0;
    for (const lift of lifts) {
      const target = COMPOUND_TARGETS[lift.canonicalName];
      if (!target || !lift.current1RMkg) continue;
      const ratio = lift.current1RMkg / bodyweightKg;
      const score = Math.min(100, Math.round((ratio / target) * 100));
      indexSum += score;
      indexCount++;
    }
    const overallStrengthIndex = indexCount > 0 ? Math.round(indexSum / indexCount) : null;

    // ── Strength tier label ───────────────────────────────────────────────────
    function strengthTier(score: number | null): string {
      if (score === null) return 'Not enough data';
      if (score >= 90) return 'Elite';
      if (score >= 75) return 'Advanced';
      if (score >= 55) return 'Intermediate';
      if (score >= 35) return 'Novice';
      return 'Beginner';
    }

    // ── Radar chart scores (0–10) ─────────────────────────────────────────────
    const cats = ['push', 'pull', 'legs', 'hinge', 'core'];
    const maxVol = Math.max(...cats.map(c => categoryVolume.get(c) ?? 0), 1);
    const radarScores = Object.fromEntries(
      cats.map(c => [c, Math.min(10, Math.round(((categoryVolume.get(c) ?? 0) / maxVol) * 10))])
    );

    // ── Total tonnage this month ──────────────────────────────────────────────
    let monthTonnage = 0;
    for (const log of logs) {
      if (log.date < thirtyKey) continue;
      let exs: Array<{ weightKg?: number | null; sets: number; reps: string }>;
      try { exs = JSON.parse(log.exercises); } catch { continue; }
      for (const ex of exs) {
        if (!ex.weightKg) continue;
        monthTonnage += ex.weightKg * ex.sets * parseLowerReps(ex.reps);
      }
    }

    // ── Profile maturity ──────────────────────────────────────────────────────
    const totalLogs = logs.length;
    const maturityLabel = totalLogs >= 40 ? 'Gold' : totalLogs >= 20 ? 'Silver' : 'Bronze';
    const maturityPct = Math.min(100, Math.round((totalLogs / 40) * 100));

    // ── Diagnostic session context (for AI insights) ──────────────────────────
    const sessions = await prisma.session.findMany({
      where: { userId },
      include: { plans: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const recentDiagnoses = sessions
      .map(s => s.plans[0]?.planText)
      .filter(Boolean)
      .slice(0, 3) as string[];

    // ── AI Insights (async, non-blocking for speed) ───────────────────────────
    let aiInsights: string[] = [];
    try {
      aiInsights = await generateStrengthProfileInsights({
        lifts: lifts.slice(0, 6).map(l => ({
          name: l.canonicalName,
          current1RMkg: l.current1RMkg,
          monthlyGainPct: l.monthlyGainPct,
          sessionCount: l.sessionCount,
          category: l.category,
        })),
        overallStrengthIndex,
        strengthTier: strengthTier(overallStrengthIndex),
        bodyweightKg,
        radarScores,
        recentDiagnoses,
        totalLogs,
      });
    } catch (err) {
      console.error('[strength] insights error:', err);
    }

    res.json({
      overallStrengthIndex,
      strengthTier: strengthTier(overallStrengthIndex),
      maturityLabel,
      maturityPct,
      totalLogs,
      monthTonnageKg: Math.round(monthTonnage),
      radarScores,
      lifts,
      aiInsights,
    });
  } catch (err) {
    console.error('Strength profile error:', err);
    res.status(500).json({ error: 'Failed to compute strength profile' });
  }
});

export default router;
