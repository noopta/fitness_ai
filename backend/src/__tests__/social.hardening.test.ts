/**
 * Oct 2026 audit — social surface hardening:
 *   - POST /social/share validates each post type's payload, strips
 *     server-owned image keys, caps the payload at 64 KB and builds reposts
 *     from the original server-side (attribution + visibility).
 *   - Blocks hide content both ways (feed counts, profiles).
 *   - Reports need a viewable target, ack unknown ids identically, and
 *     auto-hide only on enough established reporters.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  friendship: { findFirst: vi.fn(), findMany: vi.fn() },
  sharedItem: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  contentReport: { create: vi.fn(), findMany: vi.fn() },
  institutionMember: { findMany: vi.fn() },
  postComment: { findMany: vi.fn(), findUnique: vi.fn() },
  message: { findUnique: vi.fn() },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) { Object.assign(this, m); }),
}));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'me', email: 'me@x.io', tier: 'free' }; next(); },
}));
const sendPushToUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../services/notificationService.js', () => ({ sendPushToUser }));
vi.mock('../services/feedService.js', () => ({
  getUserGoalTags: vi.fn(), getCachedFeedItems: vi.fn(), recordFeedViews: vi.fn(), maybeFetchFromSources: vi.fn(),
}));
vi.mock('../services/moderationService.js', () => ({
  moderateText: vi.fn(async () => ({ allowed: true })),
  moderatePost: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('../services/blobStore.js', async () => {
  const actual = await vi.importActual<any>('../services/blobStore.js');
  return { ...actual, putImageBase64: vi.fn(async () => null), objectUrl: vi.fn(async () => 'https://signed') };
});

const { parseSharePayload } = await import('../validation/sharePayload.js');
const { blockedIdsFor, shouldAutoHide } = await import('../routes/social.js');

let app: express.Express;
beforeAll(async () => {
  const { default: routes } = await import('../routes/social.js');
  app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', routes);
});

beforeEach(() => {
  for (const model of Object.values(m)) for (const fn of Object.values(model)) (fn as any).mockReset();
  sendPushToUser.mockReset().mockResolvedValue(undefined);
  m.friendship.findFirst.mockResolvedValue(null);
  m.friendship.findMany.mockResolvedValue([]);
  m.institutionMember.findMany.mockResolvedValue([]);
  m.user.findUnique.mockResolvedValue({ id: 'x', username: 'me', name: 'Me' });
  m.user.findMany.mockResolvedValue([]);
  m.sharedItem.create.mockImplementation(async ({ data }: any) => ({ id: 'new', ...data, reactions: [], comments: [], saves: [] }));
  m.contentReport.create.mockResolvedValue({});
  m.contentReport.findMany.mockResolvedValue([]);
  m.sharedItem.updateMany.mockResolvedValue({ count: 1 });
});

describe('parseSharePayload', () => {
  it('rejects unknown keys per post type', () => {
    const r = parseSharePayload('text', { text: 'hi', evil: 'x' });
    expect(r.ok).toBe(false);
  });
  it('allows only http(s) video URLs', () => {
    expect(parseSharePayload('media', { videoUrl: 'javascript:alert(1)' }).ok).toBe(false);
    expect(parseSharePayload('media', { videoUrl: 'data:text/html,hi' }).ok).toBe(false);
    expect(parseSharePayload('media', { videoUrl: 'https://cdn.example.com/v.mp4' }).ok).toBe(true);
  });
  it('strips server-owned image keys instead of trusting them', () => {
    const r: any = parseSharePayload('media', { text: 'x', imageKey: 'img/ab/ab.jpg', imageUrl: 'https://evil', imageKeySig: 'f'.repeat(32), hasImage: true });
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({ text: 'x' });
  });
  it('rejects a non-string imageBase64', () => {
    expect(parseSharePayload('media', { imageBase64: { a: 1 } }).ok).toBe(false);
  });
});

describe('POST /social/share', () => {
  it('never stores a client-supplied imageKey / imageUrl', async () => {
    const res = await request(app).post('/api/social/share').send({
      itemType: 'text', payload: { text: 'hello', imageKey: 'img/aa/' + 'a'.repeat(64) + '.jpg', imageUrl: 'https://evil' },
    });
    expect(res.status).toBe(201);
    const stored = JSON.parse(m.sharedItem.create.mock.calls[0][0].data.payload);
    expect(stored).toEqual({ text: 'hello' });
  });

  it('400s unknown payload keys', async () => {
    const res = await request(app).post('/api/social/share').send({ itemType: 'text', payload: { text: 'hi', script: '<x>' } });
    expect(res.status).toBe(400);
    expect(m.sharedItem.create).not.toHaveBeenCalled();
  });

  it('413s a payload over 64 KB (image excluded)', async () => {
    const sets = Array.from({ length: 100 }, () => ({ reps: 5, weightKg: 100, unit: 'kg', rpe: 8, done: true }));
    const exercises = Array.from({ length: 60 }, (_, i) => ({ name: `Exercise ${i}`.padEnd(100, 'x'), notes: 'n'.repeat(500), sets }));
    const res = await request(app).post('/api/social/share').send({ itemType: 'workout', payload: { exercises } });
    expect(res.status).toBe(413);
  });

  it('a repost of a post the reposter cannot see is a 404', async () => {
    m.sharedItem.findUnique.mockResolvedValue({ id: 'orig', sharerId: 'stranger', recipientId: 'stranger', visibility: 'friends', itemType: 'text', payload: '{"text":"secret"}', caption: null, sharer: { id: 'stranger', name: 'S', username: 's' } });
    const res = await request(app).post('/api/social/share').send({ itemType: 'repost', payload: { originalPostId: 'orig' } });
    expect(res.status).toBe(404);
    expect(m.sharedItem.create).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('a repost copies attribution and content from the original, ignoring the client', async () => {
    m.sharedItem.findUnique.mockResolvedValue({ id: 'orig', sharerId: 'author', recipientId: 'author', visibility: 'public', itemType: 'text', payload: '{"text":"real words","imageBase64":"AAAA"}', caption: 'cap', sharer: { id: 'author', name: 'Real Author', username: 'real' } });
    const res = await request(app).post('/api/social/share').send({
      itemType: 'repost',
      payload: { originalPostId: 'orig', originalSharerName: 'Fake Name', originalPayload: { text: 'forged' } },
    });
    expect(res.status).toBe(201);
    const stored = JSON.parse(m.sharedItem.create.mock.calls[0][0].data.payload);
    expect(stored).toMatchObject({ originalPostId: 'orig', originalSharerId: 'author', originalSharerName: 'Real Author', originalPayload: { text: 'real words', hasImage: true } });
    expect(stored.originalPayload.imageBase64).toBeUndefined();
    expect(sendPushToUser).toHaveBeenCalledWith('author', 'New repost', expect.any(String), expect.objectContaining({ postId: 'orig' }));
  });
});

describe('blocking', () => {
  it('blockedIdsFor returns the other side of blocked rows only', async () => {
    m.friendship.findMany.mockResolvedValue([
      { requesterId: 'me', addresseeId: 'a', status: 'blocked' },
      { requesterId: 'b', addresseeId: 'me', status: 'blocked' },
      { requesterId: 'me', addresseeId: 'c', status: 'accepted' },
    ]);
    expect((await blockedIdsFor('me')).sort()).toEqual(['a', 'b']);
  });

  it('/feed/new-count excludes blocked authors', async () => {
    m.friendship.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'blocked' ? [{ requesterId: 'troll', addresseeId: 'me', status: 'blocked' }] : []);
    m.sharedItem.count.mockResolvedValue(0);
    await request(app).get('/api/social/feed/new-count?after=2026-10-01T00:00:00Z');
    expect(m.sharedItem.count.mock.calls[0][0].where.sharerId).toEqual({ notIn: ['me', 'troll'] });
  });

  it('a blocked profile and avatar are 404', async () => {
    m.friendship.findFirst.mockResolvedValue({ id: 'blk' });
    expect((await request(app).get('/api/social/profile/troll')).status).toBe(404);
    expect((await request(app).get('/api/social/users/troll/avatar')).status).toBe(404);
  });
});

describe('POST /social/report', () => {
  it('acks an unknown id exactly like a real report and writes nothing', async () => {
    m.sharedItem.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/social/report').send({ itemId: 'nope', targetType: 'post', reason: 'spam' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(m.contentReport.create).not.toHaveBeenCalled();
  });

  it('acks but ignores a post the reporter cannot see', async () => {
    m.sharedItem.findUnique.mockResolvedValue({ sharerId: 'stranger', recipientId: 'stranger', visibility: 'friends' });
    const res = await request(app).post('/api/social/report').send({ itemId: 'p1', targetType: 'post' });
    expect(res.status).toBe(200);
    expect(m.contentReport.create).not.toHaveBeenCalled();
  });

  it('acks a report on a user id that does not exist', async () => {
    m.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/social/report').send({ itemId: 'ghost', targetType: 'user' });
    expect(res.status).toBe(200);
    expect(m.contentReport.create).not.toHaveBeenCalled();
  });

  it('auto-hides at 5 established reporters, not before', async () => {
    m.sharedItem.findUnique.mockResolvedValue({ sharerId: 'author', recipientId: 'author', visibility: 'public' });
    m.contentReport.findMany.mockResolvedValue(['r1', 'r2', 'r3', 'r4', 'me'].map((reporterId) => ({ reporterId })));
    m.user.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }]); // 'me' is < 7 days old
    await request(app).post('/api/social/report').send({ itemId: 'p1', targetType: 'post' });
    expect(m.sharedItem.updateMany).not.toHaveBeenCalled();

    m.user.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'me' }]);
    await request(app).post('/api/social/report').send({ itemId: 'p1', targetType: 'post' });
    expect(m.sharedItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { visibility: 'hidden' } }));
  });

  it('thresholds: 5 strangers, or 3 when a reporter is the author\'s friend', () => {
    expect(shouldAutoHide(4, false)).toBe(false);
    expect(shouldAutoHide(5, false)).toBe(true);
    expect(shouldAutoHide(2, true)).toBe(false);
    expect(shouldAutoHide(3, true)).toBe(true);
  });
});

describe('image key validation + signing', () => {
  it('accepts only contentKey-shaped keys and verifies the server signature', async () => {
    const { isValidImageKey, signImageKey, verifyImageKeySig } = await vi.importActual<any>('../services/blobStore.js');
    const good = `img/ab/ab${'c'.repeat(62)}.jpg`;
    expect(isValidImageKey(good)).toBe(true);
    for (const bad of ['../etc/passwd', `img/zz/ab${'c'.repeat(62)}.jpg`, `img/ab/ab${'c'.repeat(62)}.exe`, 'other/key.jpg', 42]) {
      expect(isValidImageKey(bad)).toBe(false);
    }
    expect(verifyImageKeySig(good, signImageKey(good))).toBe(true);
    expect(verifyImageKeySig(good, 'f'.repeat(32))).toBe(false);
    expect(verifyImageKeySig('../x', signImageKey('../x'))).toBe(false);
  });
});
