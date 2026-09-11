// Blog API contract: public reads see only published posts; every write and
// the draft listing are ADMIN_EMAILS-only, enforced by the REAL requireAdmin.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({ posts: [] as any[], subs: [] as any[], seq: 0 }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    const dup = (data: any) => {
      if (store.posts.some(p => p.slug === data.slug)) { const e: any = new Error('dup'); e.code = 'P2002'; throw e; }
    };
    this.blogPost = {
      findMany: vi.fn(async (a: any) => {
        let rows = store.posts.slice();
        if (a?.where?.published !== undefined) rows = rows.filter(p => p.published === a.where.published);
        return rows.sort((x, y) => (y.publishedAt?.getTime() ?? 0) - (x.publishedAt?.getTime() ?? 0));
      }),
      findUnique: vi.fn(async (a: any) => store.posts.find(p =>
        (a.where.id !== undefined && p.id === a.where.id) || (a.where.slug !== undefined && p.slug === a.where.slug)) ?? null),
      create: vi.fn(async (a: any) => {
        dup(a.data);
        const now = new Date();
        const row = { id: `post-${++store.seq}`, createdAt: now, updatedAt: now, ...a.data };
        store.posts.push(row); return row;
      }),
      update: vi.fn(async (a: any) => {
        const row = store.posts.find(p => p.id === a.where.id);
        if (a.data.slug && a.data.slug !== row.slug) dup(a.data);
        Object.assign(row, a.data, { updatedAt: new Date() }); return row;
      }),
      delete: vi.fn(async (a: any) => { store.posts = store.posts.filter(p => p.id !== a.where.id); }),
    };
    this.blogSubscriber = {
      findMany: vi.fn(async () => store.subs.slice().reverse()),
      findUnique: vi.fn(async (a: any) => store.subs.find(s =>
        (a.where.id !== undefined && s.id === a.where.id) || (a.where.email !== undefined && s.email === a.where.email)) ?? null),
      create: vi.fn(async (a: any) => {
        const row = { id: `sub-${++store.seq}`, unsubscribedAt: null, createdAt: new Date(), ...a.data };
        store.subs.push(row); return row;
      }),
      delete: vi.fn(async (a: any) => { store.subs = store.subs.filter(s => s.id !== a.where.id); }),
    };
  }),
}));

// requireAuth: identify by header so one app can act as admin, member, or anon.
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const email = req.headers['x-test-user'];
    if (!email) return res.status(401).json({ error: 'auth' });
    req.user = { id: `u-${email}`, email, tier: 'free' };
    next();
  },
}));

const broadcast = vi.hoisted(() => ({
  scheduleBlogBroadcast: vi.fn(),
  broadcastBlogPost: vi.fn(async (id: string) => ({ status: 'sent', sent: 3, failed: 0, recipients: 3 })),
}));
vi.mock('../services/blogBroadcastService.js', () => broadcast);

process.env.ADMIN_EMAILS = 'Inquiries@AxiomTraining.io';
const { default: blogRouter, slugify, readingMinutes } = await import('../routes/blog.js');

const app = express();
app.use(express.json());
app.use('/api', blogRouter);

const ADMIN = { 'x-test-user': 'inquiries@axiomtraining.io' };
const MEMBER = { 'x-test-user': 'someone@example.com' };

beforeEach(() => { store.posts = []; store.subs = []; store.seq = 0; broadcast.scheduleBlogBroadcast.mockClear(); broadcast.broadcastBlogPost.mockClear(); });

describe('helpers', () => {
  it('slugify normalises titles', () => {
    expect(slugify('Hello, World! v2')).toBe('hello-world-v2');
    expect(slugify('  Ünïcode — dash ')).toBe('unicode-dash');
    expect(slugify('!!!')).toBe('');
  });
  it('readingMinutes never reports 0', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes(Array(660).fill('w').join(' '))).toBe(3);
  });
});

describe('admin gate', () => {
  it('writes and the draft list are admin-only; case-insensitive allowlist', async () => {
    expect((await request(app).post('/api/blog/admin/posts').send({ title: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/blog/admin/posts').set(MEMBER).send({ title: 'x' })).status).toBe(403);
    expect((await request(app).get('/api/blog/admin/posts').set(MEMBER)).status).toBe(403);
    const ok = await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'First update' });
    expect(ok.status).toBe(201);
    expect(ok.body.post.slug).toBe('first-update');
    expect(ok.body.post.published).toBe(false);
  });
});

describe('public reads', () => {
  it('only published posts are listed or fetchable by slug', async () => {
    await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'Draft post', content: 'secret' });
    const pub = await request(app).post('/api/blog/admin/posts').set(ADMIN)
      .send({ title: 'Launch week', content: '# Hi\n\nWe shipped.', published: true, category: 'Update' });
    expect(pub.body.post.publishedAt).toBeTruthy();

    const list = await request(app).get('/api/blog/posts');
    expect(list.status).toBe(200);
    expect(list.body.posts.map((p: any) => p.slug)).toEqual(['launch-week']);
    expect(list.body.posts[0].content).toBeUndefined(); // list is metadata only
    expect(list.body.posts[0].readingMinutes).toBe(1);

    expect((await request(app).get('/api/blog/posts/draft-post')).status).toBe(404);
    const one = await request(app).get('/api/blog/posts/launch-week');
    expect(one.status).toBe(200);
    expect(one.body.post.content).toBe('# Hi\n\nWe shipped.');

    // Admin list sees both, drafts included.
    const all = await request(app).get('/api/blog/admin/posts').set(ADMIN);
    expect(all.body.posts).toHaveLength(2);
  });
});

describe('update / delete', () => {
  it('publishing sets publishedAt once; unpublishing hides it; slug conflicts 409', async () => {
    const a = (await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'A' })).body.post;
    await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'B' });

    const p1 = await request(app).put(`/api/blog/admin/posts/${a.id}`).set(ADMIN).send({ published: true, content: 'v1' });
    expect(p1.status).toBe(200);
    const firstPublishedAt = p1.body.post.publishedAt;
    expect(firstPublishedAt).toBeTruthy();

    // Edit + re-publish keeps the original publish date.
    await request(app).put(`/api/blog/admin/posts/${a.id}`).set(ADMIN).send({ published: false });
    expect((await request(app).get('/api/blog/posts/a')).status).toBe(404);
    const p2 = await request(app).put(`/api/blog/admin/posts/${a.id}`).set(ADMIN).send({ published: true, content: 'v2' });
    expect(p2.body.post.publishedAt).toBe(firstPublishedAt);
    expect((await request(app).get('/api/blog/posts/a')).body.post.content).toBe('v2');

    expect((await request(app).put(`/api/blog/admin/posts/${a.id}`).set(ADMIN).send({ slug: 'b' })).status).toBe(409);
    expect((await request(app).put(`/api/blog/admin/posts/${a.id}`).set(ADMIN).send({ slug: '???' })).status).toBe(400);
    expect((await request(app).put(`/api/blog/admin/posts/${a.id}`).set(MEMBER).send({ title: 'hax' })).status).toBe(403);

    expect((await request(app).delete(`/api/blog/admin/posts/${a.id}`).set(MEMBER)).status).toBe(403);
    expect((await request(app).delete(`/api/blog/admin/posts/${a.id}`).set(ADMIN)).status).toBe(200);
    expect((await request(app).get('/api/blog/posts/a')).status).toBe(404);
    expect((await request(app).delete(`/api/blog/admin/posts/${a.id}`).set(ADMIN)).status).toBe(404);
  });

  it('rejects invalid input', async () => {
    expect((await request(app).post('/api/blog/admin/posts').set(ADMIN).send({})).status).toBe(400);
    expect((await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: '!!!' })).status).toBe(400);
    expect((await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'ok', published: 'yes' })).status).toBe(400);
  });
});

describe('publish → email all users', () => {
  it('schedules the broadcast on first publish only, and honours notifyUsers=false', async () => {
    const draft = (await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'Quiet draft' })).body.post;
    expect(broadcast.scheduleBlogBroadcast).not.toHaveBeenCalled();

    await request(app).put(`/api/blog/admin/posts/${draft.id}`).set(ADMIN).send({ published: true });
    expect(broadcast.scheduleBlogBroadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.scheduleBlogBroadcast).toHaveBeenCalledWith(draft.id);

    // Editing an already-published post never re-sends.
    await request(app).put(`/api/blog/admin/posts/${draft.id}`).set(ADMIN).send({ content: 'typo fix' });
    await request(app).put(`/api/blog/admin/posts/${draft.id}`).set(ADMIN).send({ published: true });
    expect(broadcast.scheduleBlogBroadcast).toHaveBeenCalledTimes(1);

    // Created-as-published sends immediately; notifyUsers=false suppresses it.
    await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'Loud', published: true });
    expect(broadcast.scheduleBlogBroadcast).toHaveBeenCalledTimes(2);
    await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'Silent', published: true, notifyUsers: false });
    expect(broadcast.scheduleBlogBroadcast).toHaveBeenCalledTimes(2);
  });

  it('manual send endpoint is admin-only and maps service statuses to HTTP', async () => {
    const p = (await request(app).post('/api/blog/admin/posts').set(ADMIN).send({ title: 'Manual', published: true, notifyUsers: false })).body.post;
    expect((await request(app).post(`/api/blog/admin/posts/${p.id}/email`).set(MEMBER)).status).toBe(403);
    const ok = await request(app).post(`/api/blog/admin/posts/${p.id}/email`).set(ADMIN);
    expect(ok.status).toBe(200);
    expect(ok.body.sent).toBe(3);
    broadcast.broadcastBlogPost.mockResolvedValueOnce({ status: 'already_emailed', sent: 0, failed: 0, recipients: 0 });
    expect((await request(app).post(`/api/blog/admin/posts/${p.id}/email`).set(ADMIN)).status).toBe(409);
    broadcast.broadcastBlogPost.mockResolvedValueOnce({ status: 'not_published', sent: 0, failed: 0, recipients: 0 });
    expect((await request(app).post(`/api/blog/admin/posts/${p.id}/email`).set(ADMIN)).status).toBe(400);
  });
});

describe('subscriber list', () => {
  it('is admin-only', async () => {
    expect((await request(app).get('/api/blog/admin/subscribers')).status).toBe(401);
    expect((await request(app).get('/api/blog/admin/subscribers').set(MEMBER)).status).toBe(403);
    expect((await request(app).post('/api/blog/admin/subscribers').set(MEMBER).send({ emails: ['a@b.co'] })).status).toBe(403);
  });

  it('adds normalised addresses once, reports existing ones, validates input', async () => {
    const r = await request(app).post('/api/blog/admin/subscribers').set(ADMIN)
      .send({ emails: [' Saeed.Abiissa@gmail.com ', 'themoroccandevil@gmail.com', 'saeed.abiissa@gmail.com'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ added: ['saeed.abiissa@gmail.com', 'themoroccandevil@gmail.com'], existing: [] });
    expect(store.subs.map(s => s.addedBy)).toEqual(['inquiries@axiomtraining.io', 'inquiries@axiomtraining.io']);

    const again = await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['themoroccandevil@gmail.com'] });
    expect(again.body).toEqual({ added: [], existing: ['themoroccandevil@gmail.com'] });
    expect(store.subs).toHaveLength(2);

    expect((await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['not-an-email'] })).status).toBe(400);
    expect((await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: [] })).status).toBe(400);

    const list = await request(app).get('/api/blog/admin/subscribers').set(ADMIN);
    expect(list.body.subscribers.map((s: any) => s.email)).toEqual(['themoroccandevil@gmail.com', 'saeed.abiissa@gmail.com']);
    expect(list.body.subscribers[0].unsubscribedAt).toBeNull();
  });

  it('removes by id; unknown id 404s', async () => {
    const id = (await request(app).post('/api/blog/admin/subscribers').set(ADMIN).send({ emails: ['x@y.co'] })).status === 200 ? store.subs[0].id : '';
    expect((await request(app).delete(`/api/blog/admin/subscribers/${id}`).set(MEMBER)).status).toBe(403);
    expect((await request(app).delete(`/api/blog/admin/subscribers/${id}`).set(ADMIN)).status).toBe(200);
    expect(store.subs).toHaveLength(0);
    expect((await request(app).delete('/api/blog/admin/subscribers/nope').set(ADMIN)).status).toBe(404);
  });
});
