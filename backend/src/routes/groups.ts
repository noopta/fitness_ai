// Group chats (#4) — small messaging surface between users with an opt-in
// daily Anakin accountability post. Each member can share their workout goal;
// the group itself can have a shared goal Anakin tracks.
//
// Flag-gated like the rest of the agent surface — these endpoints 404 when
// the agent isn't enabled (AGENT_ENABLED off) so an inadvertent main merge is
// inert in production until cutover.

import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { runAnakinGroupCheckin } from '../services/groupAccountability.js';

const prisma = new PrismaClient();
const router = Router();

const AGENT_ENABLED = process.env.AGENT_ENABLED === 'true';
// Mirror the agent surface's allowlist for safe cutover: with allowlist set,
// only those users get groups (no uncapped Anakin check-in spend from random
// users). Remove/empty the allowlist to open to all users once trusted.
const AGENT_ALLOWLIST = (process.env.AGENT_USER_ALLOWLIST || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Master flag guard for the whole group surface — pre-auth.
router.use('/groups', (req, res, next) => {
  if (!AGENT_ENABLED) return res.status(404).json({ error: 'Not found' });
  next();
});

// Per-user allowlist guard — runs AFTER requireAuth. 404 (not 403) so the
// surface stays invisible to non-allowlisted users.
function requireGroupsAccess(req: any, res: any, next: any) {
  if (AGENT_ALLOWLIST.length && !AGENT_ALLOWLIST.includes(req.user?.id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  groupGoal: z.string().max(400).optional(),
  memberUsernames: z.array(z.string()).max(20).optional(),
  selfGoal: z.string().max(400).optional(),
  anakinDailyEnabled: z.boolean().optional(),
});

// POST /api/groups — create a new group chat. Creator is auto-added as a
// member; additional members can be invited by username.
router.post('/groups', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const { name, groupGoal, memberUsernames, selfGoal, anakinDailyEnabled } = createSchema.parse(req.body);
    const userId = req.user!.id;

    const others = memberUsernames?.length
      ? await prisma.user.findMany({
          where: { username: { in: memberUsernames } },
          select: { id: true, username: true },
        })
      : [];

    const group = await prisma.groupChat.create({
      data: {
        name, groupGoal: groupGoal ?? null,
        anakinDailyEnabled: !!anakinDailyEnabled,
        createdById: userId,
        members: {
          create: [
            { userId, goal: selfGoal ?? null },
            ...others.filter((o) => o.id !== userId).map((o) => ({ userId: o.id })),
          ],
        },
      },
      include: { members: { include: { user: { select: { id: true, username: true, name: true } } } } },
    });
    res.json({ group });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('[groups] create failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Failed to create group' });
  }
});

// GET /api/groups — list the groups the caller is a member of.
router.get('/groups', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const userId = req.user!.id;
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      include: {
        group: {
          include: {
            members: { include: { user: { select: { id: true, username: true, name: true } } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    res.json({ groups: memberships.map((m) => m.group) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to load groups' });
  }
});

// GET /api/groups/:id — group details + recent messages (last 100).
router.get('/groups/:id', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const userId = req.user!.id;
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId } },
    });
    if (!membership) return res.status(404).json({ error: 'Not found' });
    const group = await prisma.groupChat.findUnique({
      where: { id: req.params.id },
      include: {
        members: { include: { user: { select: { id: true, username: true, name: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!group) return res.status(404).json({ error: 'Not found' });
    res.json({ group: { ...group, messages: group.messages.reverse() } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to load group' });
  }
});

const postMessageSchema = z.object({ text: z.string().min(1).max(2000) });

// POST /api/groups/:id/messages — post a message as the caller.
router.post('/groups/:id/messages', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { text } = postMessageSchema.parse(req.body);
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId } },
    });
    if (!membership) return res.status(404).json({ error: 'Not found' });
    const msg = await prisma.groupMessage.create({
      data: { groupId: req.params.id, senderId: userId, text },
    });
    res.json({ message: msg });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    res.status(500).json({ error: err?.message ?? 'Failed to post message' });
  }
});

const patchSchema = z.object({
  groupGoal: z.string().max(400).nullable().optional(),
  anakinDailyEnabled: z.boolean().optional(),
  selfGoal: z.string().max(400).nullable().optional(),
  name: z.string().min(1).max(80).optional(),
});

// PATCH /api/groups/:id — update group settings (goal, Anakin opt-in, name)
// AND/OR the caller's own member goal in one call.
router.patch('/groups/:id', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const userId = req.user!.id;
    const data = patchSchema.parse(req.body);
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId } },
    });
    if (!membership) return res.status(404).json({ error: 'Not found' });

    const groupUpdate: any = {};
    if (data.name !== undefined) groupUpdate.name = data.name;
    if (data.groupGoal !== undefined) groupUpdate.groupGoal = data.groupGoal;
    if (data.anakinDailyEnabled !== undefined) groupUpdate.anakinDailyEnabled = data.anakinDailyEnabled;
    if (Object.keys(groupUpdate).length) {
      await prisma.groupChat.update({ where: { id: req.params.id }, data: groupUpdate });
    }
    if (data.selfGoal !== undefined) {
      await prisma.groupMember.update({ where: { id: membership.id }, data: { goal: data.selfGoal } });
    }
    res.json({ updated: true });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    res.status(500).json({ error: err?.message ?? 'Failed to update group' });
  }
});

// POST /api/groups/:id/anakin-checkin — manually trigger Anakin's check-in
// for this group (useful for testing). Posts a real message (or returns the
// draft if ?dryRun=1). Membership required.
router.post('/groups/:id/anakin-checkin', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const userId = req.user!.id;
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId } },
    });
    if (!membership) return res.status(404).json({ error: 'Not found' });
    const dryRun = req.query.dryRun === '1';
    const result = await runAnakinGroupCheckin(req.params.id, { dryRun });
    res.json(result);
  } catch (err: any) {
    console.error('[groups] checkin failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Failed to run check-in' });
  }
});

// POST /api/groups/:id/leave — caller leaves the group.
router.post('/groups/:id/leave', requireAuth, requireGroupsAccess, async (req, res) => {
  try {
    const userId = req.user!.id;
    await prisma.groupMember.deleteMany({ where: { groupId: req.params.id, userId } });
    res.json({ left: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to leave group' });
  }
});

export default router;
