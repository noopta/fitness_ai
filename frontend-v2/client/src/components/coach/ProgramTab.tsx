import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Loader2, Save, ChevronDown, ChevronUp, Flame, Moon,
  Zap, BarChart2, RotateCcw, Dumbbell, CalendarDays, ArrowRight,
  Target, TrendingUp,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface ProgramExercise {
  exercise: string;
  sets: number;
  reps: string;
  intensity: string;
  notes?: string;
}

interface ProgramDay {
  day: string;
  focus: string;
  warmup?: string[];
  exercises: ProgramExercise[];
  sessions?: ProgramExercise[];
  cooldown?: string[];
}

interface ProgramPhase {
  phaseNumber: number;
  phaseName: string;
  rationale: string;
  durationWeeks: number;
  weeksLabel: string;
  trainingDays: ProgramDay[];
  progressionNotes: string[];
  deloadProtocol: string;
}

interface TrainingProgram {
  goal: string;
  daysPerWeek: number;
  durationWeeks: number;
  phases?: ProgramPhase[];
  autoregulationRules?: string[];
  trackingMetrics?: string[];
  weeks?: Array<{ weekNumber: number; days: Array<{ day: string; focus: string; sessions: ProgramExercise[] }> }>;
  progressionNotes?: string[];
}

interface Props {
  latestPlan: any;
  isPro: boolean;
  onTabChange?: (tab: string) => void;
}

const PHASE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string; dot: string }> = {
  'Foundation': { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-700 dark:text-blue-400', badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
  'Correction':  { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-700 dark:text-blue-400', badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
  'Build':       { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  'Hypertrophy': { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  'Peak':        { bg: 'bg-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-700 dark:text-rose-400', badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', dot: 'bg-rose-500' },
  'Strength':    { bg: 'bg-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-700 dark:text-rose-400', badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400', dot: 'bg-rose-500' },
};

const DAY_FOCUS_COLORS: Record<string, { card: string; bar: string }> = {
  push:  { card: 'bg-blue-500/5 border-blue-500/20',   bar: 'bg-blue-500' },
  pull:  { card: 'bg-green-500/5 border-green-500/20', bar: 'bg-green-500' },
  leg:   { card: 'bg-purple-500/5 border-purple-500/20', bar: 'bg-purple-500' },
  squat: { card: 'bg-purple-500/5 border-purple-500/20', bar: 'bg-purple-500' },
  dead:  { card: 'bg-amber-500/5 border-amber-500/20',  bar: 'bg-amber-500' },
  upper: { card: 'bg-blue-500/5 border-blue-500/20',   bar: 'bg-blue-500' },
  lower: { card: 'bg-purple-500/5 border-purple-500/20', bar: 'bg-purple-500' },
  bench: { card: 'bg-blue-500/5 border-blue-500/20',   bar: 'bg-blue-500' },
  full:  { card: 'bg-rose-500/5 border-rose-500/20',   bar: 'bg-rose-500' },
  hinge: { card: 'bg-amber-500/5 border-amber-500/20',  bar: 'bg-amber-500' },
  hip:   { card: 'bg-amber-500/5 border-amber-500/20',  bar: 'bg-amber-500' },
};

function getPhaseStyle(name: string) {
  for (const [key, style] of Object.entries(PHASE_COLORS)) {
    if (name.includes(key)) return style;
  }
  return { bg: 'bg-muted/30', border: 'border-muted', text: 'text-foreground', badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' };
}

function getDayStyle(day: string) {
  const lower = day.toLowerCase();
  for (const [key, cls] of Object.entries(DAY_FOCUS_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return { card: 'bg-muted/20 border-muted', bar: 'bg-muted-foreground' };
}

/** RPE-based intensity coloring */
function getIntensityStyle(intensity: string): string {
  const lower = intensity.toLowerCase();
  const rpeMatch = lower.match(/rpe\s*(\d+(?:\.\d+)?)/);
  const pctMatch = lower.match(/(\d+)%/);
  let level = 0;
  if (rpeMatch) level = parseFloat(rpeMatch[1]);
  else if (pctMatch) level = parseFloat(pctMatch[1]) / 10; // rough mapping
  if (level >= 9) return 'bg-rose-500/10 text-rose-600 dark:text-rose-400';
  if (level >= 7.5) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
}

/** Phase timeline at the top of the program view */
function PhaseTimeline({ phases }: { phases: ProgramPhase[] }) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto py-1">
      {phases.map((phase, i) => {
        const style = getPhaseStyle(phase.phaseName);
        return (
          <div key={i} className="flex items-center shrink-0">
            <div className={`flex flex-col items-center rounded-xl px-4 py-2.5 border ${style.bg} ${style.border}`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${style.text}`}>Phase {phase.phaseNumber}</span>
              <span className="text-[11px] font-semibold mt-0.5">{phase.phaseName}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{phase.weeksLabel}</span>
            </div>
            {i < phases.length - 1 && (
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground mx-2 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExerciseRow({ ex }: { ex: ProgramExercise }) {
  const intensityClass = getIntensityStyle(ex.intensity);
  return (
    <div className="rounded-lg bg-background/70 border border-border/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-snug">{ex.exercise}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            {ex.sets}×{ex.reps}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${intensityClass}`}>
            {ex.intensity}
          </span>
        </div>
      </div>
      {ex.notes && (
        <p className="text-[10px] text-muted-foreground italic mt-1 leading-relaxed">{ex.notes}</p>
      )}
    </div>
  );
}

function PhaseCard({ phase, defaultOpen }: { phase: ProgramPhase; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const style = getPhaseStyle(phase.phaseName);
  const totalExercises = phase.trainingDays.reduce((sum, d) => sum + (d.exercises || d.sessions || []).length, 0);
  const avgExercises = phase.trainingDays.length > 0 ? Math.round(totalExercises / phase.trainingDays.length) : 0;

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} overflow-hidden`}>
      {/* Phase header */}
      <button
        className="w-full text-left p-5 flex items-center justify-between gap-3"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
            Phase {phase.phaseNumber}
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-bold ${style.text}`}>{phase.phaseName}</p>
            <p className="text-[10px] text-muted-foreground">{phase.weeksLabel} · {phase.durationWeeks} weeks</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!open && (
            <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {phase.trainingDays.length} days/week
              </span>
              {avgExercises > 0 && (
                <span className="flex items-center gap-1">
                  <Dumbbell className="h-3 w-3" />
                  ~{avgExercises} exercises
                </span>
              )}
            </div>
          )}
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-5">
              {/* Rationale */}
              <div className="rounded-xl bg-background/60 border border-border/50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Coach Rationale</p>
                <p className="text-xs text-foreground leading-relaxed">{phase.rationale}</p>
              </div>

              {/* Training days */}
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Template Week</p>
                {phase.trainingDays.map((day, di) => {
                  const exercises = day.exercises || day.sessions || [];
                  const dayStyle = getDayStyle(day.day);
                  return (
                    <div key={di} className={`rounded-xl border overflow-hidden ${dayStyle.card}`}>
                      {/* Colored accent bar */}
                      <div className={`h-0.5 w-full ${dayStyle.bar}`} />
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold">{day.day}</p>
                            <p className="text-[10px] text-muted-foreground opacity-80">{day.focus}</p>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {day.warmup && day.warmup.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Flame className="h-2.5 w-2.5 text-orange-500" />
                                {day.warmup.length} warm-up
                              </span>
                            )}
                            {day.cooldown && day.cooldown.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Moon className="h-2.5 w-2.5 text-blue-400" />
                                {day.cooldown.length} cool-down
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Warm-up */}
                        {day.warmup && day.warmup.length > 0 && (
                          <div className="rounded-lg bg-background/50 px-3 py-2 space-y-1">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Flame className="h-3 w-3 text-orange-500" />
                              <p className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide">Warm-Up</p>
                            </div>
                            {day.warmup.map((item, wi) => (
                              <p key={wi} className="text-[11px] text-muted-foreground">· {item}</p>
                            ))}
                          </div>
                        )}

                        {/* Main exercises */}
                        <div className="space-y-1.5">
                          {exercises.map((ex, ei) => (
                            <ExerciseRow key={ei} ex={ex} />
                          ))}
                        </div>

                        {/* Cool-down */}
                        {day.cooldown && day.cooldown.length > 0 && (
                          <div className="rounded-lg bg-background/50 px-3 py-2 space-y-1">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Moon className="h-3 w-3 text-blue-400" />
                              <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Cool-Down</p>
                            </div>
                            {day.cooldown.map((item, ci) => (
                              <p key={ci} className="text-[11px] text-muted-foreground">· {item}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Progression + Deload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {phase.progressionNotes && phase.progressionNotes.length > 0 && (
                  <div className="rounded-xl bg-background/60 border border-border/50 px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <TrendingUp className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Progression Rules</p>
                    </div>
                    {phase.progressionNotes.map((n, i) => (
                      <p key={i} className="text-[11px] text-foreground mb-1">→ {n}</p>
                    ))}
                  </div>
                )}
                {phase.deloadProtocol && (
                  <div className="rounded-xl bg-background/60 border border-border/50 px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <RotateCcw className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Deload Protocol</p>
                    </div>
                    <p className="text-[11px] text-foreground leading-relaxed">{phase.deloadProtocol}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ProgramTab({ latestPlan, isPro, onTabChange }: Props) {
  const [program, setProgram] = useState<TrainingProgram | null>(null);
  const [saving, setSaving] = useState(false);
  const [newProgram, setNewProgram] = useState<TrainingProgram | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/coach/program`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.program) setProgram(d.program); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveProgram() {
    if (!newProgram) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/coach/program`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ program: newProgram }),
      });
      if (!res.ok) throw new Error('Save failed');
      setProgram(newProgram);
      setNewProgram(null);
      toast.success('Program saved!');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const displayProgram = newProgram || program;
  const accessories = latestPlan?.bench_day_plan?.accessories?.slice(0, 3) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">

      {/* Empty state */}
      {!displayProgram && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-10 flex flex-col items-center text-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 border border-primary/20">
              <Dumbbell className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-semibold">No program yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Use the <span className="font-medium text-foreground">New Program</span> button in the top-right to generate your personalized training plan.
              </p>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Program display */}
      {displayProgram && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Program overview banner */}
          <Card className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-base font-bold">{displayProgram.goal}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Personalized training program</p>
              </div>
              {newProgram && (
                <Button onClick={saveProgram} disabled={saving} size="sm" variant="outline" className="rounded-xl text-xs shrink-0">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save Program
                </Button>
              )}
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Duration</p>
                <p className="text-sm font-bold mt-0.5">{displayProgram.durationWeeks} weeks</p>
              </div>
              <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Frequency</p>
                <p className="text-sm font-bold mt-0.5">{displayProgram.daysPerWeek}×/week</p>
              </div>
              <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Phases</p>
                <p className="text-sm font-bold mt-0.5">{displayProgram.phases?.length || 1}</p>
              </div>
            </div>

            {/* Phase timeline */}
            {displayProgram.phases && displayProgram.phases.length > 1 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Program Arc</p>
                <PhaseTimeline phases={displayProgram.phases} />
              </div>
            )}
          </Card>

          {/* Phased display */}
          {displayProgram.phases && displayProgram.phases.length > 0 ? (
            <div className="space-y-3">
              {displayProgram.phases.map((phase, i) => (
                <PhaseCard key={i} phase={phase} defaultOpen={i === 0} />
              ))}
            </div>
          ) : (
            /* Legacy flat week display */
            <div className="space-y-4">
              {(displayProgram.weeks || []).slice(0, 2).map(week => (
                <Card key={week.weekNumber} className="p-5 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Week {week.weekNumber}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {week.days.map((day, di) => {
                      const dayStyle = getDayStyle(day.day);
                      return (
                        <div key={di} className={`rounded-xl border overflow-hidden ${dayStyle.card}`}>
                          <div className={`h-0.5 w-full ${dayStyle.bar}`} />
                          <div className="p-3 space-y-2">
                            <div>
                              <p className="text-xs font-bold">{day.day}</p>
                              <p className="text-[10px] opacity-70">{day.focus}</p>
                            </div>
                            <div className="space-y-1.5">
                              {(day.sessions || []).map((s, si) => (
                                <ExerciseRow key={si} ex={s} />
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
              {(displayProgram.progressionNotes || []).length > 0 && (
                <Card className="p-5 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Progression Guidelines</p>
                  {(displayProgram.progressionNotes || []).map((note, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-primary mt-0.5">→</span>
                      <span>{note}</span>
                    </div>
                  ))}
                </Card>
              )}
            </div>
          )}

          {/* Autoregulation */}
          {displayProgram.autoregulationRules && displayProgram.autoregulationRules.length > 0 && (
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-yellow-500" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Autoregulation (RPE/RIR Rules)</p>
              </div>
              {displayProgram.autoregulationRules.map((rule, i) => (
                <p key={i} className="text-xs text-foreground leading-relaxed">· {rule}</p>
              ))}
            </Card>
          )}

          {/* Tracking metrics */}
          {displayProgram.trackingMetrics && displayProgram.trackingMetrics.length > 0 && (
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What to Track Each Session</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {displayProgram.trackingMetrics.map((metric, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                    <Target className="h-3 w-3 text-muted-foreground shrink-0" />
                    <p className="text-xs text-foreground">{metric}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </motion.div>
      )}

      {/* Evidence-based accessories from latest analysis */}
      {accessories.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="p-5 space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evidence-Based Add-ons</p>
              <p className="text-xs text-muted-foreground mt-1">From your most recent analysis — prioritized by impact on your identified weakness:</p>
            </div>
            {accessories.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-3 rounded-xl bg-muted/30 border border-border/40 px-3 py-3">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  a.priority === 1 ? 'bg-primary/10 text-primary' :
                  a.priority === 2 ? 'bg-amber-500/10 text-amber-600' :
                  'bg-muted text-muted-foreground'
                }`}>
                  P{a.priority}
                </span>
                <div>
                  <p className="text-sm font-semibold">{a.exercise_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.sets}×{a.reps} — {a.why}</p>
                </div>
              </div>
            ))}
          </Card>
        </motion.div>
      )}
    </div>
  );
}
