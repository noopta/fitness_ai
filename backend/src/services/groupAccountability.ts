// Anakin group accountability (#4) — for a group with anakinDailyEnabled,
// reads each member's recent activity + the group goal, asks Claude to draft
// a single short status message ("Anakin drops by every morning"), and posts
// it to the group's chat as a system message (senderId=null).
//
// Designed to be invoked by a scheduler (one call per opted-in group, once
// per morning). Returns a decision so the caller can log/audit; persists the
// message itself when one is drafted.

import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const prisma = new PrismaClient();

const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-6';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface MemberSummary {
  username: string | null;
  name: string | null;
  goal: string | null;
  workoutsLast7: number;
  mealsLoggedLast3Days: number;
  latestWeightLbs: number | null;
  loggedToday: boolean;
}

async function summarizeMember(userId: string, memberGoal: string | null): Promise<MemberSummary> {
  const since7 = new Date(); since7.setDate(since7.getDate() - 7);
  const since3 = new Date(); since3.setDate(since3.getDate() - 3);
  const todayStr = fmtDate(new Date());

  const [user, workouts, meals, latestBw, todayWorkouts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { username: true, name: true } }),
    prisma.workoutLog.count({ where: { userId, createdAt: { gte: since7 } } }),
    prisma.mealEntry.count({ where: { userId, createdAt: { gte: since3 } } }),
    prisma.bodyWeightLog.findFirst({ where: { userId }, orderBy: { date: 'desc' }, select: { weightLbs: true } }),
    prisma.workoutLog.count({ where: { userId, date: todayStr } }),
  ]);
  return {
    username: user?.username ?? null,
    name: user?.name ?? null,
    goal: memberGoal,
    workoutsLast7: workouts,
    mealsLoggedLast3Days: meals,
    latestWeightLbs: latestBw?.weightLbs ?? null,
    loggedToday: todayWorkouts > 0,
  };
}

export interface CheckinDecision {
  groupId: string;
  posted: boolean;
  text: string | null;
  reasoning: string;
}

const SYSTEM = `You are Anakin, dropping into a group chat to keep everyone honest. ONE short message — friendly, specific, not preachy. Use members' names. Call out anyone on track (positive reinforcement) AND anyone clearly slipping (gentle, not shaming). If the group has a shared goal, note progress toward it. No bullet lists; 2-5 sentences max. End with a single tangible nudge for whoever needs it most. If everyone's clearly off and there's nothing useful to say, return empty.`;

/**
 * Run the morning check-in for one group. Reads members' recent activity,
 * drafts a single message via Claude, persists it. `dryRun=true` does
 * everything except saving the message (useful for debug endpoints).
 */
export async function runAnakinGroupCheckin(
  groupId: string,
  opts: { dryRun?: boolean; injectClient?: Pick<Anthropic, 'messages'> } = {},
): Promise<CheckinDecision> {
  const group = await prisma.groupChat.findUnique({
    where: { id: groupId },
    include: { members: true },
  });
  if (!group) throw new Error('Group not found');
  if (!group.anakinDailyEnabled) {
    return { groupId, posted: false, text: null, reasoning: 'Anakin daily is off for this group.' };
  }

  const summaries = await Promise.all(group.members.map((m) => summarizeMember(m.userId, m.goal)));

  const memberLines = summaries.map((s) => {
    const handle = s.name ?? s.username ?? 'a member';
    const goal = s.goal ? ` (goal: ${s.goal})` : '';
    const wt = s.latestWeightLbs != null ? `, last weight ${s.latestWeightLbs.toFixed(1)}lb` : '';
    return `- ${handle}${goal}: ${s.workoutsLast7} workouts in last 7d, ${s.mealsLoggedLast3Days} meals logged in last 3d, ${s.loggedToday ? 'trained today' : 'no workout today yet'}${wt}.`;
  }).join('\n');

  const userPrompt = [
    `Group: "${group.name}".`,
    group.groupGoal ? `Shared group goal: ${group.groupGoal}.` : 'No shared group goal.',
    '',
    'Members and recent activity:',
    memberLines,
    '',
    "Write today's check-in.",
  ].join('\n');

  // Allow callers (tests) to inject a mock client. Production resolves the
  // real Anthropic SDK only when ANTHROPIC_API_KEY is set.
  const client = opts.injectClient ?? (() => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    return new Anthropic({ apiKey: key });
  })();

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 320,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = (res.content as any[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) {
    return { groupId, posted: false, text: null, reasoning: 'Anakin declined to post (empty draft).' };
  }

  if (opts.dryRun) {
    return { groupId, posted: false, text, reasoning: 'Dry run.' };
  }
  await prisma.groupMessage.create({
    data: { groupId, senderId: null, text },
  });
  return { groupId, posted: true, text, reasoning: 'Posted to group.' };
}

/** Run check-ins across every group with anakinDailyEnabled=true. */
export async function runAnakinGroupSweep(opts: { dryRun?: boolean; injectClient?: Pick<Anthropic, 'messages'> } = {}) {
  const groups = await prisma.groupChat.findMany({
    where: { anakinDailyEnabled: true },
    select: { id: true },
  });
  const out: CheckinDecision[] = [];
  for (const g of groups) {
    try {
      out.push(await runAnakinGroupCheckin(g.id, opts));
    } catch (err: any) {
      out.push({ groupId: g.id, posted: false, text: null, reasoning: `Error: ${err?.message ?? err}` });
    }
  }
  return out;
}
