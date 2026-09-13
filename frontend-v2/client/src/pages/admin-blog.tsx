import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Plus, Trash2, ArrowLeft, ExternalLink, Mail, UserPlus } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BlogMarkdown } from '@/components/BlogMarkdown';
import {
  adminListPosts, adminGetPost, adminCreatePost, adminUpdatePost, adminDeletePost, adminEmailPost,
  adminListSubscribers, adminAddSubscribers, adminRemoveSubscriber,
  slugify, formatPostDate, type BlogPostSummary, type BlogPostFull, type BlogSubscriber,
} from '@/lib/blogApi';

/**
 * Founder blog editor — /admin/blog. Rendered only behind AdminRoute, and every
 * API call is ADMIN_EMAILS-gated server-side too. Markdown in, live preview,
 * draft/publish toggle. ?edit=<id> deep-links straight into a post.
 */

interface Draft {
  title: string;
  slug: string;
  slugTouched: boolean;
  excerpt: string;
  content: string;
  category: string;
  published: boolean;
  /** Email every opted-in Axiom user when this post is first published. */
  notifyUsers: boolean;
  emailedAt: string | null;
  emailedCount: number;
}

const EMPTY: Draft = { title: '', slug: '', slugTouched: false, excerpt: '', content: '', category: 'Update', published: false, notifyUsers: true, emailedAt: null, emailedCount: 0 };

function draftFrom(p: BlogPostFull): Draft {
  return { title: p.title, slug: p.slug, slugTouched: true, excerpt: p.excerpt, content: p.content, category: p.category, published: p.published, notifyUsers: true, emailedAt: p.emailedAt ?? null, emailedCount: p.emailedCount ?? 0 };
}

/**
 * Email-only subscribers: people who aren't Axiom accounts but should get every
 * post. The broadcast merges them with opted-in users, deduped by email.
 */
function SubscribersCard() {
  const [subs, setSubs] = useState<BlogSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);

  async function load() {
    try { setSubs(await adminListSubscribers()); }
    catch (e: any) { toast.error(e?.message || 'Could not load subscribers'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const emails = input.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setAdding(true);
    try {
      const r = await adminAddSubscribers(emails);
      if (r.added.length) toast.success(`Added ${r.added.length} subscriber${r.added.length === 1 ? '' : 's'}`);
      if (r.existing.length) toast.message(`Already on the list: ${r.existing.join(', ')}`);
      setInput('');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not add subscribers');
    } finally {
      setAdding(false);
    }
  }

  async function remove(s: BlogSubscriber) {
    if (!confirm(`Remove ${s.email} from the subscriber list?`)) return;
    try { await adminRemoveSubscriber(s.id); setSubs(prev => prev.filter(x => x.id !== s.id)); }
    catch (e: any) { toast.error(e?.message || 'Could not remove subscriber'); }
  }

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2"><Mail size={15} /> Extra subscribers</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every published post is emailed to all verified, opted-in Axiom accounts automatically. Add addresses here for people who don't have an account.
        </p>
      </div>
      <div className="flex gap-2 items-start">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="one@example.com, two@example.com"
          rows={2}
          className="text-sm"
        />
        <Button size="sm" onClick={add} disabled={adding || !input.trim()} className="shrink-0">
          {adding ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <UserPlus size={14} className="mr-1.5" />} Add
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : subs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No extra subscribers yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {subs.map(s => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{s.email}</div>
                <div className="text-[11px] text-muted-foreground">
                  {s.unsubscribedAt ? <span className="text-red-500 font-medium">Unsubscribed</span> : 'Subscribed'} · added {formatPostDate(s.createdAt)}{s.addedBy ? ` by ${s.addedBy}` : ''}
                </div>
              </div>
              <Button variant="ghost" size="sm" aria-label="Remove subscriber" onClick={() => remove(s)}><Trash2 size={14} className="text-red-500" /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminBlogPage() {
  const [, navigate] = useLocation();
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [emailing, setEmailing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setPosts(await adminListPosts());
    } catch (err: any) {
      toast.error(err.message || 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = new URLSearchParams(window.location.search).get('edit');
    if (id) openEdit(id);
  }, []);

  async function openEdit(id: string) {
    try {
      const post = await adminGetPost(id);
      setDraft(draftFrom(post));
      setEditingId(post.id);
      setCreating(false);
      setPreview(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to open post');
    }
  }

  function openNew() {
    setDraft(EMPTY);
    setEditingId(null);
    setCreating(true);
    setPreview(false);
  }

  function closeEditor() {
    setEditingId(null);
    setCreating(false);
    setDraft(EMPTY);
    if (window.location.search) navigate('/admin/blog', { replace: true });
  }

  const effectiveSlug = useMemo(() => slugify(draft.slug || draft.title), [draft.slug, draft.title]);

  async function save(publishedOverride?: boolean) {
    const published = publishedOverride ?? draft.published;
    if (!draft.title.trim()) { toast.error('Give the post a title'); return; }
    if (!effectiveSlug) { toast.error('Slug needs at least one letter or number'); return; }
    setSaving(true);
    try {
      const firstPublish = published && !draft.published && !draft.emailedAt;
      const input = { title: draft.title.trim(), slug: effectiveSlug, excerpt: draft.excerpt.trim(), content: draft.content, category: draft.category.trim() || 'Update', published, notifyUsers: draft.notifyUsers };
      const saved = editingId ? await adminUpdatePost(editingId, input) : await adminCreatePost(input);
      setDraft({ ...draftFrom(saved), notifyUsers: draft.notifyUsers });
      setEditingId(saved.id);
      setCreating(false);
      toast.success(published ? (firstPublish && draft.notifyUsers ? 'Published — emailing all Axiom users now' : 'Published') : 'Saved as draft');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    try {
      await adminDeletePost(id);
      toast.success('Post deleted');
      if (editingId === id) closeEditor();
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  }

  async function emailNow() {
    if (!editingId) return;
    if (!window.confirm('Email this post to every opted-in Axiom user now?')) return;
    setEmailing(true);
    try {
      const r = await adminEmailPost(editingId);
      toast.success(`Emailed to ${r.sent} user${r.sent === 1 ? '' : 's'}${r.failed ? ` (${r.failed} failed)` : ''}`);
      setDraft(d => ({ ...d, emailedAt: new Date().toISOString(), emailedCount: r.sent }));
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Email failed');
    } finally {
      setEmailing(false);
    }
  }

  const editorOpen = creating || editingId !== null;

  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-10 space-y-6">
        {!editorOpen ? (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Blog & Updates</h1>
                <p className="text-sm text-muted-foreground mt-1">Posts you publish here appear at the top of <Link href="/blog" className="underline">/blog</Link>. Drafts are only visible on this page.</p>
              </div>
              <Button size="sm" onClick={openNew}><Plus size={14} className="mr-1.5" /> New post</Button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : posts.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">No posts yet. Write your first update.</Card>
            ) : (
              <div className="space-y-2">
                {posts.map(p => (
                  <Card key={p.id} className="p-4 flex items-center gap-3">
                    <button type="button" onClick={() => openEdit(p.id)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${p.published ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                          {p.published ? 'Published' : 'Draft'}
                        </span>
                        <span className="text-xs text-muted-foreground">{p.category}</span>
                        <span className="text-xs text-muted-foreground">· {formatPostDate(p.publishedAt ?? p.updatedAt)}</span>
                      </div>
                      <div className="text-sm font-semibold mt-1 truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground truncate">/blog/{p.slug}</div>
                    </button>
                    {p.published && (
                      <Button asChild variant="ghost" size="sm" aria-label="View post">
                        <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /></a>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" aria-label="Delete post" onClick={() => remove(p.id)}><Trash2 size={14} className="text-red-500" /></Button>
                  </Card>
                ))}
              </div>
            )}

            <SubscribersCard />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Button variant="ghost" size="sm" onClick={closeEditor}><ArrowLeft size={14} className="mr-1.5" /> All posts</Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreview(v => !v)}>
                  {preview ? <><EyeOff size={14} className="mr-1.5" /> Edit</> : <><Eye size={14} className="mr-1.5" /> Preview</>}
                </Button>
                <Button variant="outline" size="sm" disabled={saving} onClick={() => save(false)}>Save draft</Button>
                <Button size="sm" disabled={saving} onClick={() => save(true)}>
                  {saving ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
                  {draft.published ? 'Update' : 'Publish'}
                </Button>
              </div>
            </div>

            {preview ? (
              <Card className="p-6 sm:p-8">
                <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{draft.category || 'Update'}</span>
                <h1 className="text-3xl font-extrabold mt-3 mb-2">{draft.title || 'Untitled'}</h1>
                {draft.excerpt && <p className="text-lg text-muted-foreground mb-6">{draft.excerpt}</p>}
                <BlogMarkdown content={draft.content} />
              </Card>
            ) : (
              <Card className="p-5 space-y-5">
                <div className="grid sm:grid-cols-[1fr_180px] gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="post-title">Title</Label>
                    <Input id="post-title" value={draft.title} placeholder="What shipped this week"
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value, slug: d.slugTouched ? d.slug : slugify(e.target.value) }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="post-category">Category</Label>
                    <Input id="post-category" value={draft.category} placeholder="Update"
                      onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="post-slug">URL</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground shrink-0">axiomtraining.io/blog/</span>
                    <Input id="post-slug" value={draft.slug} placeholder={slugify(draft.title) || 'my-post'}
                      onChange={e => setDraft(d => ({ ...d, slug: e.target.value, slugTouched: true }))} />
                  </div>
                  {draft.slug && effectiveSlug !== draft.slug && (
                    <p className="text-xs text-muted-foreground">Will be saved as <span className="font-mono">{effectiveSlug || '(empty)'}</span></p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="post-excerpt">Excerpt</Label>
                  <Textarea id="post-excerpt" rows={2} value={draft.excerpt} placeholder="One or two sentences shown on the blog index and in link previews."
                    onChange={e => setDraft(d => ({ ...d, excerpt: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="post-content">Body (Markdown)</Label>
                  <Textarea id="post-content" rows={22} value={draft.content} className="font-mono text-sm"
                    placeholder={"## What's new\n\n- Shipped X\n- Fixed Y\n\nLonger thoughts here. **Bold**, _italics_, [links](https://...), images and tables all work."}
                    onChange={e => setDraft(d => ({ ...d, content: e.target.value }))} />
                </div>
                <div className="flex items-center justify-between gap-3 pt-2 border-t border-border flex-wrap">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Switch id="post-published" checked={draft.published} onCheckedChange={v => setDraft(d => ({ ...d, published: v }))} />
                      <Label htmlFor="post-published" className="text-sm">{draft.published ? 'Published — visible on /blog' : 'Draft — hidden from /blog'}</Label>
                    </div>
                    {draft.emailedAt ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail size={12} /> Emailed to {draft.emailedCount} user{draft.emailedCount === 1 ? '' : 's'} on {formatPostDate(draft.emailedAt)}</p>
                    ) : draft.published && editingId ? (
                      <Button type="button" variant="outline" size="sm" disabled={emailing} onClick={emailNow}>
                        {emailing ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Mail size={13} className="mr-1.5" />} Email all users now
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Switch id="post-notify" checked={draft.notifyUsers} onCheckedChange={v => setDraft(d => ({ ...d, notifyUsers: v }))} />
                        <Label htmlFor="post-notify" className="text-sm">Email all Axiom users when published</Label>
                      </div>
                    )}
                  </div>
                  {editingId && (
                    <Button variant="ghost" size="sm" onClick={() => remove(editingId)}><Trash2 size={14} className="mr-1.5 text-red-500" /> Delete</Button>
                  )}
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
