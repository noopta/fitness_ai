// Blog / startup-updates API client. Public reads need no auth; admin writes
// go through authFetch (cookie + Bearer fallback) and are ADMIN_EMAILS-only
// server-side.
import { authFetch } from '@/lib/api';

const API = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

export interface BlogPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
  readingMinutes: number;
  /** Set once the post has been emailed to all opted-in users. */
  emailedAt: string | null;
  emailedCount: number;
}

export interface BlogPostFull extends BlogPostSummary {
  content: string;
}

export interface BlogPostInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  category?: string;
  published?: boolean;
  /** Email all opted-in users on first publish (server default: true). */
  notifyUsers?: boolean;
}

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data as T;
}

export async function listPublishedPosts(): Promise<BlogPostSummary[]> {
  const res = await fetch(`${API}/blog/posts`);
  return (await parse<{ posts: BlogPostSummary[] }>(res)).posts;
}

export async function getPublishedPost(slug: string): Promise<BlogPostFull | null> {
  const res = await fetch(`${API}/blog/posts/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  return (await parse<{ post: BlogPostFull }>(res)).post;
}

export async function adminListPosts(): Promise<BlogPostSummary[]> {
  const res = await authFetch(`${API}/blog/admin/posts`);
  return (await parse<{ posts: BlogPostSummary[] }>(res)).posts;
}

export async function adminGetPost(id: string): Promise<BlogPostFull> {
  const res = await authFetch(`${API}/blog/admin/posts/${encodeURIComponent(id)}`);
  return (await parse<{ post: BlogPostFull }>(res)).post;
}

export async function adminCreatePost(input: BlogPostInput): Promise<BlogPostFull> {
  const res = await authFetch(`${API}/blog/admin/posts`, { method: 'POST', body: JSON.stringify(input) });
  return (await parse<{ post: BlogPostFull }>(res)).post;
}

export async function adminUpdatePost(id: string, input: Partial<BlogPostInput>): Promise<BlogPostFull> {
  const res = await authFetch(`${API}/blog/admin/posts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
  return (await parse<{ post: BlogPostFull }>(res)).post;
}

export interface BroadcastResult { status: string; sent: number; failed: number; recipients: number }

export async function adminEmailPost(id: string): Promise<BroadcastResult> {
  const res = await authFetch(`${API}/blog/admin/posts/${encodeURIComponent(id)}/email`, { method: 'POST' });
  return parse<BroadcastResult>(res);
}

export async function adminDeletePost(id: string): Promise<void> {
  const res = await authFetch(`${API}/blog/admin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await parse<{ ok: true }>(res);
}

// ─── Subscribers (email-only recipients, not accounts) ───────────────────────

export interface BlogSubscriber {
  id: string;
  email: string;
  source: string;
  addedBy: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
}

export async function adminListSubscribers(): Promise<BlogSubscriber[]> {
  const res = await authFetch(`${API}/blog/admin/subscribers`);
  return (await parse<{ subscribers: BlogSubscriber[] }>(res)).subscribers;
}

export async function adminAddSubscribers(emails: string[]): Promise<{ added: string[]; existing: string[] }> {
  const res = await authFetch(`${API}/blog/admin/subscribers`, { method: 'POST', body: JSON.stringify({ emails }) });
  return parse<{ added: string[]; existing: string[] }>(res);
}

export async function adminRemoveSubscriber(id: string): Promise<void> {
  const res = await authFetch(`${API}/blog/admin/subscribers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await parse<{ ok: true }>(res);
}

/** Mirrors the server's slugify so the editor can preview the URL live. */
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

export function formatPostDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
