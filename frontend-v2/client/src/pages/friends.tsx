import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Search, UserPlus, Check, X, Trash2, MessageCircle,
  Users, Loader2, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface UserResult {
  id: string;
  name: string | null;
  email: string | null;
}

interface FriendRequest {
  id: string;
  requesterId: string;
  requester: { id: string; name: string | null; email: string | null };
  createdAt: string;
}

interface Friend {
  id: string;
  name: string | null;
  email: string | null;
}

function initials(name: string | null, email: string | null): string {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return '?';
}

export default function FriendsPage() {
  const [, navigate] = useLocation();

  // Search state
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Data state
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Load data on mount
  useEffect(() => {
    async function load() {
      try {
        const [reqRes, frRes] = await Promise.all([
          authFetch(`${API_BASE}/social/friends/requests`),
          authFetch(`${API_BASE}/social/friends`),
        ]);
        if (reqRes.ok) setRequests(await reqRes.json());
        if (frRes.ok) setFriends(await frRes.json());
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Debounced search
  const runSearch = useCallback((q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    authFetch(`${API_BASE}/social/users/search?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setSearchResults(Array.isArray(data) ? data : []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  }, []);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(v), 300);
  }

  async function sendRequest(userId: string) {
    setProcessingIds(prev => new Set(prev).add(userId));
    try {
      const res = await authFetch(`${API_BASE}/social/friends/request`, {
        method: 'POST',
        body: JSON.stringify({ recipientId: userId }),
      });
      if (!res.ok) throw new Error();
      setSentRequests(prev => new Set(prev).add(userId));
      toast.success('Friend request sent!');
    } catch {
      toast.error('Failed to send request.');
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
    }
  }

  async function acceptRequest(requesterId: string) {
    setProcessingIds(prev => new Set(prev).add(requesterId));
    try {
      const res = await authFetch(`${API_BASE}/social/friends/accept`, {
        method: 'POST',
        body: JSON.stringify({ requesterId }),
      });
      if (!res.ok) throw new Error();
      const accepted = requests.find(r => r.requesterId === requesterId);
      setRequests(prev => prev.filter(r => r.requesterId !== requesterId));
      if (accepted) {
        setFriends(prev => [...prev, {
          id: accepted.requester.id,
          name: accepted.requester.name,
          email: accepted.requester.email,
        }]);
      }
      toast.success('Friend request accepted!');
    } catch {
      toast.error('Failed to accept request.');
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(requesterId); return s; });
    }
  }

  async function declineRequest(requesterId: string) {
    setProcessingIds(prev => new Set(prev).add(requesterId));
    try {
      const res = await authFetch(`${API_BASE}/social/friends/decline`, {
        method: 'POST',
        body: JSON.stringify({ requesterId }),
      });
      if (!res.ok) throw new Error();
      setRequests(prev => prev.filter(r => r.requesterId !== requesterId));
      toast.success('Request declined.');
    } catch {
      toast.error('Failed to decline request.');
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(requesterId); return s; });
    }
  }

  async function removeFriend(userId: string) {
    if (!confirm('Remove this friend?')) return;
    setProcessingIds(prev => new Set(prev).add(userId));
    try {
      const res = await authFetch(`${API_BASE}/social/friends/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      setFriends(prev => prev.filter(f => f.id !== userId));
      toast.success('Friend removed.');
    } catch {
      toast.error('Failed to remove friend.');
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
    }
  }

  function messageFriend(friend: Friend) {
    sessionStorage.setItem('message_friend', JSON.stringify({ id: friend.id, name: friend.name, email: friend.email }));
    navigate('/messages');
  }

  const friendIds = new Set(friends.map(f => f.id));
  const requesterIds = new Set(requests.map(r => r.requesterId));

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Friends</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect with others and share your fitness journey.
          </p>
        </div>

        {/* Search */}
        <Card className="p-5 space-y-4">
          <p className="text-sm font-semibold">Find People</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search by name or email..."
              value={query}
              onChange={handleQueryChange}
            />
          </div>

          {searchLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map(u => {
                const isFriend = friendIds.has(u.id);
                const hasPending = requesterIds.has(u.id);
                const alreadySent = sentRequests.has(u.id);
                const busy = processingIds.has(u.id);
                return (
                  <div key={u.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="text-xs">{initials(u.name, u.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{u.name || '(no name)'}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isFriend ? (
                        <Badge variant="secondary" className="text-xs">
                          <UserCheck className="h-3 w-3 mr-1" /> Friends
                        </Badge>
                      ) : hasPending ? (
                        <Badge variant="outline" className="text-xs">Pending</Badge>
                      ) : alreadySent ? (
                        <Badge variant="outline" className="text-xs">Sent</Badge>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => sendRequest(u.id)} className="h-7 text-xs rounded-lg">
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><UserPlus className="h-3 w-3 mr-1" />Add</>}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!searchLoading && query.trim() && searchResults.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">No users found.</p>
          )}
        </Card>

        {/* Friend Requests */}
        {(loading || requests.length > 0) && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground">Friend Requests</h2>
              {requests.length > 0 && (
                <Badge variant="destructive" className="text-xs h-5 px-1.5">{requests.length}</Badge>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Card className="divide-y">
                {requests.map(req => {
                  const busy = processingIds.has(req.requesterId);
                  return (
                    <div key={req.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="text-xs">
                            {initials(req.requester.name, req.requester.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{req.requester.name || '(no name)'}</p>
                          <p className="text-xs text-muted-foreground truncate">{req.requester.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          className="h-8 rounded-lg text-xs"
                          disabled={busy}
                          onClick={() => acceptRequest(req.requesterId)}
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" />Accept</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg text-xs"
                          disabled={busy}
                          onClick={() => declineRequest(req.requesterId)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )}

        {/* Friends List */}
        <div>
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">
            My Friends {!loading && `(${friends.length})`}
          </h2>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : friends.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Users className="h-8 w-8 opacity-40" />
              <p className="text-sm">No friends yet.</p>
              <p className="text-xs opacity-70">Search for people above to send a friend request.</p>
            </Card>
          ) : (
            <Card className="divide-y">
              {friends.map(friend => {
                const busy = processingIds.has(friend.id);
                return (
                  <div key={friend.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-xs">{initials(friend.name, friend.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{friend.name || '(no name)'}</p>
                        <p className="text-xs text-muted-foreground truncate">{friend.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg text-xs"
                        onClick={() => messageFriend(friend)}
                      >
                        <MessageCircle className="h-3 w-3 mr-1" />Message
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() => removeFriend(friend.id)}
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
