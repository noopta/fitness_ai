import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2, Sparkles, ChevronRight, Dumbbell, Calendar, TrendingUp,
  Zap, Moon, CheckCircle2, BedDouble, Plus, X, Activity, Heart, ChevronDown,
  ClipboardList, Save,
} from 'lucide-react';
import { EfficiencyGauge } from '@/components/EfficiencyGauge';
import { StrengthRadar } from '@/components/StrengthRadar';
import { LifeHappenedModal } from '@/components/coach/LifeHappenedModal';
import { CheckInCard } from '@/components/coach/CheckInCard';
import { FullScheduleModal } from '@/components/coach/FullScheduleModal';
import { ExerciseDetailModal, type ExerciseDetail } from '@/components/coach/ExerciseDetailModal';
import { toast } from 'sonner';
import type { DiagnosticSignalsSubset } from '@/lib/api';
import { authFetch } from '@/lib/api';

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
  coachProfile?: Record<string, any> | null;
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

// ─── Quick Workout Log Modal ─────────────────────────────────────────────────

interface QuickLogEntry {
  name: string;
  sets: number;
  reps: string;
  weightKg: string;
  rpe: string;
}

function QuickLogModal({
  session,
  date,
  onClose,
  onSaved,
}: {
  session: { day: string; focus: string; exercises: Array<{ exercise: string; sets: number; reps: string; intensity: string }> };
  /** YYYY-MM-DD in EST. Defaults to today. */
  date?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  // Default to today in the user's local timezone
  const todayLocal = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  const logDate = date || todayLocal;
  const isToday = logDate === todayLocal;
  const isFuture = logDate > todayLocal;

  const [entries, setEntries] = useState<QuickLogEntry[]>(
    session.exercises.map(ex => ({
      name: ex.exercise,
      sets: ex.sets,
      reps: ex.reps,
      weightKg: '',
      rpe: '',
    }))
  );
  const [saving, setSaving] = useState(false);

  function update(i: number, field: keyof QuickLogEntry, value: string | number) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  }

  async function save() {
    setSaving(true);
    try {
      const exercises = entries.map(e => ({
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        weightKg: e.weightKg !== '' ? parseFloat(e.weightKg) : null,
        rpe: e.rpe !== '' ? parseFloat(e.rpe) : null,
        notes: null,
      }));

      const res = await authFetch(`${API_BASE}/workouts`, {
        method: 'POST',
        body: JSON.stringify({ date: logDate, title: session.day, exercises, notes: null, duration: null }),
      });

      if (!res.ok) throw new Error();
      toast.success(isToday ? 'Workout logged!' : 'Workout logged for ' + logDate + '!');
      onSaved?.();
      onClose();
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const logLabel = isToday ? "Log Today's Workout" : isFuture ? "Log Upcoming Workout" : "Log Missed Workout";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          className="absolute inset-0 bg-black/60"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="relative bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl z-10 flex flex-col max-h-[88dvh]"
          initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b shrink-0">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{logLabel}</p>
              <h3 className="font-bold text-base mt-0.5">{session.day}</h3>
              {!isToday && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(logDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
              )}
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Exercise rows */}
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
            <p className="text-xs text-muted-foreground mb-1">Fill in weights and RPE. Tap Save when done.</p>
            {entries.map((entry, i) => (
              <div key={i} className="rounded-xl border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-semibold">{entry.name}</p>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[9px] font-bold uppercase text-muted-foreground block mb-1">Sets</label>
                    <input
                      type="number" min="1" max="20"
                      value={entry.sets}
                      onChange={e => update(i, 'sets', parseInt(e.target.value) || 1)}
                      className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-muted-foreground block mb-1">Reps</label>
                    <input
                      type="text"
                      value={entry.reps}
                      onChange={e => update(i, 'reps', e.target.value)}
                      className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-muted-foreground block mb-1">Weight (lbs)</label>
                    <input
                      type="number" min="0" step="2.5" placeholder="—"
                      value={entry.weightKg}
                      onChange={e => update(i, 'weightKg', e.target.value)}
                      className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase text-muted-foreground block mb-1">RPE</label>
                    <input
                      type="number" min="1" max="10" step="0.5" placeholder="—"
                      value={entry.rpe}
                      onChange={e => update(i, 'rpe', e.target.value)}
                      className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-5 border-t shrink-0">
            <Button onClick={save} disabled={saving} className="w-full rounded-xl">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Workout
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function WorkoutDayModal({ day, onClose, onExerciseClick, onLog, isLogged }: {
  day: WeekDay;
  onClose: () => void;
  onExerciseClick: (ex: ExerciseDetail) => void;
  onLog: () => void;
  isLogged?: boolean;
}) {
  const session = day.session;
  const todayLocal = new Date().toLocaleDateString('en-CA');
  // Convert the backend ISO date to a local YYYY-MM-DD string
  const dayDateLocal = new Date(day.date).toLocaleDateString('en-CA');
  const isFuture = dayDateLocal > todayLocal;

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
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {isLogged && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 dark:text-green-400 bg-green-500/10 rounded-full px-2.5 py-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Logged
                </span>
              )}
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {session?.exercises && session.exercises.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground mb-1">Tap an exercise for details & video</p>
              {session.exercises.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => onExerciseClick(ex)}
                  className="w-full flex items-center justify-between rounded-xl bg-muted/50 hover:bg-muted px-4 py-2.5 transition-colors text-left"
                >
                  <span className="text-sm font-medium">{ex.exercise}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-3">
                    {ex.sets}×{ex.reps} · {ex.intensity}
                  </span>
                </button>
              ))}
              {!isFuture && (
                <button
                  onClick={onLog}
                  className="w-full mt-3 flex items-center justify-center gap-2 rounded-xl bg-foreground text-background px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <Save className="h-4 w-4" />
                  {day.isToday ? 'Log Today\'s Workout' : 'Log Missed Workout'}
                </button>
              )}
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

// ─── ICS export helper ───────────────────────────────────────────────────────

function formatICSDate(dateStr: string): string {
  // dateStr is YYYY-MM-DD
  return dateStr.replace(/-/g, '') + 'T090000';
}

function exportToICS(days: WeekDay[]) {
  const trainingDays = days.filter(d => d.isTrainingDay);
  if (trainingDays.length === 0) {
    toast.info('No training days this week to export.');
    return;
  }

  const events = trainingDays.map(day => {
    const dtStart = formatICSDate(day.date);
    const dtEnd = day.date.replace(/-/g, '') + 'T103000'; // +1.5h
    const title = day.session?.day || 'Training Day';
    const description = day.session?.exercises
      ?.slice(0, 5)
      .map(ex => `${ex.exercise}: ${ex.sets}x${ex.reps} @ ${ex.intensity}`)
      .join('\\n') || '';

    return [
      'BEGIN:VEVENT',
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:🏋️ ${title}`,
      description ? `DESCRIPTION:${description}` : '',
      `LOCATION:Gym`,
      `STATUS:CONFIRMED`,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Axiom//Training Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'axiom-schedule.ics';
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Calendar file downloaded — open it to import into Google Calendar, iCal, or Outlook.');
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OverviewTab({ sessions, user, hasSavedProgram, onTabChange, coachProfile }: Props) {
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(true);
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [loggedDates, setLoggedDates] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<WeekDay | null>(null);
  const [showLifeHappened, setShowLifeHappened] = useState(false);
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<ExerciseDetail | null>(null);
  const [showQuickLog, setShowQuickLog] = useState(false);
  // When logging from a selected schedule day (may be past, today, or today's card)
  const [quickLogDay, setQuickLogDay] = useState<WeekDay | null>(null);

  function refreshLoggedDates() {
    authFetch(`${API_BASE}/workouts`)
      .then(r => r.json())
      .then((logs: Array<{ date: string }>) => setLoggedDates(new Set(logs.map(l => l.date))))
      .catch(() => {});
  }

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
    authFetch(`${API_BASE}/coach/insights`)
      .then(r => r.json())
      .then(d => setInsight(d.insight || null))
      .catch(() => {})
      .finally(() => setInsightLoading(false));
  }, []);

  useEffect(() => {
    if (hasSavedProgram) refreshLoggedDates();
  }, [hasSavedProgram]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasSavedProgram) { setTodayLoading(false); return; }

    // Fetch dashboard first (one request, both schedule + cached today if warm),
    // then fetch /coach/today for the full today payload (tips, nextTrainingDay, etc.)
    authFetch(`${API_BASE}/coach/dashboard`)
      .then(r => r.json())
      .then(d => {
        if (d.schedule) setScheduleData(d.schedule);
        if (d.today) { setTodayData(d.today); setTodayLoading(false); }
      })
      .catch(() => {});

    authFetch(`${API_BASE}/coach/today`)
      .then(r => r.json())
      .then(d => setTodayData(d))
      .catch(() => {})
      .finally(() => setTodayLoading(false));
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
          {/* Log button — disabled on rest days */}
          <div className="flex gap-2 mt-auto">
            <button
              disabled
              className="flex-1 bg-zinc-800 text-zinc-600 rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-1 cursor-not-allowed"
            >
              Start <ChevronRight className="h-4 w-4" />
            </button>
            <button
              disabled
              className="flex-1 bg-zinc-800 rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-not-allowed opacity-40 line-through decoration-zinc-500"
            >
              <ClipboardList className="h-4 w-4 text-zinc-600" />
              <span className="text-zinc-600">Log</span>
            </button>
          </div>
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
                <button
                  key={i}
                  onClick={() => setSelectedExercise(ex)}
                  className="w-full flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 rounded-xl px-4 py-2.5 transition-colors text-left"
                >
                  <span className="text-sm font-medium">{ex.exercise}</span>
                  <span className="text-xs text-zinc-400 shrink-0 ml-3">
                    {ex.sets}×{ex.reps} · {ex.intensity}
                  </span>
                </button>
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Anakin's Tips</p>
            {tips.slice(0, 2).map((tip, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-500" />
                {truncate(tip, 80)}
              </div>
            ))}
          </div>
        )}

        {/* CTAs */}
        <div className="flex gap-2 mt-auto">
          <button
            onClick={() => onTabChange('program')}
            className="flex-1 bg-white text-black rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-1 hover:bg-zinc-100 transition-colors"
          >
            Start <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => (session.exercises?.length ?? 0) > 0 ? setShowQuickLog(true) : undefined}
            disabled={(session.exercises?.length ?? 0) === 0}
            className={[
              'flex-1 rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors',
              (session.exercises?.length ?? 0) > 0
                ? 'bg-zinc-700 text-white hover:bg-zinc-600'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-40',
            ].join(' ')}
          >
            <ClipboardList className="h-4 w-4" /> Log
          </button>
        </div>
      </div>
    );
  }

  // ── Schedule card ────────────────────────────────────────────────────────
  function renderScheduleCard() {
    const days = scheduleData?.weekDays ?? [];
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
            onClick={() => exportToICS(days)}
            className="text-[11px] text-primary flex items-center gap-1 font-semibold hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add to Calendar
          </button>
        </div>

        {/* Day tiles */}
        {days.length > 0 ? (
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, i) => {
              const dateStr = new Date(day.date).toLocaleDateString('en-CA');
              const isLogged = day.isTrainingDay && loggedDates.has(dateStr);
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDay(day)}
                  className={[
                    'rounded-xl px-0.5 py-2 flex flex-col items-center gap-1 text-center transition-all',
                    day.isToday
                      ? 'bg-zinc-900 text-white'
                      : isLogged
                      ? 'bg-green-500/10 hover:bg-green-500/15 text-foreground'
                      : 'bg-muted/50 hover:bg-muted text-foreground',
                    'cursor-pointer',
                  ].join(' ')}
                >
                  <span className={`text-[9px] font-semibold ${day.isToday ? 'text-zinc-400' : 'text-muted-foreground'}`}>
                    {day.dayLabel}
                  </span>
                  <span className="text-base font-bold leading-none">{day.dateNumber}</span>
                  {isLogged ? (
                    <CheckCircle2 className={`h-3.5 w-3.5 mt-0.5 ${day.isToday ? 'text-green-400' : 'text-green-500'}`} />
                  ) : (
                    <span
                      className={[
                        'text-[8px] font-bold uppercase rounded-full px-1 py-0.5 mt-0.5',
                        day.isTrainingDay
                          ? day.isToday ? 'bg-green-500/30 text-green-300' : 'bg-green-500/15 text-green-600 dark:text-green-400'
                          : day.isToday ? 'bg-zinc-700 text-zinc-400' : 'bg-muted text-muted-foreground',
                      ].join(' ')}
                    >
                      {day.isTrainingDay ? 'Lift' : 'Rest'}
                    </span>
                  )}
                </button>
              );
            })}
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
          onClick={() => setShowFullSchedule(true)}
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
          <Button size="sm" variant="outline" className="flex-1 w-full rounded-xl text-xs" asChild>
            <Link href="/onboarding">New Analysis</Link>
          </Button>
          <Button size="sm" className="flex-1 rounded-xl text-xs" onClick={() => onTabChange('chat')}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            Ask Anakin
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
          <Button size="sm" className="rounded-xl text-xs" asChild>
            <Link href="/onboarding">Start Analysis</Link>
          </Button>
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

        <Button variant="outline" size="sm" className="w-full rounded-xl text-xs mt-auto" asChild>
          <Link href={`/analysis/${latest.id}`}>
            View Full Analysis <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </Button>
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
  const INSIGHT_TRUNCATE = 140;
  const [insightExpanded, setInsightExpanded] = useState(false);

  function renderInsightCard() {
    if (!insightLoading && !insight) return null;
    const isLong = insight && insight.length > INSIGHT_TRUNCATE;
    const displayText = isLong && !insightExpanded
      ? insight!.slice(0, INSIGHT_TRUNCATE).trimEnd() + '…'
      : insight;

    return (
      <Card className="p-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary mb-1">Anakin's Insight</p>
            {insightLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating insight…
              </div>
            ) : (
              <div>
                <p className="text-sm text-foreground leading-relaxed">{displayText}</p>
                {isLong && (
                  <button
                    onClick={() => setInsightExpanded(v => !v)}
                    className="mt-1.5 flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    {insightExpanded ? 'Show less' : 'Show more'}
                    <ChevronDown className={`h-3 w-3 transition-transform ${insightExpanded ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
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
                  Missed a session, had a rough night out, feeling sick, or just overwhelmed? Tell Anakin — get a personalized recovery plan with adjusted training and nutrition advice.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:border-amber-500/60 shrink-0 whitespace-nowrap"
              onClick={() => setShowLifeHappened(true)}
            >
              Tell Anakin <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Daily check-in card — below Life Happened */}
      {coachProfile?.accountability && (
        <CheckInCard accountability={coachProfile.accountability} />
      )}

      {/* Row 2: (Profile + Latest Analysis stacked) + Strength Profile */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-5"
      >
        {/* Left: stacked cards at natural height */}
        <div className="flex flex-col gap-5">
          {renderProfileCard()}
          {renderLatestAnalysisCard()}
        </div>
        {/* Right: Strength Profile fills the column */}
        {renderStrengthProfileCard()}
      </motion.div>

      {/* Workout detail modal */}
      {selectedDay && (
        <WorkoutDayModal
          day={selectedDay}
          isLogged={selectedDay.isTrainingDay && loggedDates.has(new Date(selectedDay.date).toLocaleDateString('en-CA'))}
          onClose={() => setSelectedDay(null)}
          onExerciseClick={(ex) => { setSelectedDay(null); setSelectedExercise(ex); }}
          onLog={() => { setQuickLogDay(selectedDay); setSelectedDay(null); }}
        />
      )}

      {/* Exercise detail + video modal */}
      {selectedExercise && (
        <ExerciseDetailModal exercise={selectedExercise} onClose={() => setSelectedExercise(null)} />
      )}

      {/* Quick log modal — from Today's workout card */}
      {showQuickLog && todayData?.todaySession && (
        <QuickLogModal
          session={todayData.todaySession}
          onSaved={refreshLoggedDates}
          onClose={() => setShowQuickLog(false)}
        />
      )}

      {/* Quick log modal — from schedule day tile */}
      {quickLogDay?.session && (
        <QuickLogModal
          session={quickLogDay.session}
          date={new Date(quickLogDay.date).toLocaleDateString('en-CA')}
          onSaved={refreshLoggedDates}
          onClose={() => setQuickLogDay(null)}
        />
      )}

      {/* Full schedule / calendar modal */}
      {showFullSchedule && (
        <FullScheduleModal onClose={() => setShowFullSchedule(false)} />
      )}

      {/* Life Happened modal */}
      {showLifeHappened && (
        <LifeHappenedModal
          onClose={() => setShowLifeHappened(false)}
          onApplied={() => {
            setShowLifeHappened(false);
            // Re-fetch today and schedule after adjustment
            authFetch(`${API_BASE}/coach/today`)
              .then(r => r.json()).then(d => setTodayData(d)).catch(() => {});
            authFetch(`${API_BASE}/coach/schedule`)
              .then(r => r.json()).then(d => setScheduleData(d)).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
