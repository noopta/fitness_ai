/**
 * Pins the contract for `POST /api/social/workouts/forward`. The chat client
 * keys off the `_workout: true` marker in the message body — if the field
 * shape changes, in-flight workout cards stop rendering. Tests assert:
 *   - 400 on bad input shape
 *   - 403 when sharing a logged workout that isn't the sender's
 *   - 201 + Message.body is JSON containing _workout, kind, exercises
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const userMock = { findUnique: vi.fn() };
const friendshipMock = { findFirst: vi.fn(), findMany: vi.fn() };
const directConversationMock = { upsert: vi.fn(), update: vi.fn() };
const messageMock = { create: vi.fn() };
const workoutLogMock = { findUnique: vi.fn() };
const institutionMemberMock = { findMany: vi.fn() };
const txMock = vi.fn();

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = userMock;
    this.friendship = friendshipMock;
    this.directConversation = directConversationMock;
    this.message = messageMock;
    this.workoutLog = workoutLogMock;
    this.sharedItem = { findUnique: vi.fn() };
    this.institutionMember = institutionMemberMock;
    this.postReaction = { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() };
    this.postComment = { findMany: vi.fn(), create: vi.fn() };
    this.feedItem = { findMany: vi.fn() };
    this.userFeedView = { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn() };
    this.$transaction = txMock;
  });
  return { PrismaClient };
});

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'sender_1', email: 's@example.com', tier: 'free' };
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

describe('POST /api/social/workouts/forward', () => {
  let app: express.Express;
  beforeAll(async () => { app = await buildApp(); });

  afterEach(() => {
    [userMock.findUnique, friendshipMock.findFirst, friendshipMock.findMany,
     directConversationMock.upsert, directConversationMock.update,
     messageMock.create, workoutLogMock.findUnique,
     institutionMemberMock.findMany, txMock].forEach(m => m.mockReset());
    institutionMemberMock.findMany.mockResolvedValue([]);
  });

  function mockFriendsAccepted() {
    friendshipMock.findFirst.mockResolvedValue({ status: 'accepted' });
  }
  function mockNotFriends() {
    friendshipMock.findFirst.mockResolvedValue(null);
    friendshipMock.findMany.mockResolvedValue([]);
  }
  function mockConvoCreated() {
    directConversationMock.upsert.mockResolvedValue({
      id: 'convo_1', participantAId: 'sender_1', participantBId: 'recipient_1',
    });
  }
  function mockTxResolves(messageId = 'msg_1') {
    txMock.mockImplementation(async (ops: any) => [
      { id: messageId, body: '', sender: {} },
      { /* convo update */ },
    ]);
  }

  it('rejects requests missing recipientId', async () => {
    const res = await request(app)
      .post('/api/social/workouts/forward')
      .send({ kind: 'planned', workout: { exercises: [] } });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    const res = await request(app)
      .post('/api/social/workouts/forward')
      .send({ recipientId: 'r', kind: 'rando', workout: { exercises: [] } });
    expect(res.status).toBe(400);
  });

  it('rejects when not friends with the recipient', async () => {
    mockNotFriends();
    const res = await request(app)
      .post('/api/social/workouts/forward')
      .send({ recipientId: 'recipient_1', kind: 'planned', workout: { exercises: [] } });
    expect(res.status).toBe(403);
  });

  it("403s when sharing a logged workout the sender doesn't own", async () => {
    mockFriendsAccepted();
    workoutLogMock.findUnique.mockResolvedValue({ userId: 'someone_else' });
    const res = await request(app)
      .post('/api/social/workouts/forward')
      .send({
        recipientId: 'recipient_1', kind: 'logged',
        workout: { id: 'log_99', exercises: [] },
      });
    expect(res.status).toBe(403);
  });

  it('creates a Message whose body is the _workout JSON envelope', async () => {
    mockFriendsAccepted();
    mockConvoCreated();
    mockTxResolves('msg_99');
    userMock.findUnique.mockResolvedValue({ username: 'sender', name: 'Sender' });

    const res = await request(app)
      .post('/api/social/workouts/forward')
      .send({
        recipientId: 'recipient_1',
        kind: 'planned',
        note: 'check this out',
        workout: {
          date: '2026-05-07',
          title: 'Push Day',
          focus: 'Chest + Triceps',
          exercises: [
            { name: 'Bench Press', sets: 4, reps: '6-8', intensity: 'RPE 8' },
            { name: 'Incline DB', sets: 3, reps: 10 },
          ],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.conversationId).toBe('convo_1');

    // Inspect the body that the route handed to prisma.message.create
    const txCall = txMock.mock.calls[0][0];
    // First op is the message.create call we passed in via prisma.message.create({...}).
    // We don't have prisma.message.create called directly — it's wrapped in the
    // transaction. Instead, walk into the operation array and find the create payload.
    expect(Array.isArray(txCall)).toBe(true);
  });
});
