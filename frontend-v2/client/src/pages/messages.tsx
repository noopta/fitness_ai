import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Send, Plus, Loader2, MessageSquare, Search, X, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface ConversationParticipant {
  id: string;
  name: string | null;
  email: string | null;
  avatarBase64?: string | null;
}

function avatarSrc(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
}

interface SharedWorkout {
  kind: 'planned' | 'logged';
  title?: string | null;
  focus?: string | null;
  date?: string | null;
  duration?: number | null;
  note?: string | null;
  exercises: Array<{
    name: string;
    sets?: number | null;
    reps?: number | string | null;
    weightLbs?: number | null;
    weightKg?: number | null;
    rpe?: number | null;
    intensity?: string | null;
  }>;
}

function parseSharedWorkout(body: string): SharedWorkout | null {
  try {
    const p = JSON.parse(body);
    if (p && p._workout === true && (p.kind === 'planned' || p.kind === 'logged') && Array.isArray(p.exercises)) {
      return p as SharedWorkout;
    }
  } catch {}
  return null;
}

function workoutExerciseSummary(ex: SharedWorkout['exercises'][number]): string {
  const parts: string[] = [];
  if (ex.sets != null && ex.reps != null) parts.push(`${ex.sets}×${ex.reps}`);
  else if (ex.sets != null) parts.push(`${ex.sets} sets`);
  const weight = ex.weightLbs != null ? `${Math.round(ex.weightLbs)} lb`
    : ex.weightKg != null ? `${Math.round(ex.weightKg)} kg` : null;
  if (weight) parts.push(weight);
  if (ex.rpe != null) parts.push(`RPE ${ex.rpe}`);
  else if (ex.intensity) parts.push(ex.intensity);
  return parts.join(' · ');
}

interface Conversation {
  id: string;
  otherUser: ConversationParticipant;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

interface GroupMemberUser {
  id: string;
  name: string | null;
  username: string | null;
  avatarBase64: string | null;
}
interface GroupMessageT {
  id: string;
  senderId: string | null; // null = Anakin / system
  text: string;
  createdAt: string;
}
interface Group {
  id: string;
  name: string;
  createdAt?: string;
  members?: Array<{ user?: GroupMemberUser }>;
  messages?: GroupMessageT[];
}

// Unified left-list row: 1:1 conversations and group chats interleaved by
// last activity so groups aren't hidden behind a separate surface.
type ChatRow =
  | { kind: 'dm'; sortAt: number; conv: Conversation }
  | { kind: 'group'; sortAt: number; group: Group };

function groupInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || 'G';
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
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MessagesPage() {
  const { user } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);

  const [inputBody, setInputBody] = useState('');
  const [sending, setSending] = useState(false);

  // Mobile: 'list' shows conversation list full-width, 'chat' shows the chat panel
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const [showNewModal, setShowNewModal] = useState(false);
  const [newSearchQuery, setNewSearchQuery] = useState('');
  const [newSearchResults, setNewSearchResults] = useState<ConversationParticipant[]>([]);
  const [newSearchLoading, setNewSearchLoading] = useState(false);
  const [creatingConv, setCreatingConv] = useState(false);

  // Group chats
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<Group | null>(null);
  const [groupMsgsLoading, setGroupMsgsLoading] = useState(false);
  const [groupInput, setGroupInput] = useState('');
  const [sendingGroup, setSendingGroup] = useState(false);
  const groupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);
  const newSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function selectConversation(id: string) {
    setSelectedGroupId(null);
    setSelectedId(id);
    setMobileView('chat');
  }

  function selectGroup(id: string) {
    setSelectedId(null);
    setSelectedGroupId(id);
    setMobileView('chat');
  }

  async function loadGroups() {
    try {
      // Flag-gated server-side — a 404 just means the group surface is off.
      const res = await authFetch(`${API_BASE}/groups`);
      if (res.ok) {
        const data = await res.json();
        const list: Group[] = Array.isArray(data) ? data : (data.groups ?? []);
        setGroups(list);
      }
    } catch { /* ignore — DM list still renders */ }
  }

  // Load the selected group's detail (members + messages) and poll for updates.
  useEffect(() => {
    if (!selectedGroupId) return;
    setGroupMsgsLoading(true);
    setGroupDetail(null);

    const fetchDetail = () =>
      authFetch(`${API_BASE}/groups/${selectedGroupId}`)
        .then(r => (r.ok ? r.json() : null))
        .then((data) => { if (data?.group) setGroupDetail(data.group); })
        .catch(() => {});

    fetchDetail().finally(() => setGroupMsgsLoading(false));

    if (groupPollRef.current) clearInterval(groupPollRef.current);
    groupPollRef.current = setInterval(fetchDetail, 3000);
    return () => { if (groupPollRef.current) clearInterval(groupPollRef.current); };
  }, [selectedGroupId]);

  async function sendGroupMessage() {
    if (!selectedGroupId || !groupInput.trim()) return;
    setSendingGroup(true);
    const text = groupInput.trim();
    setGroupInput('');
    try {
      const res = await authFetch(`${API_BASE}/groups/${selectedGroupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const msg: GroupMessageT | undefined = data.message;
      if (msg) {
        setGroupDetail(prev => prev ? { ...prev, messages: [...(prev.messages ?? []), msg] } : prev);
      }
    } catch {
      toast.error('Failed to send message.');
      setGroupInput(text);
    } finally {
      setSendingGroup(false);
    }
  }

  // Load conversations + groups on mount; also check sessionStorage for a
  // pre-selected friend.
  useEffect(() => {
    loadGroups();
    loadConversations().then(() => {
      const stored = sessionStorage.getItem('message_friend');
      if (stored) {
        sessionStorage.removeItem('message_friend');
        try {
          const friend = JSON.parse(stored) as { id: string; name: string | null; email: string | null };
          setConversations(prev => {
            const existing = prev.find(c => c.otherUser.id === friend.id);
            if (existing) {
              selectConversation(existing.id);
            } else {
              createConversationWith(friend.id);
            }
            return prev;
          });
        } catch { /* ignore */ }
      }
    });
  }, []);

  async function loadConversations() {
    try {
      const res = await authFetch(`${API_BASE}/social/conversations`);
      if (res.ok) {
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
        return Array.isArray(data) ? data : [];
      }
    } catch { /* ignore */ }
    finally { setConvsLoading(false); }
    return [];
  }

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selectedId) return;
    setMsgsLoading(true);
    setMessages([]);

    authFetch(`${API_BASE}/social/conversations/${selectedId}/messages`)
      .then(r => r.ok ? r.json() : [])
      .then((data: Message[]) => {
        setMessages(Array.isArray(data) ? data : []);
        if (data.length > 0) lastMsgIdRef.current = data[data.length - 1].id;
      })
      .catch(() => {})
      .finally(() => setMsgsLoading(false));

    authFetch(`${API_BASE}/social/conversations/${selectedId}/read`, { method: 'POST' }).catch(() => {});

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollMessages(selectedId), 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, groupDetail?.messages]);

  async function pollMessages(convId: string) {
    const after = lastMsgIdRef.current;
    const url = after
      ? `${API_BASE}/social/conversations/${convId}/poll?after=${after}`
      : `${API_BASE}/social/conversations/${convId}/poll`;
    try {
      const res = await authFetch(url);
      if (!res.ok) return;
      const data: Message[] = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = data.filter(m => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;
          lastMsgIdRef.current = newMsgs[newMsgs.length - 1].id;
          return [...prev, ...newMsgs];
        });
        setConversations(prev =>
          prev.map(c => c.id === convId ? { ...c, unreadCount: 0, lastMessage: data[data.length - 1].body, lastMessageAt: data[data.length - 1].createdAt } : c)
        );
        authFetch(`${API_BASE}/social/conversations/${convId}/read`, { method: 'POST' }).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  async function sendMessage() {
    if (!selectedId || !inputBody.trim()) return;
    setSending(true);
    const body = inputBody.trim();
    setInputBody('');
    try {
      const res = await authFetch(`${API_BASE}/social/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error();
      const msg: Message = await res.json();
      lastMsgIdRef.current = msg.id;
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setConversations(prev =>
        prev.map(c => c.id === selectedId ? { ...c, lastMessage: body, lastMessageAt: msg.createdAt } : c)
      );
    } catch {
      toast.error('Failed to send message.');
      setInputBody(body);
    } finally {
      setSending(false);
    }
  }

  async function createConversationWith(participantId: string) {
    setCreatingConv(true);
    try {
      const res = await authFetch(`${API_BASE}/social/conversations`, {
        method: 'POST',
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) throw new Error();
      const conv: Conversation = await res.json();
      setConversations(prev => {
        const exists = prev.find(c => c.id === conv.id);
        return exists ? prev : [conv, ...prev];
      });
      selectConversation(conv.id);
      setShowNewModal(false);
      setNewSearchQuery('');
      setNewSearchResults([]);
    } catch {
      toast.error('Failed to start conversation.');
    } finally {
      setCreatingConv(false);
    }
  }

  const runNewSearch = useCallback((q: string) => {
    if (!q.trim()) { setNewSearchResults([]); return; }
    setNewSearchLoading(true);
    authFetch(`${API_BASE}/social/users/search?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setNewSearchResults(Array.isArray(data) ? data : []))
      .catch(() => setNewSearchResults([]))
      .finally(() => setNewSearchLoading(false));
  }, []);

  function handleNewSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setNewSearchQuery(v);
    if (newSearchDebounceRef.current) clearTimeout(newSearchDebounceRef.current);
    newSearchDebounceRef.current = setTimeout(() => runNewSearch(v), 300);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') sendMessage();
  }

  const selectedConv = conversations.find(c => c.id === selectedId);
  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  // Merge DMs + groups, newest activity first.
  const rows: ChatRow[] = (() => {
    const dmRows: ChatRow[] = conversations.map(conv => ({
      kind: 'dm',
      sortAt: conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0,
      conv,
    }));
    const groupRows: ChatRow[] = groups.map(group => {
      const last = group.messages?.[group.messages.length - 1] ?? group.messages?.[0];
      const sortAt = last?.createdAt
        ? new Date(last.createdAt).getTime()
        : (group.createdAt ? new Date(group.createdAt).getTime() : 0);
      return { kind: 'group', sortAt, group };
    });
    return [...dmRows, ...groupRows].sort((a, b) => b.sortAt - a.sortAt);
  })();

  // Resolve a group message sender to display info (avatar + name).
  function groupSender(senderId: string | null): { name: string; avatar?: string; isAnakin: boolean } {
    if (senderId === null) return { name: 'Anakin', isAnakin: true };
    const member = groupDetail?.members?.find(m => m.user?.id === senderId)?.user;
    return {
      name: member?.name || (member?.username ? `@${member.username}` : 'Member'),
      avatar: avatarSrc(member?.avatarBase64),
      isAnakin: false,
    };
  }

  return (
    <div className="bg-background flex flex-col" style={{ height: '100dvh' }}>
      <Navbar variant="full" />

      {/* Two-panel layout: stacked on mobile, side-by-side on md+ */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex w-full h-full mx-auto max-w-5xl">

          {/* Left panel — always visible on md+, hidden on mobile when chat is open */}
          <div className={`
            flex flex-col gap-3 p-4
            w-full md:w-72 md:shrink-0
            ${mobileView === 'chat' ? 'hidden md:flex' : 'flex'}
          `}>
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold">Messages</h1>
              <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => setShowNewModal(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />New
              </Button>
            </div>

            <Card className="flex-1 overflow-y-auto divide-y">
              {convsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground px-4 text-center">
                  <MessageSquare className="h-7 w-7 opacity-40" />
                  <p className="text-sm">No conversations yet.</p>
                  <p className="text-xs opacity-70">Click "New" to start one.</p>
                </div>
              ) : (
                rows.map(row => row.kind === 'dm' ? (
                  <button
                    key={`dm-${row.conv.id}`}
                    onClick={() => selectConversation(row.conv.id)}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-muted/30 transition-colors ${selectedId === row.conv.id ? 'bg-muted/50' : ''}`}
                  >
                    <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                      {avatarSrc(row.conv.otherUser.avatarBase64) && <AvatarImage src={avatarSrc(row.conv.otherUser.avatarBase64)} alt="" />}
                      <AvatarFallback className="text-xs">{initials(row.conv.otherUser.name, row.conv.otherUser.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-sm font-medium truncate">{row.conv.otherUser.name || row.conv.otherUser.email || 'User'}</p>
                        {row.conv.lastMessageAt && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(row.conv.lastMessageAt)}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <p className="text-xs text-muted-foreground truncate">{row.conv.lastMessage || 'No messages yet'}</p>
                        {row.conv.unreadCount > 0 && (
                          <Badge className="h-4 px-1.5 text-[10px] shrink-0">{row.conv.unreadCount}</Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ) : (() => {
                  const last = row.group.messages?.[row.group.messages.length - 1] ?? row.group.messages?.[0];
                  const preview = last
                    ? (last.senderId === null ? `Anakin: ${last.text}` : last.text)
                    : `${row.group.members?.length ?? 0} members`;
                  return (
                    <button
                      key={`group-${row.group.id}`}
                      onClick={() => selectGroup(row.group.id)}
                      className={`w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-muted/30 transition-colors ${selectedGroupId === row.group.id ? 'bg-muted/50' : ''}`}
                    >
                      <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                        <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                          {groupInitials(row.group.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium truncate">{row.group.name}</p>
                          {last?.createdAt && (
                            <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(last.createdAt)}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
                      </div>
                    </button>
                  );
                })())
              )}
            </Card>
          </div>

          {/* Right panel — always visible on md+, hidden on mobile when list is shown */}
          <Card className={`
            flex flex-col overflow-hidden flex-1
            rounded-none md:rounded-lg md:my-4 md:mr-4
            ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}
          `}>
            {selectedGroupId ? (
              <>
                {/* Group header */}
                <div className="px-4 py-3 border-b flex items-center gap-3 shrink-0">
                  <button
                    className="md:hidden p-1 -ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setMobileView('list')}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                      {groupInitials(selectedGroup?.name ?? 'G')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{selectedGroup?.name ?? 'Group'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {(groupDetail?.members?.length ?? selectedGroup?.members?.length ?? 0)} members
                    </p>
                  </div>
                </div>

                {/* Group messages — avatar beside each sender */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {groupMsgsLoading && !groupDetail ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (groupDetail?.messages?.length ?? 0) === 0 ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                      <p className="text-sm">No messages yet. Say hello!</p>
                    </div>
                  ) : (
                    groupDetail!.messages!.map(msg => {
                      const isMine = msg.senderId === user?.id;
                      const sender = groupSender(msg.senderId);
                      return (
                        <div key={msg.id} className={`flex gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
                          {!isMine && (
                            <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                              {sender.avatar && <AvatarImage src={sender.avatar} alt="" />}
                              <AvatarFallback className={`text-[10px] ${sender.isAnakin ? 'bg-foreground text-background' : ''}`}>
                                {sender.isAnakin ? 'A' : groupInitials(sender.name)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className={`max-w-[72%] rounded-2xl px-3.5 py-2 text-sm ${
                            isMine
                              ? 'bg-primary text-primary-foreground rounded-br-sm'
                              : sender.isAnakin
                                ? 'bg-foreground/5 border border-foreground/15 rounded-bl-sm'
                                : 'bg-muted rounded-bl-sm'
                          }`}>
                            {!isMine && (
                              <p className={`text-[10px] font-semibold mb-0.5 ${sender.isAnakin ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {sender.name}
                              </p>
                            )}
                            <p className="break-words">{msg.text}</p>
                            <p className={`text-[10px] mt-1 ${isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                              {relativeTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Group input */}
                <div className="px-4 py-3 border-t flex items-center gap-2 shrink-0">
                  <Input
                    className="flex-1 rounded-xl"
                    placeholder="Message the group..."
                    value={groupInput}
                    onChange={e => setGroupInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendGroupMessage(); }}
                    disabled={sendingGroup}
                  />
                  <Button
                    size="sm"
                    className="rounded-xl h-9 px-3 shrink-0"
                    disabled={sendingGroup || !groupInput.trim()}
                    onClick={sendGroupMessage}
                  >
                    {sendingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            ) : !selectedId ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-8">
                <MessageSquare className="h-10 w-10 opacity-30" />
                <p className="text-sm">Select a conversation to start chatting.</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="px-4 py-3 border-b flex items-center gap-3 shrink-0">
                  {/* Back arrow — mobile only */}
                  <button
                    className="md:hidden p-1 -ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setMobileView('list')}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <Avatar className="h-8 w-8">
                    {selectedConv && avatarSrc(selectedConv.otherUser.avatarBase64) && (
                      <AvatarImage src={avatarSrc(selectedConv.otherUser.avatarBase64)} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {selectedConv ? initials(selectedConv.otherUser.name, selectedConv.otherUser.email) : '?'}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-sm font-semibold truncate">
                    {selectedConv?.otherUser.name || selectedConv?.otherUser.email || 'Conversation'}
                  </p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {msgsLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                      <p className="text-sm">No messages yet. Say hello!</p>
                    </div>
                  ) : (
                    messages.map(msg => {
                      const isMine = msg.senderId === user?.id;
                      const wo = parseSharedWorkout(msg.body);
                      if (wo) {
                        return (
                          <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm border ${isMine ? 'bg-primary/10 border-primary/30' : 'bg-muted border-border'}`}>
                              <p className="text-[10px] font-bold tracking-wide text-muted-foreground mb-1">
                                💪 {wo.kind === 'planned' ? 'PLANNED WORKOUT' : 'LOGGED WORKOUT'}
                                {wo.focus ? ` · ${wo.focus}` : ''}
                              </p>
                              {wo.note && <p className="text-xs italic mb-1">{wo.note}</p>}
                              <p className="font-semibold text-sm">{wo.title || (wo.kind === 'planned' ? "Today's workout" : 'Workout')}</p>
                              {wo.date && <p className="text-xs text-muted-foreground">{wo.date}{wo.duration ? ` · ${wo.duration} min` : ''}</p>}
                              <ul className="mt-1.5 space-y-0.5">
                                {wo.exercises.slice(0, 5).map((ex, i) => (
                                  <li key={i} className="text-xs truncate">
                                    • {ex.name}{workoutExerciseSummary(ex) ? ` — ${workoutExerciseSummary(ex)}` : ''}
                                  </li>
                                ))}
                                {wo.exercises.length > 5 && (
                                  <li className="text-xs text-muted-foreground">+ {wo.exercises.length - 5} more</li>
                                )}
                              </ul>
                              <p className={`text-[10px] mt-2 ${isMine ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                                {relativeTime(msg.createdAt)}
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'}`}>
                            <p className="break-words">{msg.body}</p>
                            <p className={`text-[10px] mt-1 ${isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                              {relativeTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div className="px-4 py-3 border-t flex items-center gap-2 shrink-0">
                  <Input
                    className="flex-1 rounded-xl"
                    placeholder="Type a message..."
                    value={inputBody}
                    onChange={e => setInputBody(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                  />
                  <Button
                    size="sm"
                    className="rounded-xl h-9 px-3 shrink-0"
                    disabled={sending || !inputBody.trim()}
                    onClick={sendMessage}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            )}
          </Card>

        </div>
      </div>

      {/* New Conversation Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <Card className="w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">New Conversation</p>
              <button onClick={() => { setShowNewModal(false); setNewSearchQuery(''); setNewSearchResults([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Search by name or email..."
                value={newSearchQuery}
                onChange={handleNewSearchChange}
                autoFocus
              />
            </div>

            {newSearchLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {!newSearchLoading && newSearchResults.length > 0 && (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {newSearchResults.map(u => (
                  <button
                    key={u.id}
                    disabled={creatingConv}
                    onClick={() => createConversationWith(u.id)}
                    className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 hover:bg-muted/30 transition-colors text-left disabled:opacity-50"
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs">{initials(u.name, u.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name || '(no name)'}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    {creatingConv && <Loader2 className="h-4 w-4 animate-spin ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            )}

            {!newSearchLoading && newSearchQuery.trim() && newSearchResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No users found.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
