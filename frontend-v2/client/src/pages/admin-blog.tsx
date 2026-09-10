import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Plus, Trash2, ArrowLeft, ExternalLink } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BlogMarkdown } from '@/components/BlogMarkdown';
import {
  adminListPosts, adminGetPost, adminCreatePost, adminUpdatePost, adminDeletePost,
  slugify, formatPostDate, type BlogPostSummary, type BlogPostFull,
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
}

const EMPTY: Draft = { title: '', slug: '', slugTouched: false, excerpt: '', content: '', category: 'Update', published: false };

function draftFrom(p: BlogPostFull): Draft {
  return { title: p.title, slug: p.slug, slugTouched: true, excerpt: p.excerpt, content: p.content, category: p.category, published: p.published };
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
      const input = { title: draft.title.trim(), slug: effectiveSlug, excerpt: draft.excerpt.trim(), content: draft.content, category: draft.category.trim() || 'Update', published };
      const saved = editingId ? await adminUpdatePost(editingId, input) : await adminCreatePost(input);
      setDraft(draftFrom(saved));
      setEditingId(saved.id);
      setCreating(false);
      toast.success(published ? 'Published' : 'Saved as draft');
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
                <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Switch id="post-published" checked={draft.published} onCheckedChange={v => setDraft(d => ({ ...d, published: v }))} />
                    <Label htmlFor="post-published" className="text-sm">{draft.published ? 'Published — visible on /blog' : 'Draft — hidden from /blog'}</Label>
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
