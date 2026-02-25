import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2, Sparkles, ChevronRight, Dumbbell, Calendar, TrendingUp,
  Zap, Moon, CheckCircle2, BedDouble, Plus, X, Activity, Heart
} from 'lucide-react';
import { EfficiencyGauge } from '@/components/EfficiencyGauge';
import { StrengthRadar } from '@/components/StrengthRadar';
import { LifeHappenedModal } from '@/components/coach/LifeHappenedModal';
import { toast } from 'sonner';
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

interface TodayData {
  todaySession: {
    day: string;
    focus: string;
    warmup: string[];
    exercises: Array<{ exercise: string; sets: number; reps: string; intensity: string; notes?: string }>;
    cooldown: string[];
  } | null;
  isRestDay: boolean;
  weekNumber: number;
  phaseNumber: number;
  phaseName: string | null;
  tips: string | null;
  nextTrainingDay: string | null;
  programGoal: string | null;
}

interface WeekDay {
  date: string;
  dayLabel: string;
  dateNumber: number;
  monthLabel: string;
  isToday: boolean;
  isTrainingDay: boolean;
  session: {
    day: string;
    focus: string;
    exercises: Array<{ exercise: string; sets: number; reps: string; intensity: string; notes?: string }>;
  } | null;
}

interface ScheduleData {
  weekDays: WeekDay[];
  weekNumber: number | null;
  phaseName: string | null;
}

interface Props {
  sessions: SessionSummary[];
  user: UserProfile;
  hasSavedProgram: boolean;
  onTabChange: (tab: string) => void;
}

function formatLiftName(id: string) {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseTips(tips: string): string[] {
  return tips
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && (l.startsWith('•') || l.startsWith('-') || l.startsWith('*')))
    .map(l => l.replace(/^[•\-*]\s*/, '').trim())
    .filter(l => l.length > 0);
}

function truncate(str: string, len: number) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ─── Sub-components ────────────────────────────────────────────────────────

function WorkoutDayModal({ day, onClose }: { day: WeekDay; onClose: () => void }) {
  const session = day.session;
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
        <motion.div
          className="absolute inset-0 bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl z-10"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                {day.dayLabel} · {day.monthLabel} {day.dateNumber}
              </p>
              <h3 className="text-lg font-bold">{session?.day || 'Rest Day'}</h3>
              {session?.focus && <p className="text-xs text-muted-foreground mt-0.5">{session.focus}</p>}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {session?.exercises && session.exercises.length > 0 ? (
            <div className="space-y-2">
              {session.exercises.map((ex, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-2.5">
                  <span className="text-sm font-medium">{ex.exercise}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-3">
                    {ex.sets}×{ex.reps} · {ex.intensity}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <BedDouble className="h-8 w-8" />
              <p className="text-sm">Rest & recovery day</p>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OverviewTab({ sessions, user, hasSavedProgram, onTabChange }: Props) {
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(true);
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [selectedDay, setSelectedDay] = useState<WeekDay | null>(null);
  const [showLifeHappened, setShowLifeHappened] = useState(false);

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

  useEffect(() => {
    if (!hasSavedProgram) { setTodayLoading(false); return; }
    fetch(`${API_BASE}/coach/today`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTodayData(d))
      .catch(() => {})
      .finally(() => setTodayLoading(false));
  }, [hasSavedProgram]);

  useEffect(() => {
    if (!hasSavedProgram) return;
    fetch(`${API_BASE}/coach/schedule`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setScheduleData(d))
      .catch(() => {});
  }, [hasSavedProgram]);

  // ── Today's workout card (dark) ──────────────────────────────────────────
  function renderTodayCard() {
    if (!hasSavedProgram) {
      return (
        <div className="rounded-2xl bg-zinc-900 text-white p-6 space-y-4 flex flex-col h-full min-h-[320px]">
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Dumbbell className="h-10 w-10 text-zinc-500" />
            <div className="text-center">
              <p className="font-bold text-lg">No program active</p>
              <p className="text-sm text-zinc-400 mt-1">Generate your personalized training program to get started</p>
            </div>
          </div>
          <button
            onClick={() => onTabChange('program')}
            className="w-full bg-white text-black rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-zinc-100 transition-colors"
          >
            <Sparkles className="h-4 w-4" /> Generate Program
          </button>
        </div>
      );
    }

    if (todayLoading) {
      return (
        <div className="rounded-2xl bg-zinc-900 text-white p-6 flex items-center justify-center min-h-[320px]">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      );
    }

    const phaseName = todayData?.phaseName || scheduleData?.phaseName || null;
    const weekNumber = todayData?.weekNumber || scheduleData?.weekNumber || null;
    const phaseLabel = phaseName && weekNumber ? `${phaseName.toUpperCase()} · W${weekNumber}` : null;

    if (todayData?.isRestDay) {
      return (
        <div className="rounded-2xl bg-zinc-900 text-white p-6 space-y-5 flex flex-col min-h-[320px]">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-zinc-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Today</span>
            </div>
            {phaseLabel && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-zinc-700 px-2.5 py-1 rounded-full text-zinc-300">
                {phaseLabel}
              </span>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold">Rest Day</h2>
            <p className="text-sm text-zinc-400 mt-1">Recovery is where gains are made</p>
          </div>
          <div className="rounded-xl bg-zinc-800 px-4 py-4 space-y-3 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Recovery Focus</p>
            <div className="space-y-2">
              {[
                { icon: Moon, text: 'Aim for 8+ hours of sleep tonight' },
                { icon: Zap, text: 'Prioritize protein: 0.8–1g per lb of bodyweight' },
                { icon: CheckCircle2, text: 'Light walking or stretching is fine' },
              ].map(({ icon: Icon, text }, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                  <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-500" />
                  {text}
                </div>
              ))}
            </div>
          </div>
          {todayData.nextTrainingDay && (
            <p className="text-xs text-zinc-400 text-center">
              Next training: <span className="font-semibold text-white">{todayData.nextTrainingDay}</span>
            </p>
          )}
        </div>
      );
    }

    const session = todayData?.todaySession;
    if (!session) return null;

    const tips = todayData?.tips ? parseTips(todayData.tips) : [];

    return (
      <div className="rounded-2xl bg-zinc-900 text-white p-6 space-y-5 flex flex-col min-h-[320px]">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Today's Workout</span>
          </div>
          {phaseLabel && (
            <span className="text-[10px] font-bold uppercase tracking-wide bg-zinc-700 px-2.5 py-1 rounded-full text-zinc-300">
              {phaseLabel}
            </span>
          )}
        </div>

        {/* Workout title */}
        <div>
          <h2 className="text-2xl font-bold leading-tight">{session.day}</h2>
          <p className="text-sm text-zinc-400 mt-1">{session.focus}</p>
        </div>

        {/* Exercises */}
        <div className="space-y-2 flex-1">
          {(session.exercises?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
              <p className="text-sm text-zinc-400">Exercise details not available for this program.</p>
              <button
                onClick={() => onTabChange('program')}
                className="text-xs text-zinc-300 underline underline-offset-2 hover:text-white transition-colors"
              >
                Regenerate program to see full workouts →
              </button>
            </div>
          ) : (
            <>
              {(session.exercises ?? []).slice(0, 5).map((ex, i) => (
                <div key={i} className="flex items-center justify-between bg-zinc-800 rounded-xl px-4 py-2.5">
                  <span className="text-sm font-medium">{ex.exercise}</span>
                  <span className="text-xs text-zinc-400 shrink-0 ml-3">
                    {ex.sets}×{ex.reps} · {ex.intensity}
                  </span>
                </div>
              ))}
              {(session.exercises?.length ?? 0) > 5 && (
                <p className="text-xs text-zinc-500 text-center">+{(session.exercises?.length ?? 0) - 5} more exercises</p>
              )}
            </>
          )}
        </div>

        {/* Coach tips */}
        {tips.length > 0 && (
          <div className="rounded-xl bg-zinc-800 px-4 py-3 space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Coach Tips</p>
            {tips.slice(0, 2).map((tip, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-500" />
                {truncate(tip, 80)}
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={() => onTabChange('program')}
          className="w-full bg-white text-black rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-1 hover:bg-zinc-100 transition-colors mt-auto"
        >
          Start Workout <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Schedule card ────────────────────────────────────────────────────────
  function renderScheduleCard() {
    const days = scheduleData?.weekDays?.slice(0, 5) ?? [];
    const phaseName = scheduleData?.phaseName || todayData?.phaseName || null;
    const weekNumber = scheduleData?.weekNumber || todayData?.weekNumber || null;

    return (
      <Card className="p-5 space-y-4 flex flex-col">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Schedule</p>
            <h3 className="font-bold mt-0.5">Upcoming Week</h3>
          </div>
          <button
            onClick={() => toast.info('Calendar integration coming soon!')}
            className="text-[11px] text-primary flex items-center gap-1 font-semibold hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add to GCal
          </button>
        </div>

        {/* Day tiles */}
        {days.length > 0 ? (
          <div className="grid grid-cols-5 gap-2">
            {days.map((day, i) => (
              <button
                key={i}
                onClick={() => day.session || !day.isTrainingDay ? setSelectedDay(day) : undefined}
                className={[
                  'rounded-xl px-1 py-2.5 flex flex-col items-center gap-1 text-center transition-all',
                  day.isToday
                    ? 'bg-zinc-900 text-white'
                    : 'bg-muted/50 hover:bg-muted text-foreground',
                  (day.isTrainingDay || !day.isTrainingDay) ? 'cursor-pointer' : '',
                ].join(' ')}
              >
                <span className={`text-[10px] font-semibold ${day.isToday ? 'text-zinc-400' : 'text-muted-foreground'}`}>
                  {day.dayLabel}
                </span>
                <span className="text-xl font-bold leading-none">{day.dateNumber}</span>
                <span
                  className={[
                    'text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 mt-0.5',
                    day.isTrainingDay
                      ? day.isToday ? 'bg-green-500/30 text-green-300' : 'bg-green-500/15 text-green-600 dark:text-green-400'
                      : day.isToday ? 'bg-zinc-700 text-zinc-400' : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {day.isTrainingDay ? 'Lift' : 'Rest'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
            <Calendar className="h-6 w-6" />
            <p className="text-xs">{hasSavedProgram ? 'Loading schedule…' : 'No program active'}</p>
          </div>
        )}

        {phaseName && weekNumber && (
          <p className="text-[11px] text-muted-foreground text-center">
            {phaseName} · Week {weekNumber}
          </p>
        )}

        <button
          onClick={() => onTabChange('program')}
          className="w-full flex items-center justify-center gap-1.5 text-sm text-foreground/80 border rounded-xl py-2.5 hover:bg-muted/50 transition-colors mt-auto"
        >
          <Calendar className="h-4 w-4" />
          View Full Schedule
        </button>
      </Card>
    );
  }

  // ── Profile card ─────────────────────────────────────────────────────────
  function renderProfileCard() {
    const tags = [
      user.trainingAge && { label: user.trainingAge, icon: Dumbbell },
      user.equipment && { label: `${user.equipment} gym`, icon: Zap },
      sessions.length > 0 && { label: `${sessions.length} ${sessions.length === 1 ? 'analysis' : 'analyses'}`, icon: TrendingUp },
    ].filter(Boolean) as Array<{ label: string; icon: any }>;

    return (
      <Card className="p-5 space-y-4 flex flex-col">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold">{user.name || 'Athlete'}</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            user.tier === 'pro' || user.tier === 'enterprise'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
          }`}>
            {user.tier}
          </span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(({ label, icon: Icon }, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground font-medium">
                <Icon className="h-3 w-3" />
                {label}
              </span>
            ))}
          </div>
        )}

        {user.coachGoal && (
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Current Goal</p>
            <p className="text-xs text-foreground leading-relaxed">{user.coachGoal}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Link href="/onboarding" className="flex-1">
            <Button size="sm" variant="outline" className="w-full rounded-xl text-xs">
              New Analysis
            </Button>
          </Link>
          <Button size="sm" className="flex-1 rounded-xl text-xs" onClick={() => onTabChange('chat')}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Ask Coach
          </Button>
        </div>
      </Card>
    );
  }

  // ── Latest Analysis card ─────────────────────────────────────────────────
  function renderLatestAnalysisCard() {
    if (!latest) {
      return (
        <Card className="p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
          <Dumbbell className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold">No analyses yet</p>
          <p className="text-xs text-muted-foreground">Run your first lift analysis to see results here.</p>
          <Link href="/onboarding">
            <Button size="sm" className="rounded-xl text-xs">Start Analysis</Button>
          </Link>
        </Card>
      );
    }

    return (
      <Card className="p-5 space-y-3 flex flex-col">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Latest Analysis</p>
        <div>
          <h3 className="text-lg font-bold leading-tight">{formatLiftName(latest.selectedLift)}</h3>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Calendar className="h-3 w-3" />
            {formatDate(latest.createdAt)}
          </p>
        </div>

        {latest.primaryLimiter && (
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 font-bold">Primary Limiter</p>
            <p className="text-sm font-semibold">{latest.primaryLimiter}</p>
          </div>
        )}

        {latest.archetype && (
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 font-bold">Strength Archetype</p>
            <p className="text-sm font-semibold">{latest.archetype}</p>
          </div>
        )}

        <Link href={`/analysis/${latest.id}`} className="mt-auto">
          <Button variant="outline" size="sm" className="w-full rounded-xl text-xs">
            View Full Analysis <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </Link>
      </Card>
    );
  }

  // ── Strength Profile card ────────────────────────────────────────────────
  function renderStrengthProfileCard() {
    if (!signals) {
      return (
        <Card className="p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
          <Activity className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold">No strength data</p>
          <p className="text-xs text-muted-foreground">Complete an analysis to see your strength profile.</p>
        </Card>
      );
    }

    return (
      <Card className="p-5 space-y-3 overflow-hidden">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Strength Profile</p>
        <div className="space-y-4">
          <EfficiencyGauge
            score={signals.efficiency_score.score}
            explanation={signals.efficiency_score.explanation}
            deductions={(signals.efficiency_score as any).deductions || []}
          />
          <StrengthRadar signals={signals} liftId={latest?.selectedLift || ''} />
        </div>
      </Card>
    );
  }

  // ── Coach Insight card ───────────────────────────────────────────────────
  function renderInsightCard() {
    if (!insightLoading && !insight) return null;
    return (
      <Card className="p-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold text-primary mb-1">Coach Insight</p>
            {insightLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating insight…
              </div>
            ) : (
              <p className="text-sm text-foreground leading-relaxed">{insight}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">

      {/* Row 1: Today's Workout (2/3) + Schedule + Insight (1/3) */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5"
      >
        {/* Today's Workout — spans 2 cols */}
        <div className="lg:col-span-2">
          {renderTodayCard()}
        </div>

        {/* Right column: Schedule + Coach Insight */}
        <div className="flex flex-col gap-4">
          {renderScheduleCard()}
          {renderInsightCard()}
        </div>
      </motion.div>

      {/* Life Happened banner — only when program is active */}
      {hasSavedProgram && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/15">
                <Heart className="h-4.5 w-4.5 text-amber-500" style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Life Happened?</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Missed a session, had a rough night out, feeling sick, or just overwhelmed? Tell your coach — get a personalized recovery plan with adjusted training and nutrition advice.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:border-amber-500/60 shrink-0 whitespace-nowrap"
              onClick={() => setShowLifeHappened(true)}
            >
              Tell Your Coach <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Row 2: Profile + Latest Analysis + Strength Profile */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
      >
        {renderProfileCard()}
        {renderLatestAnalysisCard()}
        {renderStrengthProfileCard()}
      </motion.div>

      {/* Workout detail modal */}
      {selectedDay && (
        <WorkoutDayModal day={selectedDay} onClose={() => setSelectedDay(null)} />
      )}

      {/* Life Happened modal */}
      {showLifeHappened && (
        <LifeHappenedModal
          onClose={() => setShowLifeHappened(false)}
          onApplied={() => {
            setShowLifeHappened(false);
            // Re-fetch today and schedule after adjustment
            fetch(`${API_BASE}/coach/today`, { credentials: 'include' })
              .then(r => r.json()).then(d => setTodayData(d)).catch(() => {});
            fetch(`${API_BASE}/coach/schedule`, { credentials: 'include' })
              .then(r => r.json()).then(d => setScheduleData(d)).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
