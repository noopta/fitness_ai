import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, ChevronRight, Dumbbell, Calendar, TrendingUp, Zap } from 'lucide-react';
import { StrengthRadar } from '@/components/StrengthRadar';
import { EfficiencyGauge } from '@/components/EfficiencyGauge';
import type { DiagnosticSignalsSubset } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface SessionSummary {
  id: string;
  selectedLift: string;
  createdAt: string;
  primaryLimiter: string | null;
  archetype: string | null;
  efficiencyScore: number | null;
  plan: any;
}

interface UserProfile {
  name: string | null;
  trainingAge: string | null;
  equipment: string | null;
  tier: string;
  coachGoal: string | null;
}

interface Props {
  sessions: SessionSummary[];
  user: UserProfile;
  onTabChange: (tab: string) => void;
}

function formatLiftName(id: string) {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function OverviewTab({ sessions, user, onTabChange }: Props) {
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(true);

  const latest = sessions[0];
  const latestPlan = latest?.plan;
  const signals: DiagnosticSignalsSubset | null = latestPlan?.diagnostic_signals
    ? {
        indices: latestPlan.diagnostic_signals.indices || {},
        phase_scores: latestPlan.diagnostic_signals.phase_scores || [],
        primary_phase: latestPlan.diagnostic_signals.primary_phase || '',
        primary_phase_confidence: latestPlan.diagnostic_signals.primary_phase_confidence || 0,
        hypothesis_scores: latestPlan.diagnostic_signals.hypothesis_scores || [],
        efficiency_score: latestPlan.diagnostic_signals.efficiency_score || { score: 0, explanation: '', deductions: [] },
      }
    : null;

  useEffect(() => {
    fetch(`${API_BASE}/coach/insights`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setInsight(d.insight || null))
      .catch(() => {})
      .finally(() => setInsightLoading(false));
  }, []);

  const daysSinceLastAnalysis = latest
    ? Math.floor((Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Profile summary */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold">{user.name || 'Athlete'}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                user.tier === 'pro' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {user.tier}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2">
              {user.trainingAge && <span className="flex items-center gap-1"><Dumbbell className="h-3 w-3" />{user.trainingAge}</span>}
              {user.equipment && <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{user.equipment} gym</span>}
              {sessions.length > 0 && <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />{sessions.length} analyses</span>}
            </div>
            {user.coachGoal && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 max-w-sm">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-0.5">Current Goal</p>
                <p className="text-xs text-foreground leading-relaxed">{user.coachGoal}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/onboarding">
              <Button size="sm" variant="outline" className="rounded-xl text-xs">
                New Analysis
              </Button>
            </Link>
            <Button size="sm" className="rounded-xl text-xs" onClick={() => onTabChange('chat')}>
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Ask Coach
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* AI Insight card */}
      {(insightLoading || insight) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-4 border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-primary mb-0.5">Coach Insight</p>
                {insightLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generating insight…
                  </div>
                ) : (
                  <p className="text-sm text-foreground">{insight}</p>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Latest analysis + strength profile */}
      {latest && signals ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Latest analysis card */}
          <Card className="p-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Latest Analysis</p>
            <div>
              <p className="text-base font-bold">{formatLiftName(latest.selectedLift)}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Calendar className="h-3 w-3" />
                {formatDate(latest.createdAt)}
                {daysSinceLastAnalysis !== null && (
                  <span className="ml-1">· {daysSinceLastAnalysis === 0 ? 'Today' : `${daysSinceLastAnalysis}d ago`}</span>
                )}
              </p>
            </div>
            {latest.primaryLimiter && (
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Primary Limiter</p>
                <p className="text-sm font-semibold">{latest.primaryLimiter}</p>
              </div>
            )}
            {latest.archetype && (
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Strength Archetype</p>
                <p className="text-sm font-semibold">{latest.archetype}</p>
              </div>
            )}
            <Link href={`/analysis/${latest.id}`}>
              <Button variant="outline" size="sm" className="w-full rounded-xl text-xs mt-1">
                View Full Analysis <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </Card>

          {/* Strength profile */}
          <Card className="p-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Strength Profile</p>
            <div className="flex flex-col items-center gap-4">
              <EfficiencyGauge
                score={signals.efficiency_score.score}
                explanation={signals.efficiency_score.explanation}
                deductions={(signals.efficiency_score as any).deductions || []}
              />
              <div className="w-full">
                <StrengthRadar signals={signals} liftId={latest.selectedLift} />
              </div>
            </div>
          </Card>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
          <Card className="p-8 text-center space-y-3">
            <Dumbbell className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="font-semibold">No analyses yet</p>
            <p className="text-sm text-muted-foreground">Run your first lift analysis to unlock your strength profile and personalized coaching.</p>
            <Link href="/onboarding">
              <Button className="rounded-xl">Start Analysis</Button>
            </Link>
          </Card>
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Analytics', desc: 'Trend charts', tab: 'analytics', icon: TrendingUp },
            { label: 'Nutrition', desc: 'Log macros', tab: 'nutrition', icon: Zap },
            { label: 'Wellness', desc: 'Daily check-in', tab: 'wellness', icon: Calendar },
            { label: 'Program', desc: 'AI program', tab: 'program', icon: Dumbbell },
          ].map(({ label, desc, tab, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className="rounded-xl border bg-background p-4 text-left hover:bg-muted/50 hover:border-primary/30 transition-colors"
            >
              <Icon className="h-4 w-4 text-primary mb-2" />
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
