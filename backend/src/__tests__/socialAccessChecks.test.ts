// Access checks added with the agent-first tools: the activity calendar is
// yours or a friend's only, and only a conversation's participants can mark
// it read.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const friendship = { findFirst: vi.fn(), findMany: vi.fn() };
const activityLog = { findMany: vi.fn() };
const directConversation = { findUnique: vi.fn() };
const message = { updateMany: vi.fn() };
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.friendship = friendship; this.activityLog = activityLog; this.directConversation = directConversation; this.message = message; }) }));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'me' }; next(); } }));
vi.mock('../services/notificationService.js', () => ({ sendPushToUser: vi.fn() }));
vi.mock('../services/feedService.js', () => ({ getUserGoalTags: vi.fn(), getCachedFeedItems: vi.fn(), recordFeedViews: vi.fn(), maybeFetchFromSources: vi.fn() }));

let app: express.Express;
beforeAll(async () => {
  const { default: activity } = await import('../routes/activity.js');
  const { default: social } = await import('../routes/social.js');
  app = express(); app.use(express.json()); app.use('/api', activity); app.use('/api', social);
});
beforeEach(() => { vi.clearAllMocks(); activityLog.findMany.mockResolvedValue([]); message.updateMany.mockResolvedValue({ count: 0 }); });

describe('activity heatmap', () => {
  it('always returns your own', async () => {
    const r = await request(app).get('/api/activity/heatmap');
    expect(r.status).toBe(200);
    expect(activityLog.findMany.mock.calls[0][0].where.userId).toBe('me');
  });
  it('refuses a stranger’s calendar', async () => {
    friendship.findFirst.mockResolvedValue(null);
    const r = await request(app).get('/api/activity/heatmap?userId=stranger');
    expect(r.status).toBe(404);
    expect(activityLog.findMany).not.toHaveBeenCalled();
  });
  it('shows a friend’s calendar', async () => {
    friendship.findFirst.mockResolvedValue({ id: 'f1' });
    const r = await request(app).get('/api/activity/heatmap/detail?userId=friend');
    expect(r.status).toBe(200);
    expect(activityLog.findMany.mock.calls[0][0].where.userId).toBe('friend');
  });
});

describe('mark conversation read', () => {
  it('only a participant can', async () => {
    directConversation.findUnique.mockResolvedValue({ participantAId: 'a', participantBId: 'b' });
    const r = await request(app).post('/api/social/conversations/c1/read');
    expect(r.status).toBe(404);
    expect(message.updateMany).not.toHaveBeenCalled();
  });
  it('a participant can', async () => {
    directConversation.findUnique.mockResolvedValue({ participantAId: 'me', participantBId: 'b' });
    const r = await request(app).post('/api/social/conversations/c1/read');
    expect(r.status).toBe(200);
    expect(message.updateMany).toHaveBeenCalled();
  });
});
