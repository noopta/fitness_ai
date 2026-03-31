import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Building2, Users, UserPlus, Copy, Check,
  Loader2, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Athlete {
  id: string;
  name: string | null;
  email: string | null;
}

interface InstitutionInfo {
  name: string;
  logoUrl: string | null;
  slug: string;
}

function initials(name: string | null, email: string | null): string {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return '?';
}

export default function InstitutionCoachPage() {
  const [match, params] = useRoute('/institution/:slug/coach');
  const [, navigate] = useLocation();

  const slug = params?.slug ?? '';

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [institution, setInstitution] = useState<InstitutionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) return;
    async function load() {
      try {
        const res = await authFetch(`${API_BASE}/institutions/${slug}/athletes`);
        if (res.ok) {
          const data = await res.json();
          if (data.institution) setInstitution(data.institution);
          else setInstitution({ name: slug, logoUrl: null, slug });
          setAthletes(Array.isArray(data.athletes) ? data.athletes : Array.isArray(data) ? data : []);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  async function handleInvite() {
    setInviting(true);
    try {
      const res = await authFetch(`${API_BASE}/institutions/${slug}/invite`, {
        method: 'POST',
        body: JSON.stringify({ role: 'athlete' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const link = data.link || data.url || data.inviteLink || data.inviteUrl || JSON.stringify(data);
      setInviteLink(link);
      toast.success('Invite link generated!');
    } catch {
      toast.error('Failed to generate invite link.');
    } finally {
      setInviting(false);
    }
  }

  async function copyLink() {
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

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-8">
        {/* Institution header */}
        <div className="flex items-center gap-4">
          {institution?.logoUrl ? (
            <img src={institution.logoUrl} alt={institution.name} className="h-14 w-14 rounded-2xl object-cover border" />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 border">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Coach Dashboard</p>
            <h1 className="text-2xl font-bold">{institution?.name || slug}</h1>
          </div>
        </div>

        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-4 flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Total Athletes</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold">{athletes.length}</span>
                <Users className="h-5 w-5 text-muted-foreground mb-1" />
              </div>
            </Card>
          </div>
        )}

        {/* Invite Athlete */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">Invite Athlete</p>
              <p className="text-xs text-muted-foreground mt-0.5">Generate a link to invite an athlete to your institution</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg h-8 text-xs shrink-0"
              disabled={inviting}
              onClick={handleInvite}
            >
              {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><UserPlus className="h-3.5 w-3.5 mr-1" />Generate Link</>}
            </Button>
          </div>
          {inviteLink && (
            <div className="flex items-center gap-2">
              <Input value={inviteLink} readOnly className="rounded-xl text-xs flex-1 bg-muted/30" />
              <Button size="sm" variant="outline" className="rounded-lg h-9 shrink-0" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </Card>

        {/* Athletes list */}
        <div>
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">
            Athletes {!loading && `(${athletes.length})`}
          </h2>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : athletes.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Users className="h-8 w-8 opacity-40" />
              <p className="text-sm">No athletes yet.</p>
              <p className="text-xs opacity-70">Use the invite link above to add athletes.</p>
            </Card>
          ) : (
            <Card className="divide-y">
              {athletes.map(athlete => (
                <div key={athlete.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="text-xs">{initials(athlete.name, athlete.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{athlete.name || '(no name)'}</p>
                      <p className="text-xs text-muted-foreground truncate">{athlete.email}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg h-8 text-xs shrink-0"
                    onClick={() => navigate(`/institution/${slug}/athlete/${athlete.id}`)}
                  >
                    View Profile
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
