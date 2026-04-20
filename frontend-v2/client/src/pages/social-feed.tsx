import { useEffect, useState, useRef, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Share2, Copy, Check, Loader2, Search, ChevronDown,
  Dumbbell, Apple, Trophy, Rss, Image, Video, Type,
  ExternalLink, Heart, MessageCircle, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

type PostTab = 'text' | 'image' | 'video';
type LegacyItemType = 'workout' | 'nutrition' | 'pr';
type AnyItemType = LegacyItemType | 'text' | 'media';

interface PostComment {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string | null; username: string | null };
}

interface SharedFeedItem {
  id: string;
  sharerId: string;
  sharer: { id: string; name: string | null; email: string | null; username?: string | null };
  recipientId: string;
  itemType: AnyItemType;
  payload: {
    description?: string;
    text?: string;
    imageBase64?: string;
    videoUrl?: string;
    data?: Record<string, unknown>;
  };
  caption?: string | null;
  createdAt: string;
  reactionCount: number;
  likedByMe: boolean;
  commentCount: number;
  comments: PostComment[];
}

interface UserResult {
  id: string;
  name: string | null;
  email: string | null;
}

function initials(name: string | null, email: string | null): string {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return '?';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function legacyIcon(type: LegacyItemType) {
  switch (type) {
    case 'workout': return <Dumbbell className="h-3.5 w-3.5" />;
    case 'nutrition': return <Apple className="h-3.5 w-3.5" />;
    case 'pr': return <Trophy className="h-3.5 w-3.5" />;
  }
}

function itemBadge(type: AnyItemType) {
  switch (type) {
    case 'text':
      return { icon: <Type className="h-3.5 w-3.5" />, label: 'Text', color: 'bg-slate-100 text-slate-700' };
    case 'media':
      return { icon: <Image className="h-3.5 w-3.5" />, label: 'Media', color: 'bg-purple-100 text-purple-700' };
    case 'workout':
      return { icon: legacyIcon('workout'), label: 'Workout', color: 'bg-blue-100 text-blue-700' };
    case 'nutrition':
      return { icon: legacyIcon('nutrition'), label: 'Nutrition', color: 'bg-green-100 text-green-700' };
    case 'pr':
      return { icon: legacyIcon('pr'), label: 'PR', color: 'bg-amber-100 text-amber-700' };
    default:
      return { icon: null, label: String(type), color: 'bg-muted text-muted-foreground' };
  }
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

function getYouTubeEmbedId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

function toImageSrc(raw: string): string {
  if (raw.startsWith('data:')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

function FeedCard({
  item: initialItem,
  currentUserId,
  friends,
}: {
  item: SharedFeedItem;
  currentUserId?: string;
  friends: UserResult[];
}) {
  const [item, setItem] = useState(initialItem);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [forwarding, setForwarding] = useState<string | null>(null);

  useEffect(() => { setItem(initialItem); }, [initialItem.id]);

  const badge = itemBadge(item.itemType);
  const embedId = item.payload?.videoUrl ? getYouTubeEmbedId(item.payload.videoUrl) : null;

  async function handleReact() {
    const wasLiked = item.likedByMe;
    setItem(prev => ({ ...prev, likedByMe: !wasLiked, reactionCount: prev.reactionCount + (wasLiked ? -1 : 1) }));
    try {
      await authFetch(`${API_BASE}/social/posts/${item.id}/react`, { method: 'POST' });
    } catch {
      setItem(prev => ({ ...prev, likedByMe: wasLiked, reactionCount: prev.reactionCount + (wasLiked ? 1 : -1) }));
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await authFetch(`${API_BASE}/social/posts/${item.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (!res.ok) throw new Error();
      const newComment: PostComment = await res.json();
      setItem(prev => ({ ...prev, comments: [...prev.comments, newComment], commentCount: prev.commentCount + 1 }));
      setCommentText('');
    } catch {
      toast.error('Could not post comment.');
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleForward(friendId: string) {
    setForwarding(friendId);
    try {
      const res = await authFetch(`${API_BASE}/social/posts/${item.id}/forward`, {
        method: 'POST',
        body: JSON.stringify({ recipientId: friendId }),
      });
      if (!res.ok) throw new Error();
      setShowForwardPicker(false);
      toast.success('Post forwarded!');
    } catch {
      toast.error('Could not forward post.');
    } finally {
      setForwarding(null);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="text-xs">
              {initials(item.sharer.name, item.sharer.email)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold">
              {item.sharer.name || item.sharer.email || 'Someone'}
            </p>
            <p className="text-xs text-muted-foreground">{relativeTime(item.createdAt)}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.color}`}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      {/* Caption */}
      {item.caption && (
        <p className="text-sm text-muted-foreground italic">{item.caption}</p>
      )}

      {/* Text content */}
      {(item.payload?.text || item.payload?.description) && (
        <p className="text-sm text-foreground/90 rounded-xl bg-muted/40 px-3 py-2.5 whitespace-pre-wrap">
          {item.payload.text || item.payload.description}
        </p>
      )}

      {/* Image */}
      {item.payload?.imageBase64 && (
        <img
          src={toImageSrc(item.payload.imageBase64)}
          alt="Shared image"
          className="rounded-xl max-h-96 w-full object-contain border bg-muted/20"
        />
      )}

      {/* Video */}
      {item.payload?.videoUrl && (
        embedId ? (
          <div className="rounded-xl overflow-hidden border aspect-video">
            <iframe
              className="w-full h-full"
              src={`https://www.youtube.com/embed/${embedId}`}
              title="YouTube video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <a
            href={item.payload.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-primary hover:bg-muted/30 transition-colors"
          >
            <Video className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.payload.videoUrl}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 ml-auto" />
          </a>
        )
      )}

      {/* Legacy data fields */}
      {item.payload?.data && Object.keys(item.payload.data).length > 0 && (
        <div className="rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {Object.entries(item.payload.data).map(([k, v]) => (
            <div key={k}><span className="font-semibold">{k}:</span> {String(v)}</div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-4 pt-2 border-t">
        <button
          onClick={handleReact}
          className={`flex items-center gap-1.5 text-xs transition-colors ${item.likedByMe ? 'text-red-500' : 'text-muted-foreground hover:text-red-500'}`}
        >
          <Heart className={`h-4 w-4 ${item.likedByMe ? 'fill-current' : ''}`} />
          {item.reactionCount > 0 && <span>{item.reactionCount}</span>}
        </button>
        <button
          onClick={() => setCommentsExpanded(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="h-4 w-4" />
          {item.commentCount > 0 && <span>{item.commentCount}</span>}
        </button>
        {currentUserId && item.sharerId !== currentUserId && friends.length > 0 && (
          <button
            onClick={() => setShowForwardPicker(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            <Send className="h-4 w-4" />
            <span>Forward</span>
          </button>
        )}
      </div>

      {/* Forward picker */}
      {showForwardPicker && (
        <div className="rounded-xl border p-3 space-y-2 bg-muted/10">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Send to a friend</p>
          {friends.map(f => (
            <button
              key={f.id}
              disabled={!!forwarding}
              onClick={() => handleForward(f.id)}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/30 transition-colors text-left"
            >
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[10px]">{initials(f.name, f.email)}</AvatarFallback>
              </Avatar>
              <span className="text-sm">{f.name || f.email}</span>
              {forwarding === f.id && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto" />}
            </button>
          ))}
        </div>
      )}

      {/* Comments section */}
      {commentsExpanded && (
        <div className="space-y-2">
          {item.comments.map(c => (
            <div key={c.id} className="flex gap-2 text-sm">
              <span className="font-semibold shrink-0">{c.author.username ? `@${c.author.username}` : (c.author.name ?? 'User')}</span>
              <span className="text-foreground/80">{c.text}</span>
            </div>
          ))}
          <form onSubmit={handleAddComment} className="flex gap-2 pt-1 border-t">
            <input
              className="flex-1 text-sm bg-transparent border-b outline-none py-1 placeholder:text-muted-foreground/60"
              placeholder="Add a comment…"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              disabled={submittingComment}
            />
            <button
              type="submit"
              disabled={submittingComment || !commentText.trim()}
              className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              {submittingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}
    </Card>
  );
}

export default function SocialFeedPage() {
  const { user } = useAuth();

  const [feed, setFeed] = useState<SharedFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [friends, setFriends] = useState<UserResult[]>([]);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Share form
  const [shareOpen, setShareOpen] = useState(false);
  const [postTab, setPostTab] = useState<PostTab>('text');

  // Recipient (optional)
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<UserResult[]>([]);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<UserResult | null>(null);

  // Text tab
  const [textContent, setTextContent] = useState('');

  // Caption (shared across tabs)
  const [caption, setCaption] = useState('');

  // Image tab
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video tab
  const [videoUrl, setVideoUrl] = useState('');

  const [sharing, setSharing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    authFetch(`${API_BASE}/social/shared-feed`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setFeed(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setFeedLoading(false));

    authFetch(`${API_BASE}/social/friends`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setFriends(Array.isArray(data) ? data : (data?.friends ?? [])))
      .catch(() => {});
  }, []);

  async function loadInviteLink() {
    setInviteLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/social/invite`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInviteLink(data.link || data.url || data.inviteLink || JSON.stringify(data));
    } catch {
      toast.error('Failed to load invite link.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy.');
    }
  }

  const runRecipientSearch = useCallback((q: string) => {
    if (!q.trim()) { setRecipientResults([]); return; }
    setRecipientLoading(true);
    authFetch(`${API_BASE}/social/users/search?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRecipientResults(Array.isArray(data) ? data : []))
      .catch(() => setRecipientResults([]))
      .finally(() => setRecipientLoading(false));
  }, []);

  function handleRecipientChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setRecipientQuery(v);
    setSelectedRecipient(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runRecipientSearch(v), 300);
  }

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      setImageBase64(result);
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setTextContent('');
    setCaption('');
    setImageBase64(null);
    setImagePreview(null);
    setVideoUrl('');
    setSelectedRecipient(null);
    setRecipientQuery('');
    setRecipientResults([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleShare() {
    let itemType: AnyItemType;
    let payload: Record<string, unknown>;

    if (postTab === 'text') {
      if (!textContent.trim()) { toast.error('Enter some text to post.'); return; }
      itemType = 'text';
      payload = { text: textContent.trim() };
    } else if (postTab === 'image') {
      if (!imageBase64) { toast.error('Select an image first.'); return; }
      itemType = 'media';
      payload = { imageBase64 };
    } else {
      if (!videoUrl.trim()) { toast.error('Enter a video URL.'); return; }
      itemType = 'media';
      payload = { videoUrl: videoUrl.trim() };
    }

    setSharing(true);
    try {
      const body: Record<string, unknown> = { itemType, payload };
      if (selectedRecipient) body.recipientId = selectedRecipient.id;
      if (caption.trim()) body.caption = caption.trim();

      const res = await authFetch(`${API_BASE}/social/share`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to share');
      }

      const newItem: SharedFeedItem = await res.json();
      setFeed(prev => [newItem, ...prev]);
      resetForm();
      setShareOpen(false);
      toast.success('Posted successfully!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to post.');
    } finally {
      setSharing(false);
    }
  }

  const tabs: { key: PostTab; icon: React.ReactNode; label: string }[] = [
    { key: 'text', icon: <Type className="h-3.5 w-3.5" />, label: 'Text' },
    { key: 'image', icon: <Image className="h-3.5 w-3.5" />, label: 'Image' },
    { key: 'video', icon: <Video className="h-3.5 w-3.5" />, label: 'Video' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Social Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Share text, images, and videos with your friends.
          </p>
        </div>

        {/* Share form */}
        <Card className="overflow-hidden">
          <button
            onClick={() => setShareOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10">
                <Share2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Share Something</p>
                <p className="text-xs text-muted-foreground">Post to the feed or send to a friend</p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${shareOpen ? 'rotate-180' : ''}`} />
          </button>

          {shareOpen && (
            <div className="px-5 pb-5 border-t pt-4 space-y-4">
              {/* Post type tabs */}
              <div className="flex flex-wrap gap-1.5">
                {tabs.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setPostTab(t.key)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
                      postTab === t.key
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Optional recipient */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Send to (optional — leave blank to post to feed)
                </Label>
                {selectedRecipient ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">{initials(selectedRecipient.name, selectedRecipient.email)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{selectedRecipient.name || selectedRecipient.email}</span>
                    </div>
                    <button
                      onClick={() => { setSelectedRecipient(null); setRecipientQuery(''); setRecipientResults([]); }}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        className="pl-9 rounded-xl"
                        placeholder="Search by name or email..."
                        value={recipientQuery}
                        onChange={handleRecipientChange}
                      />
                    </div>
                    {recipientLoading && (
                      <div className="flex justify-center py-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {!recipientLoading && recipientResults.length > 0 && (
                      <div className="space-y-1">
                        {recipientResults.map(u => (
                          <button
                            key={u.id}
                            onClick={() => { setSelectedRecipient(u); setRecipientQuery(u.name || u.email || ''); setRecipientResults([]); }}
                            className="w-full flex items-center gap-3 rounded-xl border px-3 py-2 hover:bg-muted/30 transition-colors text-left"
                          >
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarFallback className="text-[10px]">{initials(u.name, u.email)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{u.name || '(no name)'}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tab content */}
              {postTab === 'text' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content</Label>
                  <textarea
                    rows={4}
                    placeholder="What's on your mind? Share a workout, PR, tip..."
                    value={textContent}
                    onChange={e => setTextContent(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>
              )}

              {postTab === 'image' && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Image</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageFile}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary hover:file:bg-primary/20"
                  />
                  {imagePreview && (
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="rounded-xl max-h-64 object-contain border w-full bg-muted/20"
                      />
                      <button
                        onClick={() => { setImageBase64(null); setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="absolute top-2 right-2 rounded-full bg-black/50 text-white text-xs px-2 py-0.5 hover:bg-black/70"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Max 2MB. JPG, PNG, GIF, WebP supported.</p>
                </div>
              )}

              {postTab === 'video' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Video URL</Label>
                  <Input
                    className="rounded-xl"
                    placeholder="https://youtube.com/watch?v=... or any video URL"
                    value={videoUrl}
                    onChange={e => setVideoUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Paste a YouTube or direct video URL. YouTube links will be embedded.</p>
                </div>
              )}

              {/* Caption (all post types) */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption (optional)</Label>
                <Input
                  className="rounded-xl text-sm"
                  placeholder="Add a caption…"
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  maxLength={200}
                />
              </div>

              <Button
                onClick={handleShare}
                disabled={sharing}
                className="rounded-xl"
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
                Post
              </Button>
            </div>
          )}
        </Card>

        {/* Invite link */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">Invite a Friend</p>
              <p className="text-xs text-muted-foreground mt-0.5">Share your personal invite link</p>
            </div>
            {!inviteLink && (
              <Button size="sm" variant="outline" className="rounded-lg h-8 text-xs" disabled={inviteLoading} onClick={loadInviteLink}>
                {inviteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Get Link'}
              </Button>
            )}
          </div>
          {inviteLink && (
            <div className="flex items-center gap-2">
              <Input value={inviteLink} readOnly className="rounded-xl text-xs flex-1 bg-muted/30" />
              <Button size="sm" variant="outline" className="rounded-lg h-9 shrink-0" onClick={copyInviteLink}>
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </Card>

        {/* Feed */}
        <div>
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Recent Posts</h2>

          {feedLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : feed.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Rss className="h-8 w-8 opacity-40" />
              <p className="text-sm">Nothing posted yet.</p>
              <p className="text-xs opacity-70">Use the form above to share something.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {feed.map(item => (
                <FeedCard key={item.id} item={item} currentUserId={user?.id} friends={friends} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
