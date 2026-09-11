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
import { scheduleBlogBroadcast, broadcastBlogPost } from '../services/blogBroadcastService.js';

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
  /** Email the post to all opted-in users on first publish (default on). */
  notifyUsers: z.boolean().optional().default(true),
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
    emailedAt: p.emailedAt ?? null,
    emailedCount: p.emailedCount ?? 0,
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
    if (post.published && d.notifyUsers) scheduleBlogBroadcast(post.id);
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
    const wasPublished = existing.published;
    const wasEmailed = !!existing.emailedAt;

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
    const justPublished = d.published === true && !wasPublished;
    if (justPublished && d.notifyUsers !== false && !wasEmailed) scheduleBlogBroadcast(post.id);
    res.json({ post: publicShape(post, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'A post with that slug already exists' });
    console.error('[blog] update error:', err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Manual send for a post that was published without notifying (or before this
// existed). Synchronous so the editor can show the real count.
router.post('/blog/admin/posts/:id/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await broadcastBlogPost(String(req.params.id));
    if (result.status === 'not_found') return res.status(404).json({ error: 'Post not found' });
    if (result.status === 'not_published') return res.status(400).json({ error: 'Publish the post before emailing it' });
    if (result.status === 'already_emailed') return res.status(409).json({ error: 'This post has already been emailed' });
    res.json(result);
  } catch (err) {
    console.error('[blog] email error:', err);
    res.status(500).json({ error: 'Failed to email post' });
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

// ─── Admin: subscriber list ──────────────────────────────────────────────────
// Email-only recipients (not accounts). Every broadcast goes to opted-in users
// + these, deduped by email. Unsubscribed rows are kept (so a click sticks)
// and shown as such; re-adding an unsubscribed address is a no-op.

const emailInput = z.string().trim().toLowerCase().email().max(254);
const subscribersInput = z.object({
  emails: z.array(emailInput).min(1).max(500),
});

function subscriberShape(s: { id: string; email: string; source: string; addedBy: string | null; unsubscribedAt: Date | null; createdAt: Date }) {
  return {
    id: s.id,
    email: s.email,
    source: s.source,
    addedBy: s.addedBy,
    unsubscribedAt: s.unsubscribedAt ? s.unsubscribedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get('/blog/admin/subscribers', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const subs = await prisma.blogSubscriber.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ subscribers: subs.map(subscriberShape) });
  } catch (err) {
    console.error('[blog] subscribers list error:', err);
    res.status(500).json({ error: 'Failed to load subscribers' });
  }
});

router.post('/blog/admin/subscribers', requireAuth, requireAdmin, async (req, res) => {
  const parsed = subscribersInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid emails' });
  try {
    const added: string[] = [];
    const existing: string[] = [];
    for (const email of Array.from(new Set(parsed.data.emails))) {
      const found = await prisma.blogSubscriber.findUnique({ where: { email } });
      if (found) { existing.push(email); continue; }
      await prisma.blogSubscriber.create({ data: { email, source: 'admin', addedBy: req.user!.email ?? null } });
      added.push(email);
    }
    res.json({ added, existing });
  } catch (err) {
    console.error('[blog] subscribers add error:', err);
    res.status(500).json({ error: 'Failed to add subscribers' });
  }
});

router.delete('/blog/admin/subscribers/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await prisma.blogSubscriber.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Subscriber not found' });
    await prisma.blogSubscriber.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[blog] subscribers delete error:', err);
    res.status(500).json({ error: 'Failed to remove subscriber' });
  }
});

export default router;
