/**
 * Regression test for the lazy-load post image endpoint.
 * Feed responses strip imageBase64 to keep payloads small; clients re-fetch
 * the image via GET /api/social/posts/:id/image. This test pins that contract.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const sharedItemMock = { findUnique: vi.fn() };
const friendshipMock = { findFirst: vi.fn(), findMany: vi.fn() };
const institutionMemberMock = { findMany: vi.fn() };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.sharedItem = sharedItemMock;
    this.friendship = friendshipMock;
    this.institutionMember = institutionMemberMock;
    this.user = { update: vi.fn(), findUnique: vi.fn() };
    this.postReaction = { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() };
    this.postComment = { findMany: vi.fn(), create: vi.fn() };
    this.feedItem = { findMany: vi.fn() };
    this.userFeedView = { findMany: vi.fn(), createMany: vi.fn(), create: vi.fn() };
  });
  return { PrismaClient };
});

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user_1', email: 't@example.com', tier: 'free' };
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

describe('GET /api/social/posts/:id/image', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterEach(() => {
    sharedItemMock.findUnique.mockReset();
    friendshipMock.findFirst.mockReset();
    friendshipMock.findMany.mockReset();
    institutionMemberMock.findMany.mockReset();
    // Default: no block row, no friendship, no shared institution.
    friendshipMock.findFirst.mockResolvedValue(null);
    friendshipMock.findMany.mockResolvedValue([]);
    institutionMemberMock.findMany.mockResolvedValue([]);
  });

  beforeEach(() => {
    friendshipMock.findFirst.mockResolvedValue(null);
    friendshipMock.findMany.mockResolvedValue([]);
    institutionMemberMock.findMany.mockResolvedValue([]);
  });

  // The authenticated viewer is user_1 (see the requireAuth mock above).
  // Posts now carry the ownership/audience fields the visibility gate reads.
  const ownPost = (payload: any) => ({
    sharerId: 'user_1', recipientId: 'user_1', visibility: 'friends', payload,
  });

  it('returns the imageBase64 when the post has an image', async () => {
    sharedItemMock.findUnique.mockResolvedValue(
      ownPost(JSON.stringify({ text: 'hi', imageBase64: 'AAAA' })),
    );
    const res = await request(app).get('/api/social/posts/post_1/image');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageBase64: 'AAAA' });
  });

  it('also handles payload stored as an object (not stringified)', async () => {
    sharedItemMock.findUnique.mockResolvedValue(ownPost({ imageBase64: 'BBBB' }));
    const res = await request(app).get('/api/social/posts/post_2/image');
    expect(res.status).toBe(200);
    expect(res.body.imageBase64).toBe('BBBB');
  });

  it('returns 404 when the post is missing', async () => {
    sharedItemMock.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/social/posts/missing/image');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the post has no image', async () => {
    sharedItemMock.findUnique.mockResolvedValue(
      ownPost(JSON.stringify({ text: 'no image here' })),
    );
    const res = await request(app).get('/api/social/posts/post_3/image');
    expect(res.status).toBe(404);
  });

  // ── Visibility gate (IDOR regression) ────────────────────────────────────
  //
  // This route used to look the post up by id and return its image with no
  // check at all, so any authenticated user could pull the photo off any
  // friends-only post by guessing or harvesting an id — and for GCS-backed
  // posts it also minted a 7-day signed URL, so the leak outlived the request.

  it("404s on a stranger's friends-only post", async () => {
    sharedItemMock.findUnique.mockResolvedValue({
      sharerId: 'stranger_9',
      recipientId: 'stranger_9',
      visibility: 'friends',
      payload: JSON.stringify({ imageBase64: 'SECRET' }),
    });
    friendshipMock.findFirst.mockResolvedValue(null); // not blocked
    friendshipMock.findMany.mockResolvedValue([]);    // and not friends
    institutionMemberMock.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/social/posts/post_x/image');
    // 404 rather than 403 so the route can't confirm the id exists.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it("serves a stranger's PUBLIC post", async () => {
    sharedItemMock.findUnique.mockResolvedValue({
      sharerId: 'stranger_9',
      recipientId: 'stranger_9',
      visibility: 'public',
      payload: JSON.stringify({ imageBase64: 'PUBLIC' }),
    });
    friendshipMock.findFirst.mockResolvedValue(null); // not blocked

    const res = await request(app).get('/api/social/posts/post_pub/image');
    expect(res.status).toBe(200);
    expect(res.body.imageBase64).toBe('PUBLIC');
  });

  it('404s on a post auto-hidden by the report threshold', async () => {
    sharedItemMock.findUnique.mockResolvedValue({
      sharerId: 'stranger_9',
      recipientId: 'stranger_9',
      visibility: 'hidden',
      payload: JSON.stringify({ imageBase64: 'REPORTED' }),
    });
    const res = await request(app).get('/api/social/posts/post_hidden/image');
    expect(res.status).toBe(404);
  });

  it("404s on a public post from someone who blocked the viewer", async () => {
    sharedItemMock.findUnique.mockResolvedValue({
      sharerId: 'blocker_1',
      recipientId: 'blocker_1',
      visibility: 'public',
      payload: JSON.stringify({ imageBase64: 'BLOCKED' }),
    });
    friendshipMock.findFirst.mockResolvedValue({ id: 'block_row' }); // blocked
    const res = await request(app).get('/api/social/posts/post_blk/image');
    expect(res.status).toBe(404);
  });
});
