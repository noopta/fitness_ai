/**
 * Internal admin dashboard — data layer.
 *
 * ── Why this exists alongside PostHog ────────────────────────────────────────
 * PostHog owns event streams, funnels-over-events and replay. It cannot see
 * entity state: who has a program, what they actually logged, whether they went
 * quiet and what they did last. Those need joins against our own tables, which
 * is exactly what these endpoints do. Nothing here duplicates a PostHog chart.
 *
 * ── Why absolute counts, never percentages ───────────────────────────────────
 * As of 2026-08-04 there are 162 registered users and 4 weekly actives. A
 * percentage over those denominators is one person changing their mind, and it
 * reads as insight when it is noise. Every number this API returns is a raw
 * count, deliberately. Add rates when the volume earns them.
 *
 * ── A note on scale ──────────────────────────────────────────────────────────
 * The whole dataset is a few thousand rows. These queries deliberately favour
 * clarity over cleverness — full scans with GROUP BY are microseconds here, and
 * the moment that stops being true is the moment this file should be rewritten
 * against a snapshot table rather than incrementally optimised.
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { ADMIN_HTML } from './adminPage.js';

const router = Router();
const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * DAY_MS));

/**
 * Every activity signal we have, unioned into (userId, day, type).
 *
 * ActivityLog is the closest thing to a feature-usage table that actually has
 * data (347 rows across nutrition/workout/wellness/analysis). The dedicated
 * FeatureUsage table has exactly one row and is not used — do not build on it.
 *
 * The domain tables are unioned in as well rather than trusting ActivityLog
 * alone, because ActivityLog only covers four types and is written
 * inconsistently; a meal that exists in MealEntry but not ActivityLog is still
 * a real signal of a live user.
 */
const ACTIVITY_UNION = `
  SELECT userId, date, 'nutrition' AS type FROM MealEntry
  UNION ALL
  SELECT userId, date, 'workout'   AS type FROM WorkoutLog
  UNION ALL
  SELECT userId, date, 'wellness'  AS type FROM WellnessCheckin
  UNION ALL
  SELECT userId, date, type        AS type FROM ActivityLog
`;

/**
 * GET /api/admin/funnel — panel 1.
 *
 * The lifecycle as absolute counts, computed as a STRICTLY NESTED cohort: each
 * stage is the previous stage's users who also did the next thing. That matters
 * — the first version of this counted each stage independently and produced
 * "intake done 27" above "has program 29", which makes the drop between rows
 * meaningless. With nesting, the delta between two rows is exactly the number
 * of real people lost there.
 *
 * Nesting hides anyone who took an unusual path, so those are reported
 * separately in `offPath` rather than quietly dropped.
 */
router.get('/admin/funnel', requireAuth, requireAdmin, async (_req, res) => {
  try {
    // The cohort every downstream stage is measured against.
    const PROG = `SELECT id, createdAt FROM User WHERE savedProgram IS NOT NULL`;
    const one = async (sql: string, ...args: any[]) => {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql, ...args);
      return Number(rows[0]?.n ?? 0);
    };

    const [
      signedUp, hasProgram, loggedEver, cameBack, active30, active7,
      loggedNoProgram, programNoIntake, usedChat, paying,
    ] = await Promise.all([
      one(`SELECT COUNT(*) AS n FROM User`),
      one(`SELECT COUNT(*) AS n FROM (${PROG})`),
      one(`SELECT COUNT(DISTINCT a.userId) AS n FROM (${ACTIVITY_UNION}) a JOIN (${PROG}) p ON p.id = a.userId`),
      one(`SELECT COUNT(DISTINCT a.userId) AS n FROM (${ACTIVITY_UNION}) a JOIN (${PROG}) p ON p.id = a.userId
            WHERE julianday(a.date) - julianday(date(p.createdAt / 1000, 'unixepoch')) >= 7`),
      one(`SELECT COUNT(DISTINCT a.userId) AS n FROM (${ACTIVITY_UNION}) a JOIN (${PROG}) p ON p.id = a.userId WHERE a.date >= ?`, daysAgo(30)),
      one(`SELECT COUNT(DISTINCT a.userId) AS n FROM (${ACTIVITY_UNION}) a JOIN (${PROG}) p ON p.id = a.userId WHERE a.date >= ?`, daysAgo(7)),
      // Off-path: real users the nested funnel cannot represent.
      one(`SELECT COUNT(DISTINCT a.userId) AS n FROM (${ACTIVITY_UNION}) a JOIN User u ON u.id = a.userId WHERE u.savedProgram IS NULL`),
      one(`SELECT COUNT(*) AS n FROM User WHERE savedProgram IS NOT NULL AND coachOnboardingDone = 0`),
      one(`SELECT COUNT(*) AS n FROM AgentConversation`),
      one(`SELECT COUNT(*) AS n FROM User WHERE tier != 'free'`),
    ]);

    const stages = [
      { key: 'signed_up',   label: 'Signed up',                          count: signedUp },
      { key: 'has_program', label: 'Got a generated program',            count: hasProgram },
      { key: 'logged_ever', label: 'Logged anything',                    count: loggedEver },
      { key: 'came_back',   label: 'Logged 7+ days after signing up',    count: cameBack },
      { key: 'active_30d',  label: 'Active in last 30 days',             count: active30 },
      { key: 'active_7d',   label: 'Active in last 7 days',              count: active7 },
    ];

    // Biggest absolute loss between consecutive stages — where to spend effort.
    let worst: { from: string; to: string; lost: number } | null = null;
    for (let i = 1; i < stages.length; i++) {
      const lost = stages[i - 1].count - stages[i].count;
      if (!worst || lost > worst.lost) worst = { from: stages[i - 1].label, to: stages[i].label, lost };
    }

    res.json({
      stages,
      biggestDropOff: worst && worst.lost > 0 ? worst : null,
      offPath: {
        // Logged activity but never had a program — the funnel above excludes
        // them by construction, which would otherwise understate real usage.
        loggedWithoutProgram: loggedNoProgram,
        // Legacy rows from before coachOnboardingDone existed.
        programWithoutIntakeFlag: programNoIntake,
      },
      side: { usedCoachChat: usedChat, payingUsers: paying },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[admin/funnel]', err);
    res.status(500).json({ error: err?.message ?? 'Failed to build funnel' });
  }
});

/**
 * GET /api/admin/users — panel 2.
 *
 * One row per user, every user. At 162 users this is a readable page, and
 * reading individuals beats averaging them: a cohort chart over 13 loggers
 * tells you nothing a sorted table doesn't tell you better.
 */
router.get('/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      WITH activity AS (${ACTIVITY_UNION})
      SELECT
        u.id,
        u.email,
        u.username,
        u.name,
        u.tier,
        u.coachOnboardingDone                                   AS intakeDone,
        CASE WHEN u.savedProgram IS NOT NULL THEN 1 ELSE 0 END  AS hasProgram,
        date(u.createdAt / 1000, 'unixepoch')                   AS signedUp,
        (SELECT COUNT(*) FROM activity a WHERE a.userId = u.id AND a.type = 'nutrition') AS meals,
        (SELECT COUNT(*) FROM activity a WHERE a.userId = u.id AND a.type = 'workout')   AS workouts,
        (SELECT COUNT(*) FROM activity a WHERE a.userId = u.id AND a.type = 'wellness')  AS wellness,
        (SELECT COUNT(DISTINCT a.date) FROM activity a WHERE a.userId = u.id)            AS activeDays,
        (SELECT MAX(a.date) FROM activity a WHERE a.userId = u.id)                       AS lastActivityDay,
        (SELECT a.type FROM activity a WHERE a.userId = u.id
          ORDER BY a.date DESC LIMIT 1)                                                  AS lastActionType,
        CASE WHEN EXISTS (SELECT 1 FROM AgentConversation c WHERE c.userId = u.id)
             THEN 1 ELSE 0 END                                                           AS usedChat
      FROM User u
      ORDER BY lastActivityDay DESC NULLS LAST, u.createdAt DESC
    `);

    const today = isoDay(new Date());
    const users = rows.map(r => {
      const lastDay: string | null = r.lastActivityDay ?? null;
      const daysQuiet = lastDay
        ? Math.round((Date.parse(today) - Date.parse(lastDay)) / DAY_MS)
        : null;
      return {
        id: r.id,
        email: r.email,
        username: r.username,
        name: r.name,
        tier: r.tier,
        signedUp: r.signedUp,
        intakeDone: !!r.intakeDone,
        hasProgram: !!r.hasProgram,
        usedChat: !!r.usedChat,
        meals: Number(r.meals ?? 0),
        workouts: Number(r.workouts ?? 0),
        wellness: Number(r.wellness ?? 0),
        activeDays: Number(r.activeDays ?? 0),
        lastActivityDay: lastDay,
        lastActionType: r.lastActionType ?? null,
        // null means "never did anything at all", which is a different
        // condition from "went quiet" and the UI should not conflate them.
        daysQuiet,
      };
    });

    res.json({
      users,
      total: users.length,
      neverActive: users.filter(u => u.lastActivityDay === null).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: err?.message ?? 'Failed to build user list' });
  }
});

/**
 * GET /admin — the dashboard page.
 *
 * Intentionally NOT behind requireAdmin: it is an empty shell that fetches
 * /api/admin/* , and those ARE guarded. Gating the HTML too would mean a bare
 * 403 with no way to supply a token, so the page renders and the data does not.
 */
router.get('/admin', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(ADMIN_HTML);
});

export default router;
