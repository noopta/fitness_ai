import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { Loader2, History, ArrowRight, Dumbbell, ChevronRight, Share2 } from 'lucide-react';
import { Navbar } from '@/components/Navbar';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface HistorySession {
  id: string;
  selectedLift: string;
  createdAt: string;
  status: string;
  primaryLimiter?: string;
  confidence?: number;
  isPublic?: boolean;
}

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getLiftCategory(id: string): 'powerlifting' | 'olympic' {
  const olympic = ['clean_and_jerk', 'snatch', 'power_clean', 'hang_clean'];
  return olympic.some(o => id.includes(o.replace(/_/g, ''))) ? 'olympic' : 'powerlifting';
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    fetch(`${API_BASE}/sessions/history`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { sessions: [] })
      .then(data => setSessions(Array.isArray(data?.sessions) ? data.sessions : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  // Sessions with a plan (primaryLimiter set) are "completed"; others are in-progress
  const completed = sessions.filter(s => s.primaryLimiter != null);
  const inProgress = sessions.filter(s => s.primaryLimiter == null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary">
      <Navbar variant="full" rightSlot={
        <Link href="/onboarding">
          <Button size="sm" className="rounded-xl">
            New Analysis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      } />

      <main className="mx-auto max-w-4xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center justify-between gap-3 mb-8">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border bg-primary/10">
                <History className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">My Analyses</h1>
                <p className="text-sm text-muted-foreground">
                  {sessions.length === 0
                    ? 'No sessions yet'
                    : `${sessions.length} diagnostic session${sessions.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl border bg-primary/10 mx-auto mb-4">
                <Dumbbell className="h-6 w-6 text-primary" />
              </div>
              <p className="font-semibold mb-1">No analyses yet</p>
              <p className="text-sm text-muted-foreground mb-5">
                Run your first diagnostic to see your lift analysis here.
              </p>
              <Link href="/onboarding">
                <Button>Start Your First Analysis</Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-6">
              {completed.length > 0 && (
                <section>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Completed — {completed.length}
                  </div>
                  <div className="space-y-2">
                    {completed.map((s, i) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        index={i}
                        onOpen={() => {
                          localStorage.setItem('liftoff_session_id', s.id);
                          localStorage.setItem('liftoff_selected_lift', s.selectedLift);
                          // Plan cache is keyed by session ID — plan.tsx will find it
                          setLocation('/plan');
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {inProgress.length > 0 && (
                <section>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    In Progress — {inProgress.length}
                  </div>
                  <div className="space-y-2">
                    {inProgress.map((s, i) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        index={i}
                        onOpen={() => {
                          localStorage.setItem('liftoff_session_id', s.id);
                          localStorage.setItem('liftoff_selected_lift', s.selectedLift);
                          setLocation('/diagnostic');
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}

function SessionCard({
  session: s,
  index,
  onOpen,
}: {
  session: HistorySession;
  index: number;
  onOpen: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <Card
        className="p-5 hover:border-primary/40 transition-all cursor-pointer group"
        onClick={onOpen}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border bg-background">
              <Dumbbell className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {formatLiftName(s.selectedLift)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDate(s.createdAt)}
              </div>
              {s.primaryLimiter && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Limiting factor:</span>
                  <span className="text-xs font-medium text-foreground">{s.primaryLimiter}</span>
                  {s.confidence !== undefined && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                      {Math.round(s.confidence * 100)}% confidence
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {s.isPublic && (
              <Share2 className="h-3.5 w-3.5 text-muted-foreground" title="Shared publicly" />
            )}
            <Badge
              variant={s.status === 'completed' ? 'default' : 'secondary'}
              className="capitalize text-xs"
            >
              {s.status === 'completed' ? 'Complete' : 'In progress'}
            </Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
