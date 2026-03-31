import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dumbbell, Send, Loader2, User, Activity,
  Heart, Moon, Zap, Weight, TrendingUp, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface WorkoutLog {
  id: string;
  date: string;
  title: string | null;
  exercises: Array<{ name: string }>;
}

interface TopLift {
  canonicalName: string;
  current1RMLbs: number;
  strengthTier?: string;
}

interface WellnessCheckin {
  id: string;
  date: string;
  mood: number | null;
  energy: number | null;
  sleep: number | null;
}

interface BodyWeightLog {
  id: string;
  date: string;
  weightLbs: number;
}

interface AthleteData {
  id: string;
  name: string | null;
  email: string | null;
  recentWorkouts: WorkoutLog[];
  strengthSummary: {
    overallStrengthIndex: number | null;
    strengthTier: string;
    topLifts: TopLift[];
  } | null;
  recentWellness: WellnessCheckin[];
  bodyWeightLogs: BodyWeightLog[];
}

function initials(name: string | null, email: string | null): string {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return '?';
}

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function tierColor(tier: string): string {
  switch (tier?.toLowerCase()) {
    case 'elite': return 'bg-purple-100 text-purple-700';
    case 'advanced': return 'bg-blue-100 text-blue-700';
    case 'intermediate': return 'bg-green-100 text-green-700';
    case 'beginner': return 'bg-amber-100 text-amber-700';
    default: return 'bg-muted text-muted-foreground';
  }
}

export default function InstitutionAthleteDetailPage() {
  const [match, params] = useRoute('/institution/:slug/athlete/:userId');
  const [, navigate] = useLocation();

  const slug = params?.slug ?? '';
  const userId = params?.userId ?? '';

  const [athlete, setAthlete] = useState<AthleteData | null>(null);
  const [loading, setLoading] = useState(true);

  const [messageBody, setMessageBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!slug || !userId) return;
    authFetch(`${API_BASE}/institutions/${slug}/athletes/${userId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setAthlete(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug, userId]);

  async function sendMessage() {
    if (!messageBody.trim()) return;
    setSending(true);
    const body = messageBody.trim();
    setMessageBody('');
    try {
      const res = await authFetch(`${API_BASE}/institutions/${slug}/athletes/${userId}/message`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error();
      toast.success('Message sent!');
      navigate('/messages');
    } catch {
      toast.error('Failed to send message.');
      setMessageBody(body);
    } finally {
      setSending(false);
    }
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

  if (!athlete) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar variant="full" />
        <main className="mx-auto max-w-2xl px-4 py-16 flex flex-col items-center gap-4 text-muted-foreground">
          <User className="h-10 w-10 opacity-30" />
          <p className="text-sm">Athlete not found.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(`/institution/${slug}/coach`)}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
        </main>
      </div>
    );
  }

  const topLifts = athlete.strengthSummary?.topLifts?.slice(0, 4) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-8">
        {/* Back */}
        <button
          onClick={() => navigate(`/institution/${slug}/coach`)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Roster
        </button>

        {/* Athlete header */}
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="text-lg">{initials(athlete.name, athlete.email)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{athlete.name || '(no name)'}</h1>
            <p className="text-sm text-muted-foreground">{athlete.email}</p>
          </div>
        </div>

        {/* Message athlete */}
        <Card className="p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Message Athlete
          </p>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1 rounded-xl"
              placeholder="Type a message..."
              value={messageBody}
              onChange={e => setMessageBody(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              disabled={sending}
            />
            <Button
              size="sm"
              className="rounded-xl h-9 px-3 shrink-0"
              disabled={sending || !messageBody.trim()}
              onClick={sendMessage}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </Card>

        {/* Strength Summary */}
        {athlete.strengthSummary && (
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Strength Summary</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Card className="p-4 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Strength Index</p>
                <p className="text-3xl font-bold">
                  {athlete.strengthSummary.overallStrengthIndex != null
                    ? athlete.strengthSummary.overallStrengthIndex
                    : '—'}
                </p>
                <p className="text-xs text-muted-foreground">out of 100</p>
              </Card>
              <Card className="p-4 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tier</p>
                <div className="pt-1">
                  <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${tierColor(athlete.strengthSummary.strengthTier)}`}>
                    {athlete.strengthSummary.strengthTier || '—'}
                  </span>
                </div>
              </Card>
            </div>
            {topLifts.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {topLifts.map(lift => (
                  <Card key={lift.canonicalName} className="p-3 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">{lift.canonicalName}</p>
                    <p className="text-xl font-bold">{lift.current1RMLbs} <span className="text-sm font-normal text-muted-foreground">lbs</span></p>
                    <p className="text-[10px] text-muted-foreground">Estimated 1RM</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Workouts */}
        <div>
          <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Recent Workouts</h2>
          {athlete.recentWorkouts.length === 0 ? (
            <Card className="p-6 flex flex-col items-center gap-2 text-center text-muted-foreground">
              <Dumbbell className="h-6 w-6 opacity-40" />
              <p className="text-sm">No workouts logged yet.</p>
            </Card>
          ) : (
            <Card className="divide-y">
              {athlete.recentWorkouts.map(log => (
                <div key={log.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Dumbbell className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{log.title || 'Workout Session'}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(log.date)}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {log.exercises.length} exercises
                  </Badge>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Recent Wellness */}
        {athlete.recentWellness.length > 0 && (
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Recent Wellness Check-ins</h2>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="flex items-center justify-center gap-1"><Heart className="h-3 w-3" />Mood</div>
                      </th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="flex items-center justify-center gap-1"><Zap className="h-3 w-3" />Energy</div>
                      </th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="flex items-center justify-center gap-1"><Moon className="h-3 w-3" />Sleep</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {athlete.recentWellness.map(w => (
                      <tr key={w.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(w.date)}</td>
                        <td className="px-4 py-3 text-center">
                          {w.mood != null ? (
                            <span className="font-semibold text-sm">{w.mood}<span className="text-xs text-muted-foreground font-normal">/10</span></span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {w.energy != null ? (
                            <span className="font-semibold text-sm">{w.energy}<span className="text-xs text-muted-foreground font-normal">/10</span></span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {w.sleep != null ? (
                            <span className="font-semibold text-sm">{w.sleep}<span className="text-xs text-muted-foreground font-normal">h</span></span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* Body Weight Trend */}
        {athlete.bodyWeightLogs.length > 0 && (
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-3">Body Weight (Last 30 Logs)</h2>
            <Card className="divide-y">
              {athlete.bodyWeightLogs.map(log => (
                <div key={log.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Weight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{formatDate(log.date)}</span>
                  </div>
                  <span className="text-sm font-semibold">{log.weightLbs} <span className="text-xs font-normal text-muted-foreground">lbs</span></span>
                </div>
              ))}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
