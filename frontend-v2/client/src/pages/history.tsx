import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { Loader2, History, ArrowRight } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://luciuslab.xyz:4009/api';

interface HistorySession {
  id: string;
  selectedLift: string;
  createdAt: string;
  status: string;
  primaryLimiter?: string;
  confidence?: number;
}

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetch(`${API_BASE}/sessions/history`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary">
      <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/">
            <a className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
              <BrandLogo height={36} className="h-9 w-auto" />
              <div className="text-sm font-semibold">LiftOff</div>
            </a>
          </Link>
          <Link href="/onboarding">
            <Button size="sm">
              New Analysis
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="grid h-10 w-10 place-items-center rounded-xl border bg-primary/10">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Analysis History</h1>
              <p className="text-sm text-muted-foreground">Your past diagnostic sessions</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground mb-4">No analyses yet.</p>
              <Link href="/onboarding">
                <Button>Start Your First Analysis</Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => (
                <Card
                  key={s.id}
                  className="p-5 hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={() => {
                    localStorage.setItem('liftoff_session_id', s.id);
                    localStorage.setItem('liftoff_selected_lift', s.selectedLift);
                    setLocation('/plan');
                  }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold">{formatLiftName(s.selectedLift)}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{formatDate(s.createdAt)}</div>
                      {s.primaryLimiter && (
                        <div className="text-sm text-muted-foreground mt-1">
                          Limiter: <span className="text-foreground font-medium">{s.primaryLimiter}</span>
                          {s.confidence !== undefined && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {Math.round(s.confidence * 100)}%
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={s.status === 'completed' ? 'default' : 'secondary'} className="capitalize">
                        {s.status}
                      </Badge>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
