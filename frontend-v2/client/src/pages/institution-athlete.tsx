import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Building2, MessageCircle, Loader2, UserRound } from 'lucide-react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface CoachInfo {
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

export default function InstitutionAthletePage() {
  const [match, params] = useRoute('/institution/:slug');
  const [, navigate] = useLocation();

  const slug = params?.slug ?? '';

  const [coaches, setCoaches] = useState<CoachInfo[]>([]);
  const [institution, setInstitution] = useState<InstitutionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    async function load() {
      try {
        const res = await authFetch(`${API_BASE}/institutions/${slug}/coach-info`);
        if (res.ok) {
          const data = await res.json();
          // Response may include institution info and coaches array
          if (data.institution) setInstitution(data.institution);
          else setInstitution({ name: slug, logoUrl: null, slug });
          setCoaches(Array.isArray(data.coaches) ? data.coaches : Array.isArray(data) ? data : []);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug]);

  function messageCoach(coach: CoachInfo) {
    sessionStorage.setItem('message_friend', JSON.stringify({ id: coach.id, name: coach.name, email: coach.email }));
    navigate('/messages');
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
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">My Institution</p>
            <h1 className="text-2xl font-bold">{institution?.name || slug}</h1>
          </div>
        </div>

        {/* Coaches section */}
        <div>
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Coaching Staff</h2>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : coaches.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <UserRound className="h-8 w-8 opacity-40" />
              <p className="text-sm">No coaches listed yet.</p>
            </Card>
          ) : (
            <Card className="divide-y">
              {coaches.map(coach => (
                <div key={coach.id} className="flex items-center justify-between gap-3 px-4 py-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="text-sm">{initials(coach.name, coach.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{coach.name || '(no name)'}</p>
                      <p className="text-xs text-muted-foreground truncate">{coach.email}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg h-8 text-xs shrink-0"
                    onClick={() => messageCoach(coach)}
                  >
                    <MessageCircle className="h-3.5 w-3.5 mr-1" />
                    Message Coach
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
