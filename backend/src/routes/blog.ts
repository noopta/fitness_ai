/**
 * Blog / startup-updates API.
 *
 * Public:   GET /api/blog/posts, GET /api/blog/posts/:slug — published only.
 * Admin:    /api/blog/admin/* — ADMIN_EMAILS only (requireAuth + requireAdmin).
 *
 * Posts are Markdown. The web renders them with react-markdown (no raw HTML),
 * so content is stored verbatim and never interpreted server-side.
 */
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();
const prisma = new PrismaClient();

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CONTENT = 200_000;

/** "Hello, World! v2" → "hello-world-v2". Empty when nothing survives. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

/** ~220 wpm, never below 1 so the UI never shows "0 min". */
export function readingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

const postInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(120).optional(),
  excerpt: z.string().trim().max(500).optional().default(''),
  content: z.string().max(MAX_CONTENT).optional().default(''),
  category: z.string().trim().min(1).max(40).optional().default('Update'),
  published: z.boolean().optional().default(false),
});

function publicShape(p: any, withContent: boolean) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    category: p.category,
    published: p.published,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    readingMinutes: readingMinutes(p.content ?? ''),
    ...(withContent ? { content: p.content } : {}),
  };
}

// ─── Public ──────────────────────────────────────────────────────────────────

router.get('/blog/posts', async (_req, res) => {
  try {
    const posts = await prisma.blogPost.findMany({
      where: { published: true },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ posts: posts.map(p => publicShape(p, false)) });
  } catch (err) {
    console.error('[blog] list error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

router.get('/blog/posts/:slug', async (req, res) => {
  try {
    const post = await prisma.blogPost.findUnique({ where: { slug: String(req.params.slug) } });
    // Drafts are invisible here, even to admins — they preview via /admin.
    if (!post || !post.published) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: publicShape(post, true) });
  } catch (err) {
    console.error('[blog] get error:', err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// ─── Admin ───────────────────────────────────────────────────────────────────

router.get('/blog/admin/posts', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const posts = await prisma.blogPost.findMany({ orderBy: { updatedAt: 'desc' } });
    res.json({ posts: posts.map(p => publicShape(p, false)) });
  } catch (err) {
    console.error('[blog] admin list error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

router.get('/blog/admin/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await prisma.blogPost.findUnique({ where: { id: String(req.params.id) } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: publicShape(post, true) });
  } catch (err) {
    console.error('[blog] admin get error:', err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

router.post('/blog/admin/posts', requireAuth, requireAdmin, async (req, res) => {
  const parsed = postInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid post' });
  const d = parsed.data;
  const slug = d.slug ? slugify(d.slug) : slugify(d.title);
  if (!slug || !SLUG_RE.test(slug)) return res.status(400).json({ error: 'Slug must contain letters or numbers' });

  try {
    const post = await prisma.blogPost.create({
      data: {
        slug,
        title: d.title,
        excerpt: d.excerpt,
        content: d.content,
        category: d.category,
        published: d.published,
        publishedAt: d.published ? new Date() : null,
        authorEmail: req.user!.email ?? null,
      },
    });
    res.status(201).json({ post: publicShape(post, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'A post with that slug already exists' });
    console.error('[blog] create error:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

router.put('/blog/admin/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  const parsed = postInput.partial().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid post' });
  const d = parsed.data;

  try {
    const existing = await prisma.blogPost.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Post not found' });

    let slug: string | undefined;
    if (d.slug !== undefined) {
      slug = slugify(d.slug);
      if (!slug || !SLUG_RE.test(slug)) return res.status(400).json({ error: 'Slug must contain letters or numbers' });
    }

    // publishedAt is set once, on the first publish, so re-publishing after an
    // edit doesn't bump a post back to the top of the list.
    const publishedAt =
      d.published === true && !existing.publishedAt ? new Date()
      : d.published === false ? existing.publishedAt
      : undefined;

    const post = await prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(d.excerpt !== undefined ? { excerpt: d.excerpt } : {}),
        ...(d.content !== undefined ? { content: d.content } : {}),
        ...(d.category !== undefined ? { category: d.category } : {}),
        ...(d.published !== undefined ? { published: d.published } : {}),
        ...(publishedAt !== undefined ? { publishedAt } : {}),
      },
    });
    res.json({ post: publicShape(post, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'A post with that slug already exists' });
    console.error('[blog] update error:', err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.delete('/blog/admin/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await prisma.blogPost.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    await prisma.blogPost.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[blog] delete error:', err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

export default router;
