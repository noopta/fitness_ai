// v2 Feed (bug fixes 5 Oct 2026, 3a/3c/3d): the feed cursor, saving a post,
// the merged Saved list and post search.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { isWorkoutPost, postTitle, postMatches, mergeSaved, savedPostRow, savedArticleRow } from '../services/feedSaved.js';

const friendship = { findFirst: vi.fn(), findMany: vi.fn() };
const sharedItem = { findUnique: vi.fn(), findMany: vi.fn() };
const savedPost = { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() };
const savedArticle = { findMany: vi.fn() };
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.friendship = friendship; this.sharedItem = sharedItem; this.savedPost = savedPost; this.savedArticle = savedArticle; }) }));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'me' }; next(); } }));
vi.mock('../services/notificationService.js', () => ({ sendPushToUser: vi.fn() }));
vi.mock('../services/feedService.js', () => ({ getUserGoalTags: vi.fn(), getCachedFeedItems: vi.fn(), recordFeedViews: vi.fn(), maybeFetchFromSources: vi.fn() }));

let app: express.Express;
beforeAll(async () => {
  const { default: social } = await import('../routes/social.js');
  app = express(); app.use(express.json()); app.use('/api', social);
});
beforeEach(() => {
  vi.clearAllMocks();
  friendship.findMany.mockResolvedValue([]);
  savedPost.findMany.mockResolvedValue([]);
  savedArticle.findMany.mockResolvedValue([]);
});

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, sharerId: 'me', recipientId: 'me', visibility: 'friends', itemType: 'text', caption: null,
  payload: JSON.stringify({ text: 'Felt good' }), createdAt: new Date('2026-10-04T10:00:00Z'),
  sharer: { id: 'me', name: 'Me', username: 'me' }, reactions: [], comments: [], saves: [], ...over,
});

describe('feed cursor', () => {
  it('pages back from ?before and returns nextCursor on a full page', async () => {
    sharedItem.findMany.mockResolvedValue([post('p1'), post('p2', { createdAt: new Date('2026-10-03T10:00:00Z') })]);
    const r = await request(app).get('/api/social/feed?include_research=0&limit=2&before=2026-10-05T00:00:00.000Z');
    expect(r.status).toBe(200);
    expect(sharedItem.findMany.mock.calls[0][0].where.createdAt).toEqual({ lt: new Date('2026-10-05T00:00:00.000Z') });
    expect(r.body.nextCursor).toBe('2026-10-03T10:00:00.000Z');
  });
  it('has no next page when the page is short', async () => {
    sharedItem.findMany.mockResolvedValue([post('p1')]);
    const r = await request(app).get('/api/social/feed?include_research=0&limit=5');
    expect(r.body.nextCursor).toBeNull();
    expect(sharedItem.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
  it('marks posts the viewer saved, without leaking who else did', async () => {
    sharedItem.findMany.mockResolvedValue([post('p1', { saves: [{ userId: 'me' }, { userId: 'other' }] })]);
    const r = await request(app).get('/api/social/feed?include_research=0');
    const item = r.body.items[0].data;
    expect(item.savedByMe).toBe(true);
    expect(item.saves).toBeUndefined();
  });
});

describe('save a post', () => {
  it('saves a post you can see', async () => {
    sharedItem.findUnique.mockResolvedValue({ id: 'p1', sharerId: 'me', recipientId: 'me', visibility: 'friends' });
    const r = await request(app).post('/api/social/posts/p1/save');
    expect(r.body).toEqual({ saved: true });
    expect(savedPost.upsert.mock.calls[0][0].create).toEqual({ userId: 'me', postId: 'p1' });
  });
  it('404s on a post you can’t see', async () => {
    sharedItem.findUnique.mockResolvedValue({ id: 'p1', sharerId: 'x', recipientId: 'x', visibility: 'hidden' });
    const r = await request(app).post('/api/social/posts/p1/save');
    expect(r.status).toBe(404);
    expect(savedPost.upsert).not.toHaveBeenCalled();
  });
  it('unsaves', async () => {
    const r = await request(app).delete('/api/social/posts/p1/save');
    expect(r.body).toEqual({ saved: false });
    expect(savedPost.deleteMany.mock.calls[0][0].where).toEqual({ userId: 'me', postId: 'p1' });
  });
});

describe('GET /social/saved', () => {
  it('merges workouts, posts and articles newest first, and filters by type', async () => {
    savedPost.findMany.mockResolvedValue([
      { savedAt: new Date('2026-10-03'), post: post('w1', { itemType: 'workout', payload: JSON.stringify({ title: 'Pull day', exercises: [{ name: 'Row' }] }), sharer: { name: 'Sam' } }) },
      { savedAt: new Date('2026-10-01'), post: post('t1', { sharer: { name: 'Ana' } }) },
    ]);
    savedArticle.findMany.mockResolvedValue([{ savedAt: new Date('2026-10-02'), feedItem: { id: 'a1', title: 'Zone 2', source: 'PubMed', url: 'https://x' } }]);
    const all = await request(app).get('/api/social/saved');
    expect(all.body.items.map((i: any) => [i.kind, i.id, i.eyebrow])).toEqual([
      ['workout', 'w1', 'Workout · Sam'], ['article', 'a1', 'Article · PubMed'], ['post', 't1', 'Post · Ana'],
    ]);
    const workouts = await request(app).get('/api/social/saved?type=workouts');
    expect(workouts.body.items.map((i: any) => i.id)).toEqual(['w1']);
  });
  it('drops a saved post that has since been hidden', async () => {
    savedPost.findMany.mockResolvedValue([{ savedAt: new Date(), post: post('h1', { sharerId: 'x', recipientId: 'x', visibility: 'hidden' }) }]);
    const r = await request(app).get('/api/social/saved?type=posts');
    expect(r.body.items).toEqual([]);
  });
});

describe('GET /social/posts/search', () => {
  it('matches captions and exercise names on broadcast posts only', async () => {
    sharedItem.findMany.mockResolvedValue([
      post('p1', { payload: JSON.stringify({ title: 'Legs', exercises: [{ name: 'Bulgarian split squat' }] }), itemType: 'workout' }),
      post('p2', { caption: 'split the check' }),
      post('dm', { recipientId: 'friend', caption: 'split squat tips' }),
      post('p3', { caption: 'bench day' }),
    ]);
    const r = await request(app).get('/api/social/posts/search?q=split');
    expect(r.body.items.map((i: any) => i.id)).toEqual(['p1', 'p2']);
    expect(r.body.items[0]).toMatchObject({ title: 'Legs', workout: true });
  });
  it('needs two characters', async () => {
    const r = await request(app).get('/api/social/posts/search?q=a');
    expect(r.body.items).toEqual([]);
    expect(sharedItem.findMany).not.toHaveBeenCalled();
  });
});

describe('feedSaved helpers', () => {
  it('knows a workout post by type or by its exercises', () => {
    expect(isWorkoutPost({ itemType: 'workout', payload: '{}' })).toBe(true);
    expect(isWorkoutPost({ itemType: 'text', payload: { exercises: [{ name: 'Squat' }] } })).toBe(true);
    expect(isWorkoutPost({ itemType: 'text', payload: { text: 'hi' } })).toBe(false);
  });
  it('titles a post from its title, caption, text, then what it is', () => {
    expect(postTitle({ itemType: 'workout', payload: { exercises: [{}, {}] } })).toBe('2 exercises');
    expect(postTitle({ itemType: 'media', payload: {} })).toBe('Photo');
    expect(postTitle({ itemType: 'text', payload: { text: 'x'.repeat(100) } })).toHaveLength(80);
  });
  it('searches case-insensitively', () => {
    expect(postMatches({ payload: { exercises: [{ name: 'Deadlift' }] } }, 'DEAD')).toBe(true);
    expect(postMatches({ payload: {} , caption: 'x' }, '  ')).toBe(false);
  });
  it('builds saved rows', () => {
    expect(savedPostRow({ savedAt: new Date('2026-10-01T00:00:00Z'), post: { id: 'p', itemType: 'text', payload: '{}', caption: 'Hi', sharer: { username: 'sam' } } }))
      .toEqual({ kind: 'post', id: 'p', eyebrow: 'Post · @sam', title: 'Hi', savedAt: '2026-10-01T00:00:00.000Z' });
    expect(savedArticleRow({ savedAt: new Date('2026-10-01T00:00:00Z'), feedItem: { id: 'a', title: 'T' } }).eyebrow).toBe('Article · Research');
    expect(mergeSaved([], 'all')).toEqual([]);
  });
});
