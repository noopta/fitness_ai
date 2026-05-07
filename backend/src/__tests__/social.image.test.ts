/**
 * Regression test for the lazy-load post image endpoint.
 * Feed responses strip imageBase64 to keep payloads small; clients re-fetch
 * the image via GET /api/social/posts/:id/image. This test pins that contract.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const sharedItemMock = { findUnique: vi.fn() };

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.sharedItem = sharedItemMock;
    this.friendship = { findFirst: vi.fn(), findMany: vi.fn() };
    this.institutionMember = { findMany: vi.fn() };
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
  });

  it('returns the imageBase64 when the post has an image', async () => {
    sharedItemMock.findUnique.mockResolvedValue({
      payload: JSON.stringify({ text: 'hi', imageBase64: 'AAAA' }),
    });
    const res = await request(app).get('/api/social/posts/post_1/image');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageBase64: 'AAAA' });
  });

  it('also handles payload stored as an object (not stringified)', async () => {
    sharedItemMock.findUnique.mockResolvedValue({
      payload: { imageBase64: 'BBBB' },
    });
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
    sharedItemMock.findUnique.mockResolvedValue({
      payload: JSON.stringify({ text: 'no image here' }),
    });
    const res = await request(app).get('/api/social/posts/post_3/image');
    expect(res.status).toBe(404);
  });
});
