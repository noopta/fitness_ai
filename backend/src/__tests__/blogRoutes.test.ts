// Blog API contract: public reads see only published posts; every write and
// the draft listing are ADMIN_EMAILS-only, enforced by the REAL requireAdmin.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const store = vi.hoisted(() => ({ posts: [] as any[], seq: 0 }));

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

process.env.ADMIN_EMAILS = 'Inquiries@AxiomTraining.io';
const { default: blogRouter, slugify, readingMinutes } = await import('../routes/blog.js');

const app = express();
app.use(express.json());
app.use('/api', blogRouter);

const ADMIN = { 'x-test-user': 'inquiries@axiomtraining.io' };
const MEMBER = { 'x-test-user': 'someone@example.com' };

beforeEach(() => { store.posts = []; store.seq = 0; });

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
