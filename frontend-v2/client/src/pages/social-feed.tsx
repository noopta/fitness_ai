import { useEffect, useState, useRef, useCallback } from 'react';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Share2, Copy, Check, Loader2, Search, ChevronDown,
  Dumbbell, Apple, Trophy, Rss,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

type ItemType = 'workout' | 'nutrition' | 'pr';

interface SharedFeedItem {
  id: string;
  sharerId: string;
  sharer: { id: string; name: string | null; email: string | null };
  recipientId: string;
  itemType: ItemType;
  payload: { description?: string; data?: any };
  createdAt: string;
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

function itemTypeIcon(type: ItemType) {
  switch (type) {
    case 'workout': return <Dumbbell className="h-3.5 w-3.5" />;
    case 'nutrition': return <Apple className="h-3.5 w-3.5" />;
    case 'pr': return <Trophy className="h-3.5 w-3.5" />;
  }
}

function itemTypeColor(type: ItemType): string {
  switch (type) {
    case 'workout': return 'bg-blue-100 text-blue-700';
    case 'nutrition': return 'bg-green-100 text-green-700';
    case 'pr': return 'bg-amber-100 text-amber-700';
  }
}

export default function SocialFeedPage() {
  const [feed, setFeed] = useState<SharedFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Share form state
  const [shareOpen, setShareOpen] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<UserResult[]>([]);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<UserResult | null>(null);
  const [itemType, setItemType] = useState<ItemType>('workout');
  const [description, setDescription] = useState('');
  const [sharing, setSharing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    authFetch(`${API_BASE}/social/shared-feed`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setFeed(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setFeedLoading(false));
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

  async function handleShare() {
    if (!selectedRecipient) { toast.error('Select a recipient first.'); return; }
    if (!description.trim()) { toast.error('Add a description.'); return; }
    setSharing(true);
    try {
      const res = await authFetch(`${API_BASE}/social/share`, {
        method: 'POST',
        body: JSON.stringify({
          recipientId: selectedRecipient.id,
          itemType,
          payload: { description: description.trim(), data: {} },
        }),
      });
      if (!res.ok) throw new Error();
      const newItem: SharedFeedItem = await res.json();
      setFeed(prev => [newItem, ...prev]);
      setDescription('');
      setSelectedRecipient(null);
      setRecipientQuery('');
      setRecipientResults([]);
      setItemType('workout');
      setShareOpen(false);
      toast.success('Shared successfully!');
    } catch {
      toast.error('Failed to share.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Social Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Share your workouts, nutrition, and PRs with friends.
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
                <p className="text-xs text-muted-foreground">Send a workout, nutrition log, or PR to a friend</p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${shareOpen ? 'rotate-180' : ''}`} />
          </button>

          {shareOpen && (
            <div className="px-5 pb-5 border-t pt-4 space-y-4">
              {/* Recipient search */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipient</Label>
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
                      Change
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
                    {recipientLoading && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
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

              {/* Item Type */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</Label>
                <div className="flex gap-2">
                  {(['workout', 'nutrition', 'pr'] as ItemType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => setItemType(t)}
                      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${itemType === t ? 'border-primary bg-primary/10 text-primary font-semibold' : 'hover:bg-muted/30'}`}
                    >
                      {itemTypeIcon(t)}
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</Label>
                <textarea
                  rows={3}
                  placeholder="What do you want to share? (e.g. Hit a new squat PR today — 315 lbs!)"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <Button onClick={handleShare} disabled={sharing || !selectedRecipient} className="rounded-xl">
                {sharing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
                Share
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
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Recent Shares</h2>

          {feedLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : feed.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Rss className="h-8 w-8 opacity-40" />
              <p className="text-sm">Nothing shared yet.</p>
              <p className="text-xs opacity-70">Use the form above to share with a friend.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {feed.map(item => (
                <Card key={item.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-xs">{initials(item.sharer.name, item.sharer.email)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-semibold">{item.sharer.name || item.sharer.email || 'Someone'}</p>
                        <p className="text-xs text-muted-foreground">{relativeTime(item.createdAt)}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${itemTypeColor(item.itemType)}`}>
                      {itemTypeIcon(item.itemType)}
                      {item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1)}
                    </span>
                  </div>
                  {item.payload?.description && (
                    <p className="text-sm text-foreground/90 rounded-xl bg-muted/40 px-3 py-2.5">{item.payload.description}</p>
                  )}
                  {item.payload?.data && Object.keys(item.payload.data).length > 0 && (
                    <div className="rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {Object.entries(item.payload.data).map(([k, v]) => (
                        <div key={k}><span className="font-semibold">{k}:</span> {String(v)}</div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
