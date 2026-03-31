import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const prisma = new PrismaClient();

router.use('/social', requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canonicalParticipants(a: string, b: string) {
  return a < b ? { participantAId: a, participantBId: b } : { participantAId: b, participantBId: a };
}

async function areFriendsOrColleagues(userA: string, userB: string): Promise<boolean> {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: userA, addresseeId: userB },
        { requesterId: userB, addresseeId: userA },
      ],
    },
  });
  if (friendship) return true;

  // Check shared institution
  const membershipsA = await prisma.institutionMember.findMany({ where: { userId: userA, active: true }, select: { institutionId: true } });
  const idsA = new Set(membershipsA.map(m => m.institutionId));
  const membershipsB = await prisma.institutionMember.findMany({ where: { userId: userB, active: true }, select: { institutionId: true } });
  return membershipsB.some(m => idsA.has(m.institutionId));
}

// ─── Friends ──────────────────────────────────────────────────────────────────

// GET /api/social/friends
router.get('/social/friends', async (req, res) => {
  const userId = req.user!.id;
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      addressee: { select: { id: true, name: true, email: true } },
    },
  });
  const friends = friendships.map(f =>
    f.requesterId === userId ? f.addressee : f.requester
  );
  res.json(friends);
});

// GET /api/social/friends/requests
router.get('/social/friends/requests', async (req, res) => {
  const requests = await prisma.friendship.findMany({
    where: { addresseeId: req.user!.id, status: 'pending' },
    include: { requester: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests);
});

// POST /api/social/friends/request
router.post('/social/friends/request', async (req, res) => {
  const { targetUserId } = req.body;
  const userId = req.user!.id;
  if (!targetUserId || targetUserId === userId) return res.status(400).json({ error: 'Invalid target' });

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check not blocked
  const blocked = await prisma.friendship.findFirst({
    where: {
      status: 'blocked',
      OR: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    },
  });
  if (blocked) return res.status(403).json({ error: 'Cannot send request' });

  try {
    const friendship = await prisma.friendship.create({
      data: { requesterId: userId, addresseeId: targetUserId, status: 'pending' },
    });
    res.status(201).json(friendship);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Request already exists' });
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// POST /api/social/friends/accept
router.post('/social/friends/accept', async (req, res) => {
  const { requesterId } = req.body;
  const friendship = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId, addresseeId: req.user!.id } },
  });
  if (!friendship || friendship.status !== 'pending') return res.status(404).json({ error: 'Request not found' });

  const updated = await prisma.friendship.update({
    where: { requesterId_addresseeId: { requesterId, addresseeId: req.user!.id } },
    data: { status: 'accepted' },
  });
  res.json(updated);
});

// POST /api/social/friends/decline
router.post('/social/friends/decline', async (req, res) => {
  const { requesterId } = req.body;
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId, addresseeId: req.user!.id },
        { requesterId: req.user!.id, addresseeId: requesterId },
      ],
      status: 'pending',
    },
  });
  res.json({ ok: true });
});

// DELETE /api/social/friends/:userId
router.delete('/social/friends/:userId', async (req, res) => {
  const userId = req.user!.id;
  const otherId = req.params.userId;
  await prisma.friendship.deleteMany({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: userId, addresseeId: otherId },
        { requesterId: otherId, addresseeId: userId },
      ],
    },
  });
  res.json({ ok: true });
});

// POST /api/social/friends/block
router.post('/social/friends/block', async (req, res) => {
  const { targetUserId } = req.body;
  const userId = req.user!.id;
  // Remove any existing friendship first
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    },
  });
  const block = await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: targetUserId, status: 'blocked' },
  });
  res.json(block);
});

// GET /api/social/users/search?q=
router.get('/social/users/search', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 2) return res.json([]);

  const userId = req.user!.id;
  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      OR: [
        { name: { contains: q } },
        { email: { contains: q } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: 10,
  });

  // Filter out blocked users
  const blocked = await prisma.friendship.findMany({
    where: {
      status: 'blocked',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });
  const blockedIds = new Set(blocked.flatMap(f => [f.requesterId, f.addresseeId]).filter(id => id !== userId));
  res.json(users.filter(u => !blockedIds.has(u.id)));
});

// ─── Conversations & Messages ─────────────────────────────────────────────────

// GET /api/social/conversations
router.get('/social/conversations', async (req, res) => {
  const userId = req.user!.id;
  const convos = await prisma.directConversation.findMany({
    where: { OR: [{ participantAId: userId }, { participantBId: userId }] },
    include: {
      participantA: { select: { id: true, name: true, email: true } },
      participantB: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const result = await Promise.all(convos.map(async c => {
    const other = c.participantAId === userId ? c.participantB : c.participantA;
    const unread = await prisma.message.count({
      where: { conversationId: c.id, senderId: { not: userId }, readAt: null },
    });
    return { id: c.id, other, lastMessage: c.messages[0] ?? null, unreadCount: unread, updatedAt: c.updatedAt };
  }));
  res.json(result);
});

// POST /api/social/conversations
router.post('/social/conversations', async (req, res) => {
  const { participantId } = req.body;
  const userId = req.user!.id;
  if (!participantId || participantId === userId) return res.status(400).json({ error: 'Invalid participant' });

  const canMessage = await areFriendsOrColleagues(userId, participantId);
  if (!canMessage) return res.status(403).json({ error: 'Can only message friends or institution colleagues' });

  const ids = canonicalParticipants(userId, participantId);
  const convo = await prisma.directConversation.upsert({
    where: { participantAId_participantBId: ids },
    create: ids,
    update: {},
  });
  res.json(convo);
});

// GET /api/social/conversations/:conversationId/messages
router.get('/social/conversations/:conversationId/messages', async (req, res) => {
  const userId = req.user!.id;
  const { conversationId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;
  const before = req.query.before as string | undefined;

  const convo = await prisma.directConversation.findUnique({ where: { id: conversationId } });
  if (!convo || (convo.participantAId !== userId && convo.participantBId !== userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      ...(before && { id: { lt: before } }),
    },
    include: { sender: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(messages.reverse());
});

// POST /api/social/conversations/:conversationId/messages
router.post('/social/conversations/:conversationId/messages', async (req, res) => {
  const userId = req.user!.id;
  const { conversationId } = req.params;
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message body required' });

  const convo = await prisma.directConversation.findUnique({ where: { id: conversationId } });
  if (!convo || (convo.participantAId !== userId && convo.participantBId !== userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: userId, body: body.trim() },
      include: { sender: { select: { id: true, name: true } } },
    }),
    prisma.directConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
  res.status(201).json(message);
});

// POST /api/social/conversations/:conversationId/read
router.post('/social/conversations/:conversationId/read', async (req, res) => {
  const userId = req.user!.id;
  await prisma.message.updateMany({
    where: { conversationId: req.params.conversationId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

// GET /api/social/conversations/:conversationId/poll?after=<msgId>
router.get('/social/conversations/:conversationId/poll', async (req, res) => {
  const userId = req.user!.id;
  const { conversationId } = req.params;
  const after = req.query.after as string | undefined;

  const convo = await prisma.directConversation.findUnique({ where: { id: conversationId } });
  if (!convo || (convo.participantAId !== userId && convo.participantBId !== userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const since = new Date(Date.now() - 60_000);
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      createdAt: { gte: since },
      ...(after && { id: { gt: after } }),
    },
    include: { sender: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(messages);
});

// ─── Sharing ──────────────────────────────────────────────────────────────────

// POST /api/social/share
router.post('/social/share', async (req, res) => {
  const { recipientId, itemType, itemId, payload } = req.body;
  if (!itemType || !payload) return res.status(400).json({ error: 'itemType and payload required' });

  // Validate text posts have content
  if (itemType === 'text' && !payload.text?.trim()) {
    return res.status(400).json({ error: 'Text content is required for text posts' });
  }

  // Gate media uploads to pro tier
  const isMediaPost = itemType === 'media' || payload.imageBase64 || payload.videoUrl;
  if (isMediaPost) {
    if (req.user!.tier !== 'pro' && req.user!.tier !== 'enterprise') {
      return res.status(403).json({ error: 'Media uploads require a Pro subscription.' });
    }
  }

  // Enforce imageBase64 size limit (~2MB decoded)
  if (payload.imageBase64 && payload.imageBase64.length > 2_800_000) {
    return res.status(400).json({ error: 'Image exceeds the 2MB size limit.' });
  }

  // For directed shares, verify relationship; for feed broadcasts (no recipientId) skip check
  if (recipientId) {
    const canShare = await areFriendsOrColleagues(req.user!.id, recipientId);
    if (!canShare) return res.status(403).json({ error: 'Can only share with friends' });
  }

  const item = await prisma.sharedItem.create({
    data: {
      sharerId: req.user!.id,
      recipientId: recipientId ?? req.user!.id, // fall back to self so column stays non-null
      itemType,
      itemId: itemId ?? null,
      payload: JSON.stringify(payload),
    },
    include: { sharer: { select: { id: true, name: true, email: true } } },
  });
  res.status(201).json({ ...item, payload: JSON.parse(item.payload) });
});

// GET /api/social/shared-feed
router.get('/social/shared-feed', async (req, res) => {
  const userId = req.user!.id;
  const items = await prisma.sharedItem.findMany({
    where: {
      OR: [
        { recipientId: userId },
        { sharerId: userId }, // include own posts
      ],
    },
    include: { sharer: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(items.map(i => ({ ...i, payload: JSON.parse(i.payload) })));
});

// ─── Invite Links ─────────────────────────────────────────────────────────────

// GET /api/social/invite
router.get('/social/invite', async (req, res) => {
  const userId = req.user!.id;
  let invite = await prisma.userInvite.findFirst({ where: { inviterId: userId, usedByUserId: null } });
  if (!invite) {
    invite = await prisma.userInvite.create({ data: { inviterId: userId } });
  }
  const link = `${process.env.FRONTEND_URL || 'https://axiomtraining.io'}/register?ref=${invite.code}`;
  res.json({ code: invite.code, link });
});

export default router;
