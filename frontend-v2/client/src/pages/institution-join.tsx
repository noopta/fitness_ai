import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Building2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface InviteInfo {
  institutionName: string;
  slug: string;
  role: 'coach' | 'athlete';
}

export default function InstitutionJoinPage() {
  const [match, params] = useRoute('/institution/join/:token');
  const [, navigate] = useLocation();

  const token = params?.token ?? '';

  const [loading, setLoading] = useState(true);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!token) return;
    authFetch(`${API_BASE}/institutions/invite/${token}`)
      .then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any).error || 'Invalid or expired invite link.');
        }
        return res.json();
      })
      .then((data: InviteInfo) => setInviteInfo(data))
      .catch(err => setError(err.message || 'Failed to load invite.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleClaim() {
    if (!inviteInfo) return;
    setClaiming(true);
    try {
      const res = await authFetch(`${API_BASE}/institutions/invite/${token}/claim`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || 'Failed to join institution.');
      }
      const data = await res.json();
      const role = data.role || inviteInfo.role;
      const slug = data.slug || inviteInfo.slug;
      toast.success(`Welcome to ${inviteInfo.institutionName}!`);
      if (role === 'coach') {
        navigate(`/institution/${slug}/coach`);
      } else {
        navigate(`/institution/${slug}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to join.');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-md px-4 py-16 flex flex-col items-center gap-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading invite...</p>
          </div>
        )}

        {!loading && error && (
          <Card className="w-full p-8 flex flex-col items-center gap-4 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <p className="font-semibold text-lg">Invalid Invite</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
            <Button variant="outline" onClick={() => navigate('/')}>
              Go Home
            </Button>
          </Card>
        )}

        {!loading && inviteInfo && (
          <Card className="w-full p-8 flex flex-col items-center gap-6 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
              <Building2 className="h-8 w-8 text-primary" />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You're invited to join</p>
              <h1 className="text-2xl font-bold">{inviteInfo.institutionName}</h1>
              <div className="pt-1">
                <Badge variant="secondary" className="capitalize text-sm px-3 py-0.5">
                  {inviteInfo.role}
                </Badge>
              </div>
            </div>

            <p className="text-sm text-muted-foreground max-w-xs">
              Click the button below to join {inviteInfo.institutionName} as a{inviteInfo.role === 'athlete' ? 'n' : ''} {inviteInfo.role}.
            </p>

            <Button
              size="lg"
              className="w-full rounded-xl text-base font-semibold"
              disabled={claiming}
              onClick={handleClaim}
            >
              {claiming ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-5 w-5 mr-2" />
              )}
              Join {inviteInfo.institutionName}
            </Button>
          </Card>
        )}
      </main>
    </div>
  );
}
