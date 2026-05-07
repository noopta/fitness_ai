/**
 * Pins the contract that avatar data flows through to clients on:
 *   - GET /api/social/profile/:userId            (profile pages)
 *   - GET /api/social/conversations/:id/messages (DM threads, sender avatars)
 *
 * Without these selects, clients fall back to initials and users perceive
 * avatar images as "broken" across profile/chat surfaces.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const userMock = { findUnique: vi.fn() };
const friendshipMock = { findFirst: vi.fn(), findMany: vi.fn() };
const directConversationMock = { findUnique: vi.fn() };
const messageMock = { findMany: vi.fn() };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = userMock;
    this.friendship = friendshipMock;
    this.directConversation = directConversationMock;
    this.message = messageMock;
    this.sharedItem = { findUnique: vi.fn() };
    this.institutionMember = { findMany: vi.fn() };
    this.postReaction = { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() };
    this.postComment = { findMany: vi.fn(), create: vi.fn() };
    this.feedItem = { findMany: vi.fn() };
    this.userFeedView = { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn() };
  });
  return { PrismaClient };
});

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'viewer_1', email: 'v@example.com', tier: 'free' };
    next();
  },
}));

vi.mock('../services/notificationService.js', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
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

describe('GET /api/social/profile/:userId', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('selects avatarBase64 so the profile page can render the user image', async () => {
    userMock.findUnique.mockResolvedValueOnce({
      id: 'target_1',
      name: 'Alex',
      email: 'a@example.com',
      username: 'alex',
      avatarBase64: 'AVATAR_DATA',
      tier: 'free',
      createdAt: new Date('2026-01-01'),
    });
    friendshipMock.findFirst.mockResolvedValueOnce(null);
    friendshipMock.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/social/profile/target_1');
    expect(res.status).toBe(200);
    expect(res.body.user.avatarBase64).toBe('AVATAR_DATA');
    expect(res.body.user.username).toBe('alex');

    const selectArg = userMock.findUnique.mock.calls[0][0].select;
    expect(selectArg.avatarBase64).toBe(true);
  });
});

describe('GET /api/social/conversations/:id/messages', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  it('includes sender.avatarBase64 so chat can render avatars', async () => {
    directConversationMock.findUnique.mockResolvedValueOnce({
      id: 'convo_1',
      participantAId: 'viewer_1',
      participantBId: 'other_1',
    });
    messageMock.findMany.mockResolvedValueOnce([
      {
        id: 'm1',
        conversationId: 'convo_1',
        senderId: 'other_1',
        body: 'hi',
        readAt: null,
        createdAt: new Date(),
        sender: { id: 'other_1', name: 'Pat', username: 'pat', avatarBase64: 'AVATAR_PAT' },
      },
    ]);

    const res = await request(app).get('/api/social/conversations/convo_1/messages');
    expect(res.status).toBe(200);
    expect(res.body[0].sender.avatarBase64).toBe('AVATAR_PAT');

    const includeArg = messageMock.findMany.mock.calls[0][0].include;
    expect(includeArg.sender.select.avatarBase64).toBe(true);
    expect(includeArg.sender.select.username).toBe(true);
  });
});
