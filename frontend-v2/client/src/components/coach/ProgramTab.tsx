import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Dumbbell, Save, ChevronDown, ChevronUp, Flame, Moon, Zap, BarChart2, RotateCcw } from 'lucide-react';

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
  // Legacy support
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
  // Legacy
  weeks?: Array<{ weekNumber: number; days: Array<{ day: string; focus: string; sessions: ProgramExercise[] }> }>;
  progressionNotes?: string[];
}

interface Props {
  latestPlan: any;
  isPro: boolean;
}

const GOAL_OPTIONS = [
  { value: 'Strength Peak', label: 'Strength Peak', desc: 'Max strength, low reps, high intensity' },
  { value: 'Hypertrophy', label: 'Hypertrophy', desc: 'Muscle building, moderate reps' },
  { value: 'Power', label: 'Power', desc: 'Explosive strength and rate of force development' },
  { value: 'Recomp', label: 'Body Recomp', desc: 'Simultaneous fat loss and muscle gain' },
];

const DAYS_OPTIONS = [3, 4, 5, 6];
const DURATION_OPTIONS = [4, 8, 12];

const PHASE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  'Foundation': { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-700 dark:text-blue-400', badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  'Correction': { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-700 dark:text-blue-400', badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  'Build': { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  'Hypertrophy': { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  'Peak': { bg: 'bg-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-700 dark:text-rose-400', badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  'Strength': { bg: 'bg-rose-500/5', border: 'border-rose-500/20', text: 'text-rose-700 dark:text-rose-400', badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
};

function getPhaseStyle(name: string) {
  for (const [key, style] of Object.entries(PHASE_COLORS)) {
    if (name.includes(key)) return style;
  }
  return { bg: 'bg-muted/30', border: 'border-muted', text: 'text-foreground', badge: 'bg-muted text-muted-foreground' };
}

const DAY_FOCUS_COLORS: Record<string, string> = {
  push: 'bg-blue-500/10 border-blue-500/30',
  pull: 'bg-green-500/10 border-green-500/30',
  leg: 'bg-purple-500/10 border-purple-500/30',
  squat: 'bg-purple-500/10 border-purple-500/30',
  dead: 'bg-amber-500/10 border-amber-500/30',
  upper: 'bg-blue-500/10 border-blue-500/30',
  lower: 'bg-purple-500/10 border-purple-500/30',
  bench: 'bg-blue-500/10 border-blue-500/30',
  full: 'bg-rose-500/10 border-rose-500/30',
  hinge: 'bg-amber-500/10 border-amber-500/30',
  hip: 'bg-amber-500/10 border-amber-500/30',
};

function getDayColor(day: string) {
  const lower = day.toLowerCase();
  for (const [key, cls] of Object.entries(DAY_FOCUS_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return 'bg-muted/30 border-muted';
}

function PhaseCard({ phase, defaultOpen }: { phase: ProgramPhase; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const style = getPhaseStyle(phase.phaseName);

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} overflow-hidden`}>
      {/* Phase header */}
      <button
        className="w-full text-left p-5 flex items-center justify-between"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
            Phase {phase.phaseNumber}
          </span>
          <div>
            <p className={`text-sm font-bold ${style.text}`}>{phase.phaseName}</p>
            <p className="text-[10px] text-muted-foreground">{phase.weeksLabel} · {phase.durationWeeks} weeks</p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
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
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Coach Rationale</p>
                <p className="text-xs text-foreground leading-relaxed">{phase.rationale}</p>
              </div>

              {/* Training days */}
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Template Week</p>
                {phase.trainingDays.map((day, di) => {
                  const exercises = day.exercises || day.sessions || [];
                  return (
                    <div key={di} className={`rounded-xl border p-4 space-y-3 ${getDayColor(day.day)}`}>
                      <div>
                        <p className="text-xs font-bold">{day.day}</p>
                        <p className="text-[10px] text-muted-foreground opacity-80">{day.focus}</p>
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
                          <div key={ei} className="rounded-lg bg-background/70 px-3 py-2">
                            <p className="text-xs font-semibold">{ex.exercise}</p>
                            <p className="text-[11px] text-muted-foreground">{ex.sets}×{ex.reps} · {ex.intensity}</p>
                            {ex.notes && <p className="text-[10px] text-muted-foreground italic mt-0.5">{ex.notes}</p>}
                          </div>
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
                  );
                })}
              </div>

              {/* Progression + Deload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {phase.progressionNotes && phase.progressionNotes.length > 0 && (
                  <div className="rounded-xl bg-background/60 border border-border/50 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Progression Rules</p>
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

export function ProgramTab({ latestPlan, isPro }: Props) {
  const [goal, setGoal] = useState('Strength Peak');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [program, setProgram] = useState<TrainingProgram | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedProgram, setSavedProgram] = useState<TrainingProgram | null>(null);
  const [view, setView] = useState<'saved' | 'new'>('saved');

  useEffect(() => {
    fetch(`${API_BASE}/coach/program`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.program) {
          setSavedProgram(d.program);
          setView('saved');
        } else {
          setView('new');
        }
      })
      .catch(() => setView('new'));
  }, []);

  async function generateProgram() {
    if (!isPro) return toast.error('Pro feature');
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/coach/program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ goal, daysPerWeek, durationWeeks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setProgram(data);
      setView('new');
      toast.success('Program generated!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate program');
    } finally {
      setGenerating(false);
    }
  }

  async function saveProgram() {
    if (!program) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/coach/program`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ program }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSavedProgram(program);
      toast.success('Program saved!');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const displayProgram = view === 'saved' ? savedProgram : program;
  const accessories = latestPlan?.bench_day_plan?.accessories?.slice(0, 3) || [];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Program builder */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-5 space-y-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Build Your Program</p>

          {/* Goal selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Training Goal</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {GOAL_OPTIONS.map(g => (
                <button
                  key={g.value}
                  onClick={() => setGoal(g.value)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    goal === g.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background hover:bg-muted/50'
                  }`}
                >
                  <p className="text-xs font-semibold">{g.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{g.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Days per week */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Days Per Week</p>
            <div className="flex gap-2">
              {DAYS_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDaysPerWeek(d)}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                    daysPerWeek === d
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background hover:bg-muted/50'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <p className="text-xs font-medium">Duration</p>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map(w => (
                <button
                  key={w}
                  onClick={() => setDurationWeeks(w)}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                    durationWeeks === w
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background hover:bg-muted/50'
                  }`}
                >
                  {w} wks
                </button>
              ))}
            </div>
          </div>

          <Button onClick={generateProgram} disabled={generating || !isPro} className="w-full rounded-xl">
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating phased program…</>
            ) : (
              <><Dumbbell className="h-4 w-4 mr-2" />Generate {durationWeeks}-Week Program</>
            )}
          </Button>
          {!isPro && <p className="text-xs text-center text-muted-foreground">Program generation is a Pro feature.</p>}
          {isPro && (
            <p className="text-[10px] text-center text-muted-foreground">
              Your program will be personalized using your consultation profile and diagnostic data.
            </p>
          )}
        </Card>
      </motion.div>

      {/* View toggle if both exist */}
      {savedProgram && program && program !== savedProgram && (
        <div className="flex gap-2">
          <Button size="sm" variant={view === 'saved' ? 'default' : 'outline'} className="rounded-xl text-xs" onClick={() => setView('saved')}>
            Saved Program
          </Button>
          <Button size="sm" variant={view === 'new' ? 'default' : 'outline'} className="rounded-xl text-xs" onClick={() => setView('new')}>
            New Program
          </Button>
        </div>
      )}

      {/* Program display */}
      {displayProgram && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Program header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-base">{displayProgram.goal} — {displayProgram.durationWeeks} Weeks</p>
              <p className="text-xs text-muted-foreground">{displayProgram.daysPerWeek} days/week · {displayProgram.phases?.length || 1} phase{(displayProgram.phases?.length || 1) > 1 ? 's' : ''}</p>
            </div>
            {view === 'new' && program && (
              <Button onClick={saveProgram} disabled={saving} size="sm" variant="outline" className="rounded-xl text-xs shrink-0">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save Program
              </Button>
            )}
          </div>

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
                    {week.days.map((day, di) => (
                      <div key={di} className={`rounded-xl border p-3 space-y-2 ${getDayColor(day.day)}`}>
                        <div>
                          <p className="text-xs font-bold">{day.day}</p>
                          <p className="text-[10px] opacity-70">{day.focus}</p>
                        </div>
                        <div className="space-y-1.5">
                          {(day.sessions || []).map((s, si) => (
                            <div key={si} className="rounded-lg bg-background/60 px-2 py-1.5">
                              <p className="text-xs font-medium">{s.exercise}</p>
                              <p className="text-[10px] text-muted-foreground">{s.sets}×{s.reps} @ {s.intensity}</p>
                              {s.notes && <p className="text-[10px] text-muted-foreground italic">{s.notes}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
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
              {displayProgram.trackingMetrics.map((metric, i) => (
                <p key={i} className="text-xs text-foreground">· {metric}</p>
              ))}
            </Card>
          )}
        </motion.div>
      )}

      {/* Evidence-based accessories from latest analysis */}
      {accessories.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evidence-Based Add-ons</p>
            <p className="text-xs text-muted-foreground">From your most recent analysis — prioritized by impact on your identified weakness:</p>
            {accessories.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  a.priority === 1 ? 'bg-primary/10 text-primary' :
                  a.priority === 2 ? 'bg-amber-500/10 text-amber-600' :
                  'bg-muted text-muted-foreground'
                }`}>
                  P{a.priority}
                </span>
                <div>
                  <p className="text-sm font-medium">{a.exercise_name}</p>
                  <p className="text-xs text-muted-foreground">{a.sets}×{a.reps} — {a.why}</p>
                </div>
              </div>
            ))}
          </Card>
        </motion.div>
      )}
    </div>
  );
}
