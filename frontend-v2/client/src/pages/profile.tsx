import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ContributionGraph } from '@/components/ContributionGraph';
import { UserPlus, MessageCircle, Settings, Users, Loader2, UserCheck, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface ProfileData {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    tier: string;
    createdAt: string;
  };
  isFriend: boolean;
  friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'blocked';
  mutualFriendsCount: number;
}

function initials(name: string | null, email: string | null): string {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return '?';
}

function formatMemberSince(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfilePage() {
  const [, params] = useRoute('/profile/:userId');
  const [, navigate] = useLocation();
  const { user: currentUser } = useAuth();

  const userId = params?.userId ?? '';
  const isSelf = !!currentUser && currentUser.id === userId;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [friendshipStatus, setFriendshipStatus] = useState<ProfileData['friendshipStatus']>('none');

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    authFetch(`${API_BASE}/social/profile/${encodeURIComponent(userId)}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load profile');
        return r.json();
      })
      .then((data: ProfileData) => {
        setProfile(data);
        setFriendshipStatus(data.friendshipStatus);
      })
      .catch(() => toast.error('Could not load profile.'))
      .finally(() => setLoading(false));
  }, [userId]);

  async function sendFriendRequest() {
    setActionBusy(true);
    try {
      const res = await authFetch(`${API_BASE}/social/friends/request`, {
        method: 'POST',
        body: JSON.stringify({ targetUserId: userId }),
      });
      if (!res.ok) throw new Error();
      setFriendshipStatus('pending_sent');
      toast.success('Friend request sent!');
    } catch {
      toast.error('Failed to send friend request.');
    } finally {
      setActionBusy(false);
    }
  }

  function handleMessage() {
    if (!profile) return;
    sessionStorage.setItem('message_friend', JSON.stringify({
      id: profile.user.id,
      name: profile.user.name,
      email: profile.user.email,
    }));
    navigate('/messages');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar variant="full" />
        <main className="mx-auto max-w-2xl px-4 py-16 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar variant="full" />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <p className="text-muted-foreground">Profile not found.</p>
        </main>
      </div>
    );
  }

  const { user } = profile;
  const displayName = user.name || user.email || 'Unknown User';

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-6">

        {/* Profile card */}
        <Card className="p-6">
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
            {/* Avatar */}
            <Avatar className="h-20 w-20 shrink-0 text-2xl">
              <AvatarFallback className="text-xl font-semibold">
                {initials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold truncate">{displayName}</h1>
                <Badge
                  variant={user.tier === 'pro' || user.tier === 'enterprise' ? 'default' : 'secondary'}
                  className="text-xs capitalize"
                >
                  {user.tier === 'enterprise' ? 'Pro' : user.tier === 'pro' ? 'Pro' : 'Free'}
                </Badge>
              </div>

              {user.name && user.email && (
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{user.email}</p>
              )}

              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Member since {formatMemberSince(user.createdAt)}</span>
              </div>

              {!isSelf && profile.mutualFriendsCount > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  <span>
                    {profile.mutualFriendsCount} mutual friend{profile.mutualFriendsCount !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isSelf ? (
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => navigate('/settings')}
              >
                <Settings className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
            ) : (
              <>
                {friendshipStatus === 'accepted' ? (
                  <Badge variant="secondary" className="px-3 py-1.5 text-sm rounded-xl">
                    <UserCheck className="h-4 w-4 mr-1.5" /> Friends
                  </Badge>
                ) : friendshipStatus === 'pending_sent' ? (
                  <Badge variant="outline" className="px-3 py-1.5 text-sm rounded-xl">
                    <Clock className="h-4 w-4 mr-1.5" /> Request Sent
                  </Badge>
                ) : friendshipStatus === 'pending_received' ? (
                  <Badge variant="outline" className="px-3 py-1.5 text-sm rounded-xl">
                    Respond in Friends
                  </Badge>
                ) : friendshipStatus !== 'blocked' && (
                  <Button
                    className="rounded-xl"
                    disabled={actionBusy}
                    onClick={sendFriendRequest}
                  >
                    {actionBusy
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <><UserPlus className="h-4 w-4 mr-2" /> Add Friend</>}
                  </Button>
                )}

                {friendshipStatus !== 'blocked' && (
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleMessage}
                  >
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Message
                  </Button>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Activity */}
        <Card className="p-6">
          <h2 className="text-sm font-semibold mb-4">Workout Activity</h2>
          <ContributionGraph userId={userId} />
        </Card>

      </main>
    </div>
  );
}
