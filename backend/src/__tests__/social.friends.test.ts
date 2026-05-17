/**
 * Pins the friend-request contract. The mobile "Find Friends" screen relies
 * on two behaviours fixed here:
 *   - POST /api/social/friends/request is idempotent (re-sending an
 *     outstanding request is a 200 success, never a 409 error the user
 *     reads as "it failed"), and a request back to someone who already
 *     requested you auto-accepts theirs.
 *   - GET /api/social/users/search returns a per-result `friendshipStatus`
 *     so the client can render Add / Requested / Friends instead of always
 *     showing "Add".
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const userMock = { findUnique: vi.fn(), findMany: vi.fn() };
const friendshipMock = {
  findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
  create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), count: vi.fn(),
};

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = userMock;
    this.friendship = friendshipMock;
    this.directConversation = { upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() };
    this.message = { create: vi.fn(), count: vi.fn() };
    this.workoutLog = { findUnique: vi.fn() };
    this.sharedItem = { findUnique: vi.fn(), findMany: vi.fn() };
    this.institutionMember = { findMany: vi.fn() };
    this.postReaction = { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() };
    this.postComment = { findMany: vi.fn(), create: vi.fn() };
    this.feedItem = { findMany: vi.fn() };
    this.userFeedView = { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn() };
    this.$transaction = vi.fn();
  });
  return { PrismaClient };
});

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'me', email: 'me@example.com', tier: 'free' };
    next();
  },
}));

const sendPushToUser = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/notificationService.js', () => ({
  sendPushToUser: (...args: any[]) => sendPushToUser(...args),
}));

vi.mock('../services/feedService.js', () => ({
  getUserGoalTags: vi.fn(),
  getCachedFeedItems: vi.fn(),
  recordFeedViews: vi.fn(),
  maybeFetchFromSources: vi.fn(),
}));

async function buildApp() {
  const { default: socialRoutes } = await import('../routes/social.js');
  const app = express();
  app.use(express.json());
  app.use('/api', socialRoutes);
  return app;
}

describe('POST /api/social/friends/request', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  afterEach(() => {
    [userMock.findUnique, userMock.findMany, friendshipMock.findFirst,
     friendshipMock.findMany, friendshipMock.create, friendshipMock.update,
     sendPushToUser].forEach(m => m.mockReset());
    sendPushToUser.mockResolvedValue(undefined);
  });

  /** target lookup resolves to a real user; sender lookup gives a display name. */
  function mockUserLookups() {
    userMock.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'me'
        ? { name: 'Me', username: 'me' }
        : { id: where.id }));
  }

  it('400s on a missing target', async () => {
    const res = await request(app).post('/api/social/friends/request').send({});
    expect(res.status).toBe(400);
  });

  it('400s when targeting yourself', async () => {
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'me' });
    expect(res.status).toBe(400);
  });

  it('404s when the target user does not exist', async () => {
    userMock.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'ghost' });
    expect(res.status).toBe(404);
  });

  it('403s when a block exists between the two users', async () => {
    mockUserLookups();
    friendshipMock.findFirst.mockResolvedValue({
      status: 'blocked', requesterId: 'target', addresseeId: 'me',
    });
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'target' });
    expect(res.status).toBe(403);
  });

  it('is idempotent — re-sending an outstanding request is a 200, not a 409', async () => {
    mockUserLookups();
    friendshipMock.findFirst.mockResolvedValue({
      status: 'pending', requesterId: 'me', addresseeId: 'target',
    });
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'target' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(friendshipMock.create).not.toHaveBeenCalled();
  });

  it('auto-accepts when the target had already requested you', async () => {
    mockUserLookups();
    friendshipMock.findFirst.mockResolvedValue({
      status: 'pending', requesterId: 'target', addresseeId: 'me',
    });
    friendshipMock.update.mockResolvedValue({ status: 'accepted' });
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'target' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(friendshipMock.update).toHaveBeenCalledOnce();
    expect(friendshipMock.create).not.toHaveBeenCalled();
  });

  it('reports accepted when the two are already friends', async () => {
    mockUserLookups();
    friendshipMock.findFirst.mockResolvedValue({
      status: 'accepted', requesterId: 'me', addresseeId: 'target',
    });
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'target' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
  });

  it('201s and creates a pending row for a brand-new request', async () => {
    mockUserLookups();
    friendshipMock.findFirst.mockResolvedValue(null);
    friendshipMock.create.mockResolvedValue({
      requesterId: 'me', addresseeId: 'target', status: 'pending',
    });
    const res = await request(app)
      .post('/api/social/friends/request').send({ targetUserId: 'target' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(friendshipMock.create).toHaveBeenCalledOnce();
    expect(sendPushToUser).toHaveBeenCalledOnce();
  });
});

describe('GET /api/social/users/search', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  afterEach(() => {
    [userMock.findMany, friendshipMock.findMany].forEach(m => m.mockReset());
  });

  it('tags each result with its friendshipStatus and filters blocked users', async () => {
    userMock.findMany.mockResolvedValue([
      { id: 'u1', name: 'Jordan One', username: 'jone', avatarBase64: null },
      { id: 'u2', name: 'Jordan Two', username: 'jtwo', avatarBase64: null },
      { id: 'u3', name: 'Jordan Three', username: 'jthree', avatarBase64: null },
      { id: 'u4', name: 'Jordan Four', username: 'jfour', avatarBase64: null },
    ]);
    friendshipMock.findMany.mockResolvedValue([
      { requesterId: 'me', addresseeId: 'u1', status: 'pending' },   // we asked u1
      { requesterId: 'u2', addresseeId: 'me', status: 'pending' },   // u2 asked us
      { requesterId: 'me', addresseeId: 'u3', status: 'accepted' },  // already friends
      { requesterId: 'u4', addresseeId: 'me', status: 'blocked' },   // blocked → hidden
    ]);

    const res = await request(app).get('/api/social/users/search?q=jordan');
    expect(res.status).toBe(200);

    const byId = Object.fromEntries(res.body.map((u: any) => [u.id, u.friendshipStatus]));
    expect(byId).toEqual({
      u1: 'pending_sent',
      u2: 'pending_received',
      u3: 'accepted',
    });
    expect(res.body.find((u: any) => u.id === 'u4')).toBeUndefined();
  });

  it('defaults friendshipStatus to "none" for users with no relationship', async () => {
    userMock.findMany.mockResolvedValue([
      { id: 'stranger', name: 'A Stranger', username: 'strange', avatarBase64: null },
    ]);
    friendshipMock.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/social/users/search?q=stranger');
    expect(res.status).toBe(200);
    expect(res.body[0].friendshipStatus).toBe('none');
  });
});
