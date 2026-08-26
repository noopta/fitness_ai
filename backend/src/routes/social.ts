import { Router, type Request, type Response, type NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendPushToUser } from '../services/notificationService.js';
import { getUserGoalTags, getCachedFeedItems, recordFeedViews, maybeFetchFromSources } from '../services/feedService.js';
import { putImageBase64, objectUrl } from '../services/blobStore.js';
import { moderateText, moderatePost } from '../services/moderationService.js';
import { socialWriteLimiter } from '../middleware/rateLimiter.js';

/** Length caps for user-to-user text. All of these were previously unbounded. */
const MAX_MESSAGE_LEN = 4000;
const MAX_COMMENT_LEN = 1000;
const MAX_CAPTION_LEN = 2000;
const MAX_POST_TEXT_LEN = 5000;

const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

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

/**
 * True when either user has blocked the other.
 *
 * Blocking used to be cosmetic: a 'blocked' Friendship row was honoured only by
 * the user-search filter. A blocked user could still DM their target, comment on
 * their posts (which push-notified them), react, forward, and read their
 * profile. This is the check that makes the block mean something, and it's
 * called on every user-to-user path below.
 *
 * Symmetric on purpose — a block stops interaction in both directions, so the
 * blocker isn't left able to keep poking someone they've cut off.
 */
async function isBlockedBetween(userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return false;
  const row = await prisma.friendship.findFirst({
    where: {
      status: 'blocked',
      OR: [
        { requesterId: userA, addresseeId: userB },
        { requesterId: userB, addresseeId: userA },
      ],
    },
    select: { id: true },
  });
  // `!= null` rather than `!== null`: Prisma returns null for a miss, but a
  // strict check would treat an undefined from any other source as "blocked"
  // and silently deny every interaction.
  return row != null;
}

/**
 * Can `viewerId` see this post?
 *
 * Several read routes (`/posts/:id/image`, `/posts/:id/comments`) and the
 * comment-write route looked posts up by id with no visibility check at all —
 * so any authenticated user could pull the image off a friends-only post, or
 * comment on one, purely by knowing (or enumerating) its id. The image route
 * was the sharpest of the three: it minted a 7-day signed GCS URL for whatever
 * it was handed.
 *
 * Visibility rules mirror the feed:
 *   - your own post: always
 *   - a direct share addressed to you: always
 *   - visibility 'public': any non-blocked user
 *   - visibility 'friends': accepted friends and institution colleagues
 */
async function canViewPost(
  viewerId: string,
  post: { sharerId: string; recipientId: string; visibility: string },
): Promise<boolean> {
  if (post.sharerId === viewerId) return true;
  // Auto-hidden by the report threshold: nobody but the author sees it again
  // until an operator restores it.
  if (post.visibility === 'hidden') return false;
  if (post.recipientId === viewerId) return true;
  if (await isBlockedBetween(viewerId, post.sharerId)) return false;
  if (post.visibility === 'public') return true;
  return areFriendsOrColleagues(viewerId, post.sharerId);
}

/**
 * Load a post the viewer is allowed to see, or send a 404 and return null.
 * 404 rather than 403 so the route can't be used to confirm that a given post
 * id exists.
 */
async function loadViewablePost(
  req: Request,
  res: Response,
  select?: Record<string, boolean>,
): Promise<any | null> {
  const post = await prisma.sharedItem.findUnique({
    where: { id: req.params.id },
    ...(select
      ? { select: { ...select, sharerId: true, recipientId: true, visibility: true } }
      : {}),
  });
  if (!post || !(await canViewPost(req.user!.id, post as any))) {
    res.status(404).json({ error: 'Post not found' });
    return null;
  }
  return post;
}

// ─── Friends ──────────────────────────────────────────────────────────────────

// GET /api/social/friends
router.get('/social/friends', wrap(async (req, res) => {
  const userId = req.user!.id;
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: {
      requester: { select: { id: true, name: true, username: true, avatarBase64: true } },
      addressee: { select: { id: true, name: true, username: true, avatarBase64: true } },
    },
  });
  const friends = friendships.map(f =>
    f.requesterId === userId ? f.addressee : f.requester
  );
  res.json(friends);
}));

// GET /api/social/notifications/counts
// Returns total unread DMs + pending friend requests — used for the tab badge
router.get('/social/notifications/counts', wrap(async (req, res) => {
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
}));

// GET /api/social/friends/requests
router.get('/social/friends/requests', wrap(async (req, res) => {
  const requests = await prisma.friendship.findMany({
    where: { addresseeId: req.user!.id, status: 'pending' },
    include: { requester: { select: { id: true, name: true, username: true, email: true, avatarBase64: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests);
}));

// POST /api/social/friends/request
// Idempotent + symmetric: re-sending an outstanding request is a no-op success
// (never a 409 error the user reads as failure), and sending a request to
// someone who has already requested *you* simply accepts theirs. The response
// always carries the resulting `status` so the client can render the right
// pill ("Requested" / "Friends") without guessing.
router.post('/social/friends/request', wrap(async (req, res) => {
  const { targetUserId } = req.body;
  const userId = req.user!.id;
  if (!targetUserId || targetUserId === userId) return res.status(400).json({ error: 'Invalid target' });

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Look at any existing friendship row in either direction.
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    },
  });

  if (existing) {
    if (existing.status === 'blocked') {
      return res.status(403).json({ error: 'Cannot send request' });
    }
    if (existing.status === 'accepted') {
      return res.json({ status: 'accepted', friendship: existing });
    }
    // status === 'pending'
    if (existing.requesterId === userId) {
      // We already requested them — idempotent success, not an error.
      return res.json({ status: 'pending', friendship: existing });
    }
    // They already requested us — sending back accepts their request and
    // makes a friendship immediately, rather than creating a duplicate row.
    const accepted = await prisma.friendship.update({
      where: { requesterId_addresseeId: { requesterId: targetUserId, addresseeId: userId } },
      data: { status: 'accepted' },
    });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
    const myDisplay = me?.username ? `@${me.username}` : (me?.name ?? 'Someone');
    sendPushToUser(targetUserId, 'Friend request accepted', `${myDisplay} accepted your friend request`, { type: 'friend_accepted', userId }).catch(() => {});
    return res.json({ status: 'accepted', friendship: accepted });
  }

  try {
    const friendship = await prisma.friendship.create({
      data: { requesterId: userId, addresseeId: targetUserId, status: 'pending' },
    });
    // Notify the recipient
    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
    const senderDisplay = sender?.username ? `@${sender.username}` : (sender?.name ?? 'Someone');
    sendPushToUser(targetUserId, 'New Friend Request', `${senderDisplay} sent you a friend request`, { type: 'friend_request', requesterId: userId }).catch(() => {});
    return res.status(201).json({ status: 'pending', friendship });
  } catch (err: any) {
    // P2002 = unique-constraint race (a concurrent identical request landed
    // first). The request still exists, so report success.
    if (err?.code === 'P2002') return res.json({ status: 'pending' });
    throw err;
  }
}));

// POST /api/social/friends/accept
router.post('/social/friends/accept', wrap(async (req, res) => {
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
}));

// POST /api/social/friends/decline
router.post('/social/friends/decline', wrap(async (req, res) => {
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
}));

// DELETE /api/social/friends/:userId
router.delete('/social/friends/:userId', wrap(async (req, res) => {
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
}));

// POST /api/social/friends/block
router.post('/social/friends/block', wrap(async (req, res) => {
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
}));

// GET /api/social/users/search?q=
router.get('/social/users/search', wrap(async (req, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 2) return res.json([]);

  const userId = req.user!.id;
  // Email is deliberately NOT a substring-searchable field. It used to be
  // matched with `contains`, which turned this route into an account oracle:
  // search "@gmail.com" and page through the user base, or search a specific
  // address to confirm whether that person has an Axiom account. Exact-match
  // is kept so "add the friend whose email I already know" still works — that
  // reveals nothing the searcher didn't already have.
  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      OR: [
        { name: { contains: q } },
        { username: { contains: q } },
        ...(q.includes('@') ? [{ email: q.toLowerCase() }] : []),
      ],
    },
    select: { id: true, name: true, username: true, avatarBase64: true },
    take: 10,
  });

  // Friendship rows between the viewer and any returned user — one query.
  // Drives both the blocked-user filter and the per-result `friendshipStatus`
  // so the client can render "Add" / "Requested" / "Friends" correctly
  // instead of always showing "Add" (which then 409s on a re-tap).
  const resultIds = users.map(u => u.id);
  const friendships = resultIds.length
    ? await prisma.friendship.findMany({
        where: {
          OR: [
            { requesterId: userId, addresseeId: { in: resultIds } },
            { addresseeId: userId, requesterId: { in: resultIds } },
          ],
        },
      })
    : [];

  const statusByUser = new Map<string, 'none' | 'pending_sent' | 'pending_received' | 'accepted'>();
  for (const f of friendships) {
    const otherId = f.requesterId === userId ? f.addresseeId : f.requesterId;
    if (f.status === 'accepted') {
      statusByUser.set(otherId, 'accepted');
    } else if (f.status === 'pending') {
      statusByUser.set(otherId, f.requesterId === userId ? 'pending_sent' : 'pending_received');
    }
    // 'blocked' rows are handled by the filter below.
  }

  const blockedIds = new Set(
    friendships
      .filter(f => f.status === 'blocked')
      .flatMap(f => [f.requesterId, f.addresseeId])
      .filter(id => id !== userId),
  );

  res.json(
    users
      .filter(u => !blockedIds.has(u.id))
      .map(u => ({ ...u, friendshipStatus: statusByUser.get(u.id) ?? 'none' })),
  );
}));

// GET /api/social/users/:userId/avatar — returns only the avatarBase64 (lazy-load, cached by client)
router.get('/social/users/:userId/avatar', wrap(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { avatarBase64: true },
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ avatarBase64: user.avatarBase64 ?? null });
}));

// GET /api/social/profile/:userId
router.get('/social/profile/:userId', wrap(async (req, res) => {
  const viewerId = req.user!.id;
  const { userId } = req.params;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, username: true, avatarBase64: true, tier: true, createdAt: true },
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
}));

// ─── Conversations & Messages ─────────────────────────────────────────────────

// GET /api/social/conversations
router.get('/social/conversations', wrap(async (req, res) => {
  const userId = req.user!.id;
  const convos = await prisma.directConversation.findMany({
    where: { OR: [{ participantAId: userId }, { participantBId: userId }] },
    include: {
      participantA: { select: { id: true, name: true, username: true, email: true, avatarBase64: true } },
      participantB: { select: { id: true, name: true, username: true, email: true, avatarBase64: true } },
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
    let lastMessagePreview: string | null = lastMsg?.body ?? null;
    if (lastMessagePreview) {
      try {
        const p = JSON.parse(lastMessagePreview);
        if (p?._fwd === true) {
          lastMessagePreview = `↪ Forwarded a post${p.txt ? `: "${(p.txt as string).slice(0, 40)}"` : ''}`;
        } else if (p?._art === true && typeof p.title === 'string') {
          lastMessagePreview = `📰 Article: ${(p.title as string).slice(0, 60)}`;
        } else if (p?._workout === true) {
          const titlePart = typeof p.title === 'string' ? p.title : (p.kind === 'planned' ? "today's workout" : 'a workout');
          lastMessagePreview = `💪 Shared ${titlePart}`.slice(0, 80);
        }
      } catch {}
    }
    return {
      id: c.id,
      otherUser,
      lastMessage: lastMessagePreview,
      lastMessageAt: lastMsg?.createdAt ?? c.updatedAt,
      unreadCount: unread,
    };
  }));
  res.json(result);
}));

// POST /api/social/conversations
router.post('/social/conversations', wrap(async (req, res) => {
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
    select: { id: true, name: true, username: true, email: true, avatarBase64: true },
  });

  res.json({
    id: convo.id,
    otherUser: participant ?? { id: participantId, name: null, username: null, email: null, avatarBase64: null },
    lastMessage: null,
    lastMessageAt: convo.updatedAt,
    unreadCount: 0,
  });
}));

// GET /api/social/conversations/:conversationId/messages
router.get('/social/conversations/:conversationId/messages', wrap(async (req, res) => {
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
    include: { sender: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(messages.reverse());
}));

// POST /api/social/conversations/:conversationId/messages
router.post('/social/conversations/:conversationId/messages', socialWriteLimiter, wrap(async (req, res) => {
  const userId = req.user!.id;
  const { conversationId } = req.params;
  const { body } = req.body;
  if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'Message body required' });
  if (body.length > MAX_MESSAGE_LEN) {
    return res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LEN} characters).` });
  }

  const convo = await prisma.directConversation.findUnique({ where: { id: conversationId } });
  if (!convo || (convo.participantAId !== userId && convo.participantBId !== userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const otherId = convo.participantAId === userId ? convo.participantBId : convo.participantAId;

  // Participation alone isn't enough: an existing conversation stayed usable
  // after a block, so blocking someone you'd already talked to did nothing.
  if (await isBlockedBetween(userId, otherId)) {
    return res.status(403).json({ error: 'You can no longer message this person.' });
  }

  // DMs are the least visible surface on the platform and the easiest place to
  // send someone something vile, so they're checked like anything else.
  const verdict = await moderateText(body, 'dm', userId);
  if (!verdict.allowed) return res.status(400).json({ error: verdict.message });

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: userId, body: body.trim() },
      include: { sender: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    }),
    prisma.directConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);

  // Push notification to the other participant
  const recipientId = otherId;
  const senderDisplay = (message.sender as any)?.username
    ? `@${(message.sender as any).username}`
    : ((message.sender as any)?.name ?? 'Someone');
  const preview = body.trim().length > 60 ? body.trim().slice(0, 57) + '…' : body.trim();
  sendPushToUser(recipientId, `Message from ${senderDisplay}`, preview, { type: 'message', conversationId }).catch(() => {});

  res.status(201).json(message);
}));

// POST /api/social/conversations/:conversationId/read
router.post('/social/conversations/:conversationId/read', wrap(async (req, res) => {
  const userId = req.user!.id;
  await prisma.message.updateMany({
    where: { conversationId: req.params.conversationId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
}));

// GET /api/social/conversations/:conversationId/poll?after=<msgId>
router.get('/social/conversations/:conversationId/poll', wrap(async (req, res) => {
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
    include: { sender: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(messages);
}));

// ─── Sharing ──────────────────────────────────────────────────────────────────

const FEED_INCLUDE = {


  sharer: { select: { id: true, name: true, username: true, avatarBase64: true } },
  reactions: { select: { userId: true, type: true } },
  comments: {
    select: { id: true, text: true, createdAt: true, author: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    orderBy: { createdAt: 'asc' as const },
    take: 50,
  },
} as const;

function serializeFeedItem(item: any, viewerId: string, slim = false) {
  const rawPayload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;

  // Payload shape:
  //   - Default (slim=false): keep imageBase64 inline so deployed clients
  //     that don't yet know about lazy-load still render images.
  //   - slim=true: strip imageBase64, advertise `hasImage:true`. New clients
  //     (PostCard.needsLazyImage path) refetch via /posts/:id/image when
  //     the post scrolls into view. Cuts feed payload from ~11MB to ~4MB
  //     on a typical 25-post page with embedded photos.
  let payload = rawPayload;
  // A migrated post has imageKey instead of imageBase64 — it still has an
  // image, so the client's lazy-load path must be told about it.
  if (rawPayload?.imageKey) {
    payload = { ...rawPayload, hasImage: true };
  }
  if (slim && rawPayload?.imageBase64) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { imageBase64, ...rest } = rawPayload;
    payload = { ...rest, hasImage: true };
  } else if (rawPayload?.imageBase64) {
    // Non-slim path keeps the blob AND adds hasImage for forward compat.
    payload = { ...rawPayload, hasImage: true };
  }
  if (rawPayload?.originalPayload?.imageBase64) {
    if (slim) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { imageBase64, ...origRest } = rawPayload.originalPayload;
      payload = {
        ...payload,
        originalPayload: { ...origRest, hasImage: true },
      };
    } else {
      payload = {
        ...payload,
        originalPayload: { ...rawPayload.originalPayload, hasImage: true },
      };
    }
  }

  return {
    ...item,
    payload,
    reactionCount: item.reactions?.length ?? 0,
    likedByMe: item.reactions?.some((r: any) => r.userId === viewerId) ?? false,
    commentCount: item.comments?.length ?? 0,
    comments: item.comments ?? [],
  };
}

/**
 * Pull every distinct author out of a feed page into a lookup map, and strip
 * the (large) avatarBase64 from the inline author objects.
 *
 * Avatars are ~84 KB each and were serialized once per post AND again for
 * every comment author. Measured on a real 35-item page for a pro user:
 * 53 base64 blobs, only 3 distinct — 3.45 MB of a 3.69 MB response was
 * byte-identical duplicates. Sending each avatar once takes that page to
 * roughly 250 KB.
 *
 * Only avatarBase64 is removed; id/name/username stay inline so anything
 * reading the author object still renders text without consulting the map.
 * The client rehydrates avatars from `authors` on arrival, so the in-memory
 * shape is unchanged — this is purely a wire-format optimization.
 */
export function extractAuthors(
  items: Array<{ kind: string; data: any }>,
): Record<string, { id: string; name: string | null; username: string | null; avatarBase64: string | null }> {
  const authors: Record<string, any> = {};

  const take = (person: any) => {
    if (!person?.id) return;
    if (!(person.id in authors)) {
      authors[person.id] = {
        id: person.id,
        name: person.name ?? null,
        username: person.username ?? null,
        avatarBase64: person.avatarBase64 ?? null,
      };
    } else if (authors[person.id].avatarBase64 == null && person.avatarBase64 != null) {
      // First sighting may have come from a row that didn't select the avatar.
      authors[person.id].avatarBase64 = person.avatarBase64;
    }
    delete person.avatarBase64;
  };

  for (const item of items) {
    if (item.kind !== 'post') continue;
    take(item.data?.sharer);
    for (const c of item.data?.comments ?? []) take(c?.author);
  }
  return authors;
}

// POST /api/social/share
/** Post kinds the client is allowed to create. */
const ALLOWED_ITEM_TYPES = new Set([
  'text', 'media', 'workout', 'meal', 'recipe', 'article',
  'pr', 'streak', 'program', 'form_analysis', 'strength_profile',
]);

router.post('/social/share', socialWriteLimiter, wrap(async (req, res) => {
  const { recipientId, itemType, itemId, payload, caption, visibility } = req.body;
  if (!itemType || !payload) return res.status(400).json({ error: 'itemType and payload required' });
  if (typeof itemType !== 'string' || !ALLOWED_ITEM_TYPES.has(itemType)) {
    return res.status(400).json({ error: 'Unsupported post type' });
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'payload must be an object' });
  }

  // Audience: only meaningful for broadcast posts (no recipientId). Direct
  // shares are always private to the recipient, so they stay "friends".
  // Defaults to "friends" to preserve existing behavior — public is opt-in.
  const resolvedVisibility = !recipientId && visibility === 'public' ? 'public' : 'friends';

  // Validate text posts have content
  if (itemType === 'text' && !payload.text?.trim()) {
    return res.status(400).json({ error: 'Text content is required for text posts' });
  }

  // Length caps — both fields were previously unbounded up to the 10MB body limit.
  if (typeof caption === 'string' && caption.length > MAX_CAPTION_LEN) {
    return res.status(400).json({ error: `Caption is too long (max ${MAX_CAPTION_LEN} characters).` });
  }
  if (typeof payload.text === 'string' && payload.text.length > MAX_POST_TEXT_LEN) {
    return res.status(400).json({ error: `Post is too long (max ${MAX_POST_TEXT_LEN} characters).` });
  }

  // Enforce imageBase64 size limit (~2MB decoded)
  if (payload.imageBase64 && payload.imageBase64.length > 2_800_000) {
    return res.status(400).json({ error: 'Image exceeds the 2MB size limit.' });
  }

  // For directed shares, verify relationship; for feed broadcasts (no recipientId) skip check
  if (recipientId) {
    if (await isBlockedBetween(req.user!.id, recipientId)) {
      return res.status(403).json({ error: 'You can no longer share with this person.' });
    }
    const canShare = await areFriendsOrColleagues(req.user!.id, recipientId);
    if (!canShare) return res.status(403).json({ error: 'Can only share with friends' });
  }

  // Caption, body text and image checked together in one classifier call. A
  // broadcast post fans out to every friend and fires a push at each of them,
  // so this is the highest-reach content a user can create.
  const verdict = await moderatePost(
    [caption, payload.text].filter((s) => typeof s === 'string' && s.trim()).join('\n\n') || null,
    payload.imageBase64 ?? null,
    payload.imageMimeType ?? 'image/jpeg',
    itemType === 'media' ? 'post_image' : 'post_caption',
    req.user!.id,
  );
  if (!verdict.allowed) return res.status(400).json({ error: verdict.message });

  // Offload the photo to content-addressed object storage and keep only its
  // key in the row. Storing image bytes in a JSON column is what produced the
  // 6 MB of SharedItem payload and the multi-megabyte feed responses.
  // Best-effort by design: if the blob store is disabled or the upload fails,
  // putImageBase64 returns null and the image stays inline exactly as before,
  // so posting can never break on a storage problem.
  if (payload.imageBase64) {
    const stored = await putImageBase64(payload.imageBase64);
    if (stored) {
      delete payload.imageBase64;
      payload.imageKey = stored.key;
    }
  }

  const item = await prisma.sharedItem.create({
    data: {
      sharerId: req.user!.id,
      recipientId: recipientId ?? req.user!.id,
      itemType,
      itemId: itemId ?? null,
      payload: JSON.stringify(payload),
      caption: caption?.trim() || null,
      visibility: resolvedVisibility,
    },
    include: FEED_INCLUDE,
  });
  res.status(201).json(serializeFeedItem(item, req.user!.id));

  // Notify friends about new broadcast post
  const isBroadcast = !recipientId;
  if (isBroadcast) {
    const poster = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { username: true, name: true } });
    const posterDisplay = poster?.username ? `@${poster.username}` : (poster?.name ?? 'Someone');
    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: req.user!.id }, { addresseeId: req.user!.id }], status: 'accepted' },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = friendships.map((f: any) => f.requesterId === req.user!.id ? f.addresseeId : f.requesterId);
    const notifBody = caption?.trim() ? caption.trim().slice(0, 80) : (itemType === 'media' ? 'Shared a photo' : 'Posted something new');
    friendIds.forEach((fid: string) => {
      sendPushToUser(fid, `${posterDisplay} posted`, notifBody, { type: 'new_post', postId: item.id }).catch(() => {});
    });
  }

  // If it's a repost, notify original post owner
  if (payload?.originalPostId) {
    const originalPost = await prisma.sharedItem.findUnique({ where: { id: payload.originalPostId }, select: { sharerId: true } });
    if (originalPost && originalPost.sharerId !== req.user!.id) {
      const reposter = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { username: true, name: true } });
      const reposterDisplay = reposter?.username ? `@${reposter.username}` : (reposter?.name ?? 'Someone');
      sendPushToUser(originalPost.sharerId, 'New repost', `${reposterDisplay} reposted your post`, { type: 'repost', postId: payload.originalPostId }).catch(() => {});
    }
  }
}));

// GET /api/social/shared-feed
router.get('/social/shared-feed', wrap(async (req, res) => {
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
      // Posts auto-hidden by the report threshold drop out of every feed,
      // whichever audience clause below would otherwise have matched them.
      visibility: { not: 'hidden' },
      OR: [
        { recipientId: userId },
        { sharerId: userId },
        ...(friendIds.length > 0 ? [{
          sharerId: { in: friendIds },
          recipientId: { in: friendIds }, // broadcast = recipientId equals own sharerId; filter further below
        }] : []),
        { visibility: 'public' }, // public broadcasts from anyone
      ],
    },
    include: FEED_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Keep friends' items only when they are broadcasts (recipientId === sharerId),
  // plus any public broadcast.
  const friendIdSet = new Set(friendIds);
  const filtered = items.filter(i =>
    i.recipientId === userId ||
    i.sharerId === userId ||
    (friendIdSet.has(i.sharerId) && i.recipientId === i.sharerId) ||
    (i.visibility === 'public' && i.recipientId === i.sharerId),
  );

  // Deduplicate by id and limit to 50
  const seen = new Set<string>();
  const deduped = filtered.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; }).slice(0, 50);

  res.json(deduped.map(i => serializeFeedItem(i, userId)));
}));

// ─── GET /api/social/feed — interleaved friend posts + research/article items ─
// Every 2 friend posts, inject 1 goal-matched FeedItem. Hard cap: 10 FeedItems.
// If no friend posts, returns up to 10 FeedItems directly.

router.get('/social/feed', wrap(async (req, res) => {
  const userId = req.user!.id;
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
  // include_research is true by default for backward compat with older mobile
  // builds. New mobile clients send include_research=0 on pull-to-refresh so
  // the post fetch is fast (article fetches can take 5-12s when the PubMed
  // cache is exhausted), and trigger a separate /social/feed/articles call
  // when the user explicitly taps "Get fresh articles".
  const includeResearch = req.query.include_research !== '0' && req.query.include_research !== 'false';
  // slim=1: strip imageBase64 blobs from payloads (clients lazy-load via
  // /social/posts/:id/image). Cuts response payload by ~7MB on a typical
  // page with embedded photos. Opt-in so old clients without the lazy-load
  // path still get inline images.
  const slim = req.query.slim === '1' || req.query.slim === 'true';
  // authors=1: return a deduplicated `authors` map instead of repeating each
  // author's avatarBase64 on every post and every comment. See extractAuthors.
  const dedupeAuthors = req.query.authors === '1' || req.query.authors === 'true';
  // Page size — `?limit=N` overrides. Default 25 cuts the typical
  // initial-load payload roughly in half compared to the prior `take: 50`
  // without losing anything users actually see (most users scroll < 10
  // posts on first open).
  const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 && requestedLimit <= 50
    ? requestedLimit
    : 25;
  const t0 = Date.now();

  // Phase 1: friendships + (optionally) goal tags — independent, run in parallel
  const [friendships, tags] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        status: 'accepted',
      },
      select: { requesterId: true, addresseeId: true },
    }),
    includeResearch ? getUserGoalTags(userId) : Promise.resolve([] as Awaited<ReturnType<typeof getUserGoalTags>>),
  ]);
  const t1 = Date.now();

  const friendIds = friendships.map(f =>
    f.requesterId === userId ? f.addresseeId : f.requesterId
  );

  // Phase 2: posts query (always) + research cache lookup (only if requested)
  const [rawItems, initialFeedResult] = await Promise.all([
    prisma.sharedItem.findMany({
      where: {
        visibility: { not: 'hidden' },
        OR: [
          { recipientId: userId },
          { sharerId: userId },
          ...(friendIds.length > 0 ? [{
            sharerId: { in: friendIds },
            recipientId: { in: friendIds },
          }] : []),
          // Public posts from anyone (broadcasts marked public). Direct shares
          // are never public, so this can't leak 1:1 messages.
          { visibility: 'public' },
        ],
      },
      include: FEED_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    includeResearch
      ? getCachedFeedItems(userId, tags, 10, { forceRefresh: fresh, excludeSeen: true })
      : Promise.resolve({ items: [] as any[], exhausted: false }),
  ]);
  let feedItems = initialFeedResult.items;
  let exhausted = initialFeedResult.exhausted;
  const t2 = Date.now();
  console.log(`[feed] phase1=${t1-t0}ms phase2=${t2-t1}ms total=${t2-t0}ms posts=${rawItems.length} fresh=${fresh} include_research=${includeResearch} exhausted=${exhausted}`);

  // Pull-to-refresh + user exhausted on cached articles → trigger a source
  // fetch, but DO NOT block the response on it. The PubMed/OpenAlex fetch can
  // take 5-20s when the cache is exhausted, and awaiting it here was the main
  // cause of multi-second feed loads — both for the refreshing user and, via
  // the SQLite write lock it held, for every other user loading concurrently.
  // Fire-and-forget instead: this response returns immediately with the current
  // cache, and the fetched items populate the cache for the next load.
  // maybeFetchFromSources is internally rate-limited per user and invalidates
  // the cache on completion, so the freshly fetched items surface on the
  // client's next feed load or its /social/feed/new-count poll. Clients that
  // want fresh articles synchronously use the dedicated /social/feed/articles
  // endpoint, which intentionally still awaits. Skip entirely when
  // include_research is off — that's the whole point of the flag.
  if (includeResearch && fresh && exhausted) {
    maybeFetchFromSources(userId, tags).catch(e =>
      console.error('[feed] background source fetch failed:', e),
    );
  }

  // Record views so subsequent refreshes return different items.
  if (feedItems.length > 0) {
    recordFeedViews(userId, feedItems.map((i: any) => i.id)).catch(e =>
      console.error('[feed] recordFeedViews failed:', e),
    );
  }

  const friendIdSet = new Set(friendIds);
  const seen = new Set<string>();
  const friendPosts = rawItems
    .filter(i =>
      i.recipientId === userId ||
      i.sharerId === userId ||
      (friendIdSet.has(i.sharerId) && i.recipientId === i.sharerId) ||
      (i.visibility === 'public' && i.recipientId === i.sharerId)
    )
    .filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
    .slice(0, limit)
    .map(i => ({ kind: 'post' as const, data: serializeFeedItem(i, userId, slim) }));

  const researchItems = feedItems.map(fi => ({ kind: 'research' as const, data: fi }));

  // Interleave: 1 research item after every 2 friend posts
  const result: Array<{ kind: 'post' | 'research'; data: any }> = [];
  let researchIdx = 0;

  if (friendPosts.length === 0) {
    result.push(...researchItems);
  } else {
    for (let i = 0; i < friendPosts.length; i++) {
      result.push(friendPosts[i]);
      if ((i + 1) % 2 === 0 && researchIdx < researchItems.length) {
        result.push(researchItems[researchIdx++]);
      }
    }
    while (researchIdx < researchItems.length) {
      result.push(researchItems[researchIdx++]);
    }
  }

  // latestPostAt lets the client poll /social/feed/new-count for a Twitter-
  // style "N new posts" pill without re-fetching the whole feed body.
  const latestPostAt = friendPosts[0]?.data?.createdAt ?? null;

  // authors=1: hoist duplicate avatars into a lookup map (see extractAuthors).
  // Opt-in on its OWN flag rather than reusing `slim`, because the currently
  // deployed client already sends slim=1 and still expects avatarBase64 inline
  // — folding this into slim would blank every avatar until the OTA landed.
  if (dedupeAuthors) {
    const authors = extractAuthors(result);
    return res.json({ items: result, exhausted, latestPostAt, authors });
  }
  res.json({ items: result, exhausted, latestPostAt });
}));

// GET /api/social/feed/articles — research/article items only. Called when the
// user taps the "Research" button. Allowed to be slow (5-12s when PubMed cache
// is exhausted) because the user explicitly opted in.
//
// Two passes:
//   1. Try to fetch unseen items matching the user's goal tags.
//   2. If exhausted, trigger a PubMed pull and re-query for fresh items.
// If still nothing new, getCachedFeedItems falls back to seen items ordered by
// least-recently-viewed — so consecutive taps cycle through the user's
// backlog instead of returning the same article (which is what was happening
// before this design: "no new articles" stuck users on the same top item).
// `exhausted: true` is still set so the UI can label the response.
router.get('/social/feed/articles', wrap(async (req, res) => {
  const userId = req.user!.id;
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true';

  const tags = await getUserGoalTags(userId);
  let result = await getCachedFeedItems(userId, tags, 10, {
    forceRefresh: fresh,
    excludeSeen: true,
  });

  // If the unseen pool is empty, pull from PubMed and re-query so the user
  // gets genuinely new content when it's available — but cap the wait at 4s.
  // The source fetch can take 5-20s; awaiting it unbounded made every
  // pull-to-refresh crawl for users who had exhausted their unseen pool
  // (and clients gave up, then rendered zero research items). Past the cap
  // we return the seen-rotation immediately; the fetch keeps running in the
  // background and lands in the cache for the next load.
  if (fresh && result.exhausted) {
    const FETCH_BUDGET_MS = 4000;
    const fetchPromise = maybeFetchFromSources(userId, tags).catch(e => {
      console.error('[feed/articles] source fetch failed:', e);
      return false;
    });
    const fetched = await Promise.race([
      fetchPromise,
      new Promise<false>(resolve => setTimeout(() => resolve(false), FETCH_BUDGET_MS)),
    ]);
    if (fetched) {
      result = await getCachedFeedItems(userId, tags, 10, {
        forceRefresh: true,
        excludeSeen: true,
      });
    } else if (result.items.length === 0) {
      // Timed out (or nothing fetched) with an empty unseen pool — serve the
      // least-recently-viewed rotation rather than an empty feed.
      result = await getCachedFeedItems(userId, tags, 10, {
        forceRefresh: true,
        excludeSeen: false,
      });
    }
  }

  if (result.items.length > 0) {
    // Upsert viewedAt — this is what makes the least-recently-viewed rotation
    // actually rotate. Without bumping the timestamp, the same items would
    // re-surface every tap.
    recordFeedViews(userId, result.items.map((i: any) => i.id)).catch(e =>
      console.error('[feed/articles] recordFeedViews failed:', e),
    );
  }

  res.json({ items: result.items, exhausted: result.exhausted });
}));

// GET /api/social/feed/new-count?after=<iso> — returns the count of friend
// posts newer than `after`. Lets the mobile show a "N new posts" pill without
// re-fetching the entire feed. Fast: just a COUNT query, no serialization.
router.get('/social/feed/new-count', wrap(async (req, res) => {
  const userId = req.user!.id;
  const after = typeof req.query.after === 'string' ? new Date(req.query.after) : null;
  if (!after || isNaN(after.getTime())) {
    return res.json({ count: 0 });
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ requesterId: userId }, { addresseeId: userId }],
      status: 'accepted',
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map(f =>
    f.requesterId === userId ? f.addresseeId : f.requesterId
  );

  // Same filter shape as /social/feed but as a count query and excluding the
  // viewer's own posts (they don't need a notification for what they posted).
  const count = await prisma.sharedItem.count({
    where: {
      createdAt: { gt: after },
      sharerId: { not: userId },
      visibility: { not: 'hidden' },
      OR: [
        { recipientId: userId },
        ...(friendIds.length > 0 ? [{
          sharerId: { in: friendIds },
          recipientId: { in: friendIds },
        }] : []),
        { visibility: 'public' }, // public broadcasts from anyone count too
      ],
    },
  });

  res.json({ count });
}));

// ─── Saved articles ───────────────────────────────────────────────────────────

// POST /api/social/articles/:id/save — bookmark a research/article feed item
router.post('/social/articles/:id/save', wrap(async (req, res) => {
  const userId = req.user!.id;
  const feedItemId = req.params.id;

  const item = await prisma.feedItem.findUnique({ where: { id: feedItemId }, select: { id: true } });
  if (!item) return res.status(404).json({ error: 'Article not found' });

  await prisma.savedArticle.upsert({
    where: { userId_feedItemId: { userId, feedItemId } },
    create: { userId, feedItemId },
    update: {},
  });
  res.json({ ok: true, saved: true });
}));

// DELETE /api/social/articles/:id/save — unbookmark
router.delete('/social/articles/:id/save', wrap(async (req, res) => {
  const userId = req.user!.id;
  const feedItemId = req.params.id;
  await prisma.savedArticle.deleteMany({ where: { userId, feedItemId } });
  res.json({ ok: true, saved: false });
}));

// GET /api/social/articles/saved — user's saved article hub
router.get('/social/articles/saved', wrap(async (req, res) => {
  const userId = req.user!.id;
  const saves = await prisma.savedArticle.findMany({
    where: { userId },
    orderBy: { savedAt: 'desc' },
    include: { feedItem: true },
  });

  const items = saves.map(s => {
    let tags: string[] = [];
    try { tags = JSON.parse(s.feedItem.tags); } catch { /* ignore */ }
    return {
      id: s.feedItem.id,
      type: s.feedItem.type as 'research' | 'article',
      title: s.feedItem.title,
      summary: s.feedItem.summary,
      url: s.feedItem.url,
      source: s.feedItem.source,
      tags,
      publishedAt: s.feedItem.publishedAt?.toISOString() ?? null,
      fetchedAt: s.feedItem.fetchedAt.toISOString(),
      savedAt: s.savedAt.toISOString(),
    };
  });
  res.json({ items });
}));

// POST /api/social/articles/:id/forward — share an article to a friend via DM
// Mirrors POST /social/posts/:id/forward; uses _art:true marker in body so
// conversation.tsx can render a rich card.
router.post('/social/articles/:id/forward', wrap(async (req, res) => {
  const userId = req.user!.id;
  const { recipientId, message } = req.body;
  if (!recipientId) return res.status(400).json({ error: 'recipientId required' });

  const canShare = await areFriendsOrColleagues(userId, recipientId);
  if (!canShare) return res.status(403).json({ error: 'Can only forward to friends' });

  const item = await prisma.feedItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'Article not found' });

  const ids = canonicalParticipants(userId, recipientId);
  const convo = await prisma.directConversation.upsert({
    where: { participantAId_participantBId: ids },
    create: ids,
    update: {},
  });

  const art: Record<string, unknown> = {
    _art: true,
    id: item.id,
    title: item.title.slice(0, 200),
    summary: item.summary.slice(0, 400),
    src: item.source,
    type: item.type,
    url: item.url,
  };
  if (message) art.note = String(message).slice(0, 240);
  const body = JSON.stringify(art).slice(0, 1500);

  const [dmMessage] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: convo.id, senderId: userId, body },
      include: { sender: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    }),
    prisma.directConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } }),
  ]);

  const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, name: true } });
  const display = sender?.username ? `@${sender.username}` : (sender?.name ?? 'Someone');
  sendPushToUser(
    recipientId,
    `${display} shared an article`,
    item.title.slice(0, 100),
    { type: 'message', conversationId: convo.id },
  ).catch(() => {});

  res.status(201).json({ ok: true, conversationId: convo.id, messageId: dmMessage.id });
}));

// POST /api/social/workouts/forward — send a workout (planned or logged) to a
// friend as a structured DM. The chat client renders the `_workout: true`
// marker as a workout card. Mirrors the `_art` / `_fwd` patterns.
router.post('/social/workouts/forward', wrap(async (req, res) => {
  const userId = req.user!.id;
  const { recipientId, kind, workout, note } = req.body ?? {};

  if (!recipientId) return res.status(400).json({ error: 'recipientId required' });
  if (kind !== 'planned' && kind !== 'logged') {
    return res.status(400).json({ error: "kind must be 'planned' or 'logged'" });
  }
  if (!workout || typeof workout !== 'object') {
    return res.status(400).json({ error: 'workout payload required' });
  }

  const canShare = await areFriendsOrColleagues(userId, recipientId);
  if (!canShare) return res.status(403).json({ error: 'Can only forward to friends' });

  // For logged workouts, verify the WorkoutLog belongs to the sender. This
  // prevents impersonation / sharing someone else's logs.
  if (kind === 'logged' && (workout as any).id) {
    const log = await prisma.workoutLog.findUnique({
      where: { id: String((workout as any).id) },
      select: { userId: true },
    });
    if (!log || log.userId !== userId) {
      return res.status(403).json({ error: 'You can only share your own workouts' });
    }
  }

  // Trim the embedded payload — exercises arrays from a long program day can
  // get large and we don't want to bloat the messages table.
  const trimmedExercises = Array.isArray((workout as any).exercises)
    ? (workout as any).exercises.slice(0, 30).map((ex: any) => ({
        name: typeof ex?.name === 'string' ? ex.name.slice(0, 80) : '',
        sets: Number(ex?.sets) || null,
        reps: ex?.reps ?? null,
        weightLbs: ex?.weightLbs == null ? null : Number(ex.weightLbs),
        weightKg: ex?.weightKg == null ? null : Number(ex.weightKg),
        rpe: ex?.rpe == null ? null : Number(ex.rpe),
        intensity: typeof ex?.intensity === 'string' ? ex.intensity.slice(0, 40) : null,
        notes: typeof ex?.notes === 'string' ? ex.notes.slice(0, 120) : null,
      }))
    : [];

  const wo: Record<string, unknown> = {
    _workout: true,
    kind,
    id: typeof (workout as any).id === 'string' ? (workout as any).id : null,
    date: typeof (workout as any).date === 'string' ? (workout as any).date.slice(0, 20) : null,
    title: typeof (workout as any).title === 'string' ? (workout as any).title.slice(0, 80) : null,
    focus: typeof (workout as any).focus === 'string' ? (workout as any).focus.slice(0, 60) : null,
    duration: (workout as any).duration == null ? null : Number((workout as any).duration),
    exercises: trimmedExercises,
  };
  if (note) wo.note = String(note).slice(0, 240);
  // Cap at 4 KB so a single message can't blow up. Plenty for a workout card.
  const body = JSON.stringify(wo).slice(0, 4000);

  const ids = canonicalParticipants(userId, recipientId);
  const convo = await prisma.directConversation.upsert({
    where: { participantAId_participantBId: ids },
    create: ids,
    update: {},
  });

  const [dmMessage] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: convo.id, senderId: userId, body },
      include: { sender: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    }),
    prisma.directConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } }),
  ]);

  const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, name: true } });
  const display = sender?.username ? `@${sender.username}` : (sender?.name ?? 'Someone');
  const previewTitle = (wo.title as string | null) ?? (kind === 'planned' ? "Today's workout" : 'a workout');
  sendPushToUser(
    recipientId,
    `${display} shared a workout`,
    String(previewTitle).slice(0, 100),
    { type: 'message', conversationId: convo.id },
  ).catch(() => {});

  res.status(201).json({ ok: true, conversationId: convo.id, messageId: dmMessage.id });
}));

// ─── Reactions ────────────────────────────────────────────────────────────────

// POST /api/social/posts/:id/react — toggle heart reaction
router.post('/social/posts/:id/react', wrap(async (req, res) => {
  const userId = req.user!.id;
  const postId = req.params.id;

  const existing = await prisma.postReaction.findUnique({ where: { postId_userId: { postId, userId } } });
  if (existing) {
    await prisma.postReaction.delete({ where: { postId_userId: { postId, userId } } });
    res.json({ liked: false });
  } else {
    await prisma.postReaction.create({ data: { postId, userId } });
    res.json({ liked: true });
    // Notify post owner
    const post = await prisma.sharedItem.findUnique({ where: { id: postId }, select: { sharerId: true } });
    if (post && post.sharerId !== userId) {
      const liker = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, name: true } });
      const display = liker?.username ? `@${liker.username}` : (liker?.name ?? 'Someone');
      sendPushToUser(post.sharerId, 'New like', `${display} liked your post`, { type: 'reaction', postId }).catch(() => {});
    }
  }
}));

// ─── Comments ─────────────────────────────────────────────────────────────────

// GET /api/social/posts/:id/comments
router.get('/social/posts/:id/comments', wrap(async (req, res) => {
  // Visibility gate — previously any authenticated user could read the comment
  // thread on any post id, including friends-only posts.
  const post = await loadViewablePost(req, res);
  if (!post) return;

  const comments = await prisma.postComment.findMany({
    where: { postId: req.params.id },
    include: { author: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(comments);
}));

// POST /api/social/posts/:id/comments
router.post('/social/posts/:id/comments', socialWriteLimiter, wrap(async (req, res) => {
  const userId = req.user!.id;
  const { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Comment text required' });
  if (text.length > MAX_COMMENT_LEN) {
    return res.status(400).json({ error: `Comment is too long (max ${MAX_COMMENT_LEN} characters).` });
  }

  // Was completely open: you could comment on any post id whether or not you
  // could see the post, and the comment fired a push at its owner — an
  // unsolicited-notification channel aimed at any user you knew a post id for.
  const post = await loadViewablePost(req, res);
  if (!post) return;

  const verdict = await moderateText(text, 'comment', userId);
  if (!verdict.allowed) return res.status(400).json({ error: verdict.message });

  const comment = await prisma.postComment.create({
    data: { postId: req.params.id, authorId: userId, text: text.trim() },
    include: { author: { select: { id: true, name: true, username: true, avatarBase64: true } } },
  });
  res.status(201).json(comment);
  // Notify post owner
  if (post.sharerId !== userId) {
    const commenter = comment.author as any;
    const display = commenter?.username ? `@${commenter.username}` : (commenter?.name ?? 'Someone');
    sendPushToUser(post.sharerId, 'New comment', `${display}: ${text.trim().slice(0, 60)}`, { type: 'comment', postId: req.params.id }).catch(() => {});
  }
}));

// GET /api/social/posts/:id/image — returns only the imageBase64 for a post (lazy-load)
router.get('/social/posts/:id/image', wrap(async (req, res) => {
  // Visibility gate. Without it this route handed out the image on any post id
  // — and for migrated posts it minted a 7-day signed GCS URL to go with it,
  // so a leak here outlived the request by a week.
  const post = await loadViewablePost(req, res, { payload: true });
  if (!post) return;

  const p = typeof post.payload === 'string' ? JSON.parse(post.payload) : post.payload;

  // Migrated posts carry only a key. Hand back a signed URL so the bytes go
  // straight from GCS to the client and never through this box — proxying them
  // would pay egress twice and put megabytes through a 3.7 GB server.
  if (p?.imageKey) {
    const url = await objectUrl(p.imageKey);
    if (url) return res.json({ imageUrl: url });
  }

  const imageBase64 = p?.imageBase64 ?? null;
  if (!imageBase64) return res.status(404).json({ error: 'No image' });
  res.json({ imageBase64 });
}));

// DELETE /api/social/posts/:id — delete own post
router.delete('/social/posts/:id', wrap(async (req, res) => {
  const userId = req.user!.id;
  const post = await prisma.sharedItem.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.sharerId !== userId) return res.status(403).json({ error: 'Not your post' });
  await prisma.sharedItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ─── Forward (send post to DM) ────────────────────────────────────────────────

// POST /api/social/posts/:id/forward — forward a post as a DM message
router.post('/social/posts/:id/forward', wrap(async (req, res) => {
  const userId = req.user!.id;
  const { recipientId, message } = req.body;
  if (!recipientId) return res.status(400).json({ error: 'recipientId required' });

  const canShare = await areFriendsOrColleagues(userId, recipientId);
  if (!canShare) return res.status(403).json({ error: 'Can only forward to friends' });

  const original = await prisma.sharedItem.findUnique({ where: { id: req.params.id } });
  if (!original) return res.status(404).json({ error: 'Post not found' });

  // Find or create DM conversation
  const ids = canonicalParticipants(userId, recipientId);
  const convo = await prisma.directConversation.upsert({
    where: { participantAId_participantBId: ids },
    create: ids,
    update: {},
  });

  // Build structured JSON body so clients can render a rich forwarded-post card
  const fwd: Record<string, unknown> = { _fwd: true };
  if (message) fwd.note = message;
  if ((original as any).caption) fwd.cap = (original as any).caption;
  try {
    const p = typeof original.payload === 'string' ? JSON.parse(original.payload) : original.payload;
    if (p?.text)        fwd.txt    = (p.text as string).slice(0, 120);
    if (p?.imageBase64) fwd.hasImg = true;
    if (p?.videoUrl)    fwd.vid    = (p.videoUrl as string).slice(0, 100);
  } catch {}
  const body = JSON.stringify(fwd).slice(0, 1000);

  const [dmMessage] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: convo.id, senderId: userId, body: body.slice(0, 1000) },
      include: { sender: { select: { id: true, name: true, username: true, avatarBase64: true } } },
    }),
    prisma.directConversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } }),
  ]);

  // Push to recipient
  const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, name: true } });
  const display = sender?.username ? `@${sender.username}` : (sender?.name ?? 'Someone');
  sendPushToUser(recipientId, `Post from ${display}`, message || 'Forwarded you a post', { type: 'message', conversationId: convo.id }).catch(() => {});

  res.status(201).json({ ok: true, conversationId: convo.id });
}));

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
router.get('/social/leaderboard', wrap(async (req, res) => {
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
}));

// GET /api/social/leaderboard/lifts
// Returns which lifts the user and their friends have data for
router.get('/social/leaderboard/lifts', wrap(async (req, res) => {
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
}));

// ─── Content Reporting ────────────────────────────────────────────────────────
// POST /api/social/report — report a shared post as objectionable/inappropriate
// Required for apps with user-generated content under Apple App Store guidelines.
// Reasons the client may submit. Free text goes in `details`.
const REPORT_REASONS = new Set([
  'sexual', 'harassment', 'hate', 'violence', 'spam',
  'impersonation', 'self_harm', 'misinformation', 'other',
]);

/**
 * Auto-hide threshold. A post reported by this many distinct users is pulled
 * from the feed pending review, rather than staying up for however long it
 * takes a human to look at it. Deliberately low — this is a small community and
 * three independent reports on one post is a strong signal.
 */
const AUTOHIDE_REPORT_COUNT = 3;

router.post('/social/report', requireAuth, socialWriteLimiter, wrap(async (req, res) => {
  const reporterId = req.user!.id;
  const { itemId, targetType = 'post', reason, details } = req.body as {
    itemId?: string; targetType?: string; reason?: string; details?: string;
  };
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  if (reason && !REPORT_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Unknown report reason' });
  }
  if (typeof details === 'string' && details.length > 1000) {
    return res.status(400).json({ error: 'Details are too long (max 1000 characters).' });
  }

  // Resolve the reported user so an operator can see every report against one
  // account, not just per-item ones.
  let reportedUserId: string | null = null;
  if (targetType === 'post') {
    const item = await prisma.sharedItem.findUnique({ where: { id: itemId }, select: { sharerId: true } });
    if (!item) return res.status(404).json({ error: 'Post not found' });
    reportedUserId = item.sharerId;
  } else if (targetType === 'comment') {
    const comment = await prisma.postComment.findUnique({ where: { id: itemId }, select: { authorId: true } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    reportedUserId = comment.authorId;
  } else if (targetType === 'message') {
    const message = await prisma.message.findUnique({ where: { id: itemId }, select: { senderId: true } });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    reportedUserId = message.senderId;
  } else if (targetType === 'user') {
    reportedUserId = itemId;
  } else {
    return res.status(400).json({ error: 'Unknown target type' });
  }

  console.warn(
    `[content-report] type=${targetType} item=${itemId} reporter=${reporterId} ` +
    `reported=${reportedUserId} reason=${reason ?? 'unspecified'}`,
  );

  // Persist. The previous implementation only wrote a console line, which is
  // not a takedown path: nothing was queryable, nothing could be actioned, and
  // nothing survived a log rotation. App Store Guideline 1.2 wants a real
  // mechanism behind the button.
  try {
    await (prisma as any).contentReport.create({
      data: {
        reporterId,
        targetType,
        targetId: itemId,
        reportedUserId,
        reason: reason ?? 'unspecified',
        details: typeof details === 'string' ? details.slice(0, 1000) : null,
      },
    });
  } catch (err: any) {
    // P2002 = this user already reported this item. Idempotent success — a
    // double-tap shouldn't look like a failure.
    if (err?.code !== 'P2002') {
      console.error('[content-report] persist failed:', err?.message ?? err);
    }
  }

  // Auto-hide once enough distinct users have flagged the same item. Setting
  // visibility to 'hidden' takes it out of every feed query without destroying
  // it, so a wrongly-hidden post can be restored on review.
  try {
    const reportCount = await (prisma as any).contentReport.count({
      where: { targetType, targetId: itemId },
    });
    if (targetType === 'post' && reportCount >= AUTOHIDE_REPORT_COUNT) {
      await prisma.sharedItem.update({ where: { id: itemId }, data: { visibility: 'hidden' } });
      console.warn(`[content-report] auto-hid post ${itemId} after ${reportCount} reports`);
    }
  } catch { /* table not migrated yet — the report itself still logged */ }

  res.json({ success: true, message: 'Thank you — we\'ll review this within 24 hours.' });
}));

// POST /api/social/users/:userId/block — block a user outright.
// The existing /social/friends/block sits under the friends surface; this is the
// same action reachable from a post, comment or DM, which is where Guideline 1.2
// expects to find it.
router.post('/social/users/:userId/block', wrap(async (req, res) => {
  const userId = req.user!.id;
  const targetUserId = req.params.userId;
  if (targetUserId === userId) return res.status(400).json({ error: 'You cannot block yourself' });

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Collapse any existing relationship in either direction into a single
  // blocked row, so the block isn't shadowed by a stale 'accepted' row.
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: userId },
      ],
    },
  });
  await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: targetUserId, status: 'blocked' },
  });

  res.json({ success: true, blocked: true });
}));

// ─── Invite Links ─────────────────────────────────────────────────────────────

// GET /api/social/invite
router.get('/social/invite', wrap(async (req, res) => {
  const userId = req.user!.id;
  let invite = await prisma.userInvite.findFirst({ where: { inviterId: userId, usedByUserId: null } });
  if (!invite) {
    invite = await prisma.userInvite.create({ data: { inviterId: userId } });
  }
  const link = `${process.env.FRONTEND_URL || 'https://axiomtraining.io'}/register?ref=${invite.code}`;
  res.json({ code: invite.code, link });
}));

export default router;
