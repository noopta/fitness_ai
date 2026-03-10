import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Dumbbell, Moon, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

const PHASE_COLORS = [
  { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-500' },
  { bg: 'bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-500' },
  { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-500' },
  { bg: 'bg-green-500/15', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/30', dot: 'bg-green-500' },
  { bg: 'bg-rose-500/15', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30', dot: 'bg-rose-500' },
];

const DAY_HEADERS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface TrainingDay {
  day: string;
  focus: string;
  exercises: Array<{ exercise: string; sets: number; reps: string; intensity: string }>;
}

interface Phase {
  phaseNumber: number;
  phaseName: string;
  durationWeeks: number;
  objective?: string;
  rationale?: string;
  trainingDays: TrainingDay[];
}

interface CalendarDay {
  date: Date;
  isToday: boolean;
  isCurrentMonth: boolean;
  phaseIndex: number | null;
  weekNumber: number | null;
  trainingDay: TrainingDay | null;
  isTraining: boolean;
}

interface CalendarWeek {
  weekNumber: number;
  phaseIndex: number;
  phaseName: string;
  days: CalendarDay[];
  startDate: Date;
  endDate: Date;
}

function buildCalendar(program: { phases: Phase[]; durationWeeks: number }, startDate: Date): CalendarWeek[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Map each program week to a phase
  const phaseWeekMap: Array<{ phaseIndex: number; phaseName: string; trainingDays: TrainingDay[] }> = [];
  let weekCursor = 0;
  program.phases.forEach((phase, pIdx) => {
    for (let w = 0; w < phase.durationWeeks; w++) {
      phaseWeekMap.push({ phaseIndex: pIdx, phaseName: phase.phaseName, trainingDays: phase.trainingDays });
      weekCursor++;
    }
  });

  const totalWeeks = weekCursor;

  // Build week rows
  const weeks: CalendarWeek[] = [];
  for (let w = 0; w < totalWeeks; w++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(startDate.getDate() + w * 7);
    weekStart.setHours(0, 0, 0, 0);

    const phaseInfo = phaseWeekMap[w] || { phaseIndex: 0, phaseName: '', trainingDays: [] };
    const days: CalendarDay[] = [];

    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + d);
      const dayIndex = d % phaseInfo.trainingDays.length;
      const trainingDay = dayIndex < phaseInfo.trainingDays.length ? phaseInfo.trainingDays[dayIndex] : null;

      days.push({
        date,
        isToday: date.toDateString() === today.toDateString(),
        isCurrentMonth: true,
        phaseIndex: phaseInfo.phaseIndex,
        weekNumber: w + 1,
        trainingDay,
        isTraining: !!trainingDay,
      });
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    weeks.push({
      weekNumber: w + 1,
      phaseIndex: phaseInfo.phaseIndex,
      phaseName: phaseInfo.phaseName,
      days,
      startDate: weekStart,
      endDate: weekEnd,
    });
  }

  return weeks;
}

function formatShortDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  onClose: () => void;
}

export function FullScheduleModal({ onClose }: Props) {
  const [program, setProgram] = useState<{ phases: Phase[]; durationWeeks: number } | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([0]));

  useEffect(() => {
    authFetch(`${API_BASE}/coach/program`)
      .then(r => r.json())
      .then(d => {
        if (d.program) setProgram(d.program);
        if (d.programStartDate) setStartDate(new Date(d.programStartDate));
        else setStartDate(new Date());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const weeks = program && startDate ? buildCalendar(program, startDate) : [];

  // Group consecutive weeks by phase for phase banners
  const phaseGroups: Array<{ phaseIndex: number; phaseName: string; weekCount: number; startWeek: number }> = [];
  let lastPhaseIdx = -1;
  weeks.forEach(w => {
    if (w.phaseIndex !== lastPhaseIdx) {
      phaseGroups.push({ phaseIndex: w.phaseIndex, phaseName: w.phaseName, weekCount: 1, startWeek: w.weekNumber });
      lastPhaseIdx = w.phaseIndex;
    } else {
      phaseGroups[phaseGroups.length - 1].weekCount++;
    }
  });

  function togglePhase(pIdx: number) {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(pIdx)) next.delete(pIdx);
      else next.add(pIdx);
      return next;
    });
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          className="absolute inset-0 bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="relative bg-background w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl z-10 flex flex-col max-h-[92dvh] sm:max-h-[85vh]"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <h2 className="font-bold text-lg">Full Program Schedule</h2>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Phase legend */}
          {program && (
            <div className="px-5 pt-4 pb-2 flex flex-wrap gap-2 shrink-0">
              {program.phases.map((phase, i) => {
                const color = PHASE_COLORS[i % PHASE_COLORS.length];
                return (
                  <div key={i} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${color.bg} ${color.text}`}>
                    <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                    Phase {i + 1}: {phase.phaseName}
                    <span className="opacity-60">· {phase.durationWeeks}w</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Scrollable calendar body */}
          <div className="overflow-y-auto flex-1 px-5 pb-6">
            {loading && (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                Loading program…
              </div>
            )}

            {!loading && !program && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Calendar className="h-8 w-8" />
                <p className="text-sm">No program active. Generate a program to view your schedule.</p>
              </div>
            )}

            {!loading && program && weeks.length > 0 && (() => {
              // Render weeks grouped under expandable phase headers
              const elements: React.ReactNode[] = [];
              let currentPhaseIdx = -1;

              weeks.forEach((week, wi) => {
                const color = PHASE_COLORS[week.phaseIndex % PHASE_COLORS.length];
                const phase = program.phases[week.phaseIndex];

                // Phase header when phase changes
                if (week.phaseIndex !== currentPhaseIdx) {
                  currentPhaseIdx = week.phaseIndex;
                  const isExpanded = expandedPhases.has(week.phaseIndex);
                  elements.push(
                    <button
                      key={`phase-${week.phaseIndex}`}
                      onClick={() => togglePhase(week.phaseIndex)}
                      className={`w-full flex items-center justify-between mt-5 mb-2 rounded-xl px-4 py-3 border ${color.bg} ${color.border} transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
                        <span className={`font-bold text-sm ${color.text}`}>
                          Phase {week.phaseIndex + 1}: {phase.phaseName}
                        </span>
                        {phase.objective && (
                          <span className="text-xs text-muted-foreground hidden sm:block">— {phase.objective}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${color.text}`}>{phase.durationWeeks} weeks</span>
                        {isExpanded
                          ? <ChevronDown className={`h-4 w-4 ${color.text}`} />
                          : <ChevronRight className={`h-4 w-4 ${color.text}`} />
                        }
                      </div>
                    </button>
                  );
                }

                if (!expandedPhases.has(week.phaseIndex)) return;

                elements.push(
                  <div key={`week-${wi}`} className="mb-2">
                    {/* Week row header */}
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Week {week.weekNumber}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatShortDate(week.startDate)} – {formatShortDate(week.endDate)}
                      </span>
                    </div>

                    {/* Day header row */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                      {DAY_HEADERS.map(h => (
                        <div key={h} className="text-center text-[9px] font-semibold text-muted-foreground">{h}</div>
                      ))}
                    </div>

                    {/* Day cells */}
                    <div className="grid grid-cols-7 gap-1">
                      {week.days.map((day, di) => (
                        <div
                          key={di}
                          className={[
                            'rounded-lg flex flex-col items-center py-2 px-1 min-h-[52px] text-center transition-colors',
                            day.isToday
                              ? 'bg-zinc-900 text-white ring-2 ring-primary'
                              : day.isTraining
                              ? `${color.bg} ${color.text}`
                              : 'bg-muted/40 text-muted-foreground',
                          ].join(' ')}
                        >
                          <span className={`text-base font-bold leading-none ${day.isToday ? 'text-white' : ''}`}>
                            {day.date.getDate()}
                          </span>
                          <span className={`text-[8px] font-bold uppercase mt-1 ${day.isToday ? 'text-zinc-300' : ''}`}>
                            {day.isTraining
                              ? (day.trainingDay?.focus?.split(' ').slice(0, 2).join(' ') || 'Lift')
                              : <Moon className="h-2.5 w-2.5 inline opacity-50" />
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });

              return <>{elements}</>;
            })()}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
