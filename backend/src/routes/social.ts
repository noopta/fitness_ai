import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendPushToUser } from '../services/notificationService.js';

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
      requester: { select: { id: true, name: true, username: true } },
      addressee: { select: { id: true, name: true, username: true } },
    },
  });
  const friends = friendships.map(f =>
    f.requesterId === userId ? f.addressee : f.requester
  );
  res.json(friends);
});

// GET /api/social/notifications/counts
// Returns total unread DMs + pending friend requests — used for the tab badge
router.get('/social/notifications/counts', async (req, res) => {
  const userId = req.user!.id;
  const [pendingRequests, convos] = await Promise.all([
    prisma.friendship.count({ where: { addresseeId: userId, status: 'pending' } }),
    prisma.directConversation.findMany({
      where: { OR: [{ participantAId: userId }, { participantBId: userId }] },
      select: { id: true },
    }),
  ]);
  const unreadMessages = convos.length > 0
    ? await prisma.message.count({
        where: {
          conversationId: { in: convos.map(c => c.id) },
          senderId: { not: userId },
          readAt: null,
        },
      })
    : 0;
  res.json({ pendingRequests, unreadMessages, total: pendingRequests + unreadMessages });
});

// GET /api/social/friends/requests
router.get('/social/friends/requests', async (req, res) => {
  const requests = await prisma.friendship.findMany({
    where: { addresseeId: req.user!.id, status: 'pending' },
    include: { requester: { select: { id: true, name: true, username: true } } },
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
    // Notify the recipient
    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
    const senderDisplay = sender?.username ? `@${sender.username}` : (sender?.name ?? 'Someone');
    sendPushToUser(targetUserId, 'New Friend Request', `${senderDisplay} sent you a friend request`, { type: 'friend_request', requesterId: userId }).catch(() => {});
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
        { username: { contains: q } },
      ],
    },
    select: { id: true, name: true, username: true, avatarBase64: true },
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

// GET /api/social/profile/:userId
router.get('/social/profile/:userId', async (req, res) => {
  const viewerId = req.user!.id;
  const { userId } = req.params;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, tier: true, createdAt: true },
  });
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Friendship status between viewer and target
  const friendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: userId },
        { requesterId: userId, addresseeId: viewerId },
      ],
    },
  });

  let friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'blocked' = 'none';
  if (friendship) {
    if (friendship.status === 'accepted') {
      friendshipStatus = 'accepted';
    } else if (friendship.status === 'blocked') {
      friendshipStatus = 'blocked';
    } else if (friendship.status === 'pending') {
      friendshipStatus = friendship.requesterId === viewerId ? 'pending_sent' : 'pending_received';
    }
  }

  const isFriend = friendshipStatus === 'accepted';

  // Mutual friends count: intersection of viewer's friends and target's friends
  const [viewerFriendships, targetFriendships] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    }),
  ]);

  const viewerFriendIds = new Set(
    viewerFriendships.map(f => f.requesterId === viewerId ? f.addresseeId : f.requesterId)
  );
  const targetFriendIds = new Set(
    targetFriendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId)
  );
  let mutualFriendsCount = 0;
  viewerFriendIds.forEach(id => { if (targetFriendIds.has(id)) mutualFriendsCount++; });

  res.json({ user: targetUser, isFriend, friendshipStatus, mutualFriendsCount });
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
    const otherUser = c.participantAId === userId ? c.participantB : c.participantA;
    const unread = await prisma.message.count({
      where: { conversationId: c.id, senderId: { not: userId }, readAt: null },
    });
    const lastMsg = c.messages[0] ?? null;
    return {
      id: c.id,
      otherUser,
      lastMessage: lastMsg?.body ?? null,
      lastMessageAt: lastMsg?.createdAt ?? c.updatedAt,
      unreadCount: unread,
    };
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

  const participant = await prisma.user.findUnique({
    where: { id: participantId },
    select: { id: true, name: true, email: true },
  });

  res.json({
    id: convo.id,
    otherUser: participant ?? { id: participantId, name: null, email: null },
    lastMessage: null,
    lastMessageAt: convo.updatedAt,
    unreadCount: 0,
  });
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
      include: { sender: { select: { id: true, name: true, username: true } } },
    }),
    prisma.directConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);

  // Push notification to the other participant
  const recipientId = convo.participantAId === userId ? convo.participantBId : convo.participantAId;
  const senderDisplay = (message.sender as any)?.username
    ? `@${(message.sender as any).username}`
    : ((message.sender as any)?.name ?? 'Someone');
  const preview = body.trim().length > 60 ? body.trim().slice(0, 57) + '…' : body.trim();
  sendPushToUser(recipientId, `Message from ${senderDisplay}`, preview, { type: 'message', conversationId }).catch(() => {});

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
    include: { sharer: { select: { id: true, name: true, username: true, avatarBase64: true } } },
  });
  res.status(201).json({ ...item, payload: JSON.parse(item.payload) });
});

// GET /api/social/shared-feed
router.get('/social/shared-feed', async (req, res) => {
  const userId = req.user!.id;

  // Get accepted friend IDs
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ requesterId: userId }, { addresseeId: userId }],
      status: 'accepted',
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId);

  // Fetch: posts to/from me + friends' broadcast posts (recipientId = sharerId)
  const items = await prisma.sharedItem.findMany({
    where: {
      OR: [
        { recipientId: userId },
        { sharerId: userId },
        ...(friendIds.length > 0 ? [{
          sharerId: { in: friendIds },
          recipientId: { in: friendIds }, // broadcast = recipientId equals own sharerId; filter further below
        }] : []),
      ],
    },
    include: { sharer: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Keep friends' items only when they are broadcasts (recipientId === sharerId)
  const friendIdSet = new Set(friendIds);
  const filtered = items.filter(i =>
    i.recipientId === userId ||
    i.sharerId === userId ||
    (friendIdSet.has(i.sharerId) && i.recipientId === i.sharerId),
  );

  // Deduplicate by id and limit to 50
  const seen = new Set<string>();
  const deduped = filtered.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; }).slice(0, 50);

  res.json(deduped.map(i => ({ ...i, payload: JSON.parse(i.payload) })));
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────

const LEADERBOARD_LIFTS = [
  'flat_bench_press', 'deadlift', 'barbell_back_squat', 'barbell_front_squat',
  'incline_bench_press', 'power_clean', 'hang_clean', 'clean_and_jerk', 'snatch',
];

// Epley e1RM: weight * (1 + reps/30), clamped to 1-10 reps
function epley(weight: number, reps: number): number {
  const r = Math.min(Math.max(Math.round(reps), 1), 10);
  return Math.round(weight * (1 + r / 30));
}

// GET /api/social/leaderboard?lift=flat_bench_press
// Returns viewer + accepted friends ranked by estimated 1RM for the specified lift
router.get('/social/leaderboard', async (req, res) => {
  const userId = req.user!.id;
  const lift = (req.query.lift as string) || 'flat_bench_press';

  // Get accepted friend IDs (include self for the full board)
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: 'accepted' },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId);
  const participantIds = [userId, ...friendIds];

  // Fetch all sessions for the lift by all participants, with snapshots
  const sessions = await prisma.session.findMany({
    where: { userId: { in: participantIds }, selectedLift: lift },
    select: {
      userId: true,
      snapshots: { select: { weight: true, repsSchema: true } },
    },
  });

  // Compute best e1RM per user
  const bestE1RM: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.userId) continue;
    for (const snap of s.snapshots) {
      const reps = parseInt(snap.repsSchema, 10);
      if (isNaN(reps) || snap.weight <= 0) continue;
      const e1rm = epley(snap.weight, reps);
      if (!bestE1RM[s.userId] || e1rm > bestE1RM[s.userId]) {
        bestE1RM[s.userId] = e1rm;
      }
    }
  }

  // Fetch user display info for all participants who have data
  const usersWithData = Object.keys(bestE1RM);
  if (usersWithData.length === 0) return res.json({ lift, entries: [] });

  const users = await prisma.user.findMany({
    where: { id: { in: usersWithData } },
    select: { id: true, name: true, username: true, avatarBase64: true },
  });

  const entries = users
    .map(u => ({
      userId: u.id,
      name: u.name,
      username: u.username,
      avatarBase64: u.avatarBase64,
      e1RM: bestE1RM[u.id] ?? 0,
      isYou: u.id === userId,
    }))
    .sort((a, b) => b.e1RM - a.e1RM)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));

  res.json({ lift, entries });
});

// GET /api/social/leaderboard/lifts
// Returns which lifts the user and their friends have data for
router.get('/social/leaderboard/lifts', async (req, res) => {
  const userId = req.user!.id;
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: 'accepted' },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map(f => f.requesterId === userId ? f.addresseeId : f.requesterId);
  const participantIds = [userId, ...friendIds];

  const sessions = await prisma.session.findMany({
    where: { userId: { in: participantIds }, selectedLift: { in: LEADERBOARD_LIFTS } },
    select: { selectedLift: true },
    distinct: ['selectedLift'],
  });
  const lifts = sessions.map(s => s.selectedLift);
  res.json({ lifts });
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
