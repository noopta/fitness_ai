import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ChevronLeft, ChevronRight, Dumbbell, Zap, Target,
  Loader2, CheckCircle2, RotateCcw, Calendar, Sparkles, Apple, Beef, Wheat, Droplets
} from 'lucide-react';
import { toast } from 'sonner';
import type { TrainingProgram, ProgramPhase, NutritionPlanResult } from './ProgramSetup';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Props {
  program: TrainingProgram;
  userName: string | null;
  coachProfile: Record<string, any> | null;
  onSaved: () => void;
  onAdjust: () => void;
}

function formatGoal(goal: string) {
  const map: Record<string, string> = {
    strength: 'Strength Peak',
    hypertrophy: 'Hypertrophy',
    athletic: 'Power',
    mixed: 'Body Recomp',
  };
  return map[goal] || goal;
}

// ─── Slide 0: Welcome ──────────────────────────────────────────────────────────
function WelcomeSlide({ program, userName }: { program: TrainingProgram; userName: string | null }) {
  return (
    <div className="text-center space-y-6 py-8">
      <div className="grid h-20 w-20 place-items-center rounded-3xl bg-primary/10 mx-auto">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">
          Your program is ready{userName ? `, ${userName.split(' ')[0]}` : ''}.
        </h2>
        <p className="text-sm text-muted-foreground">
          Your personalized training plan has been built from your intake data.
        </p>
      </div>
      <div className="flex items-center justify-center gap-6 pt-2">
        {[
          { value: program.durationWeeks, label: 'Weeks' },
          { value: program.phases?.length || 1, label: 'Phases' },
          { value: program.daysPerWeek, label: 'Days/week' },
        ].map((stat, i) => (
          <div key={i} className="flex items-center gap-4">
            {i > 0 && <div className="h-8 w-px bg-border" />}
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="inline-block rounded-xl bg-muted/50 border px-6 py-4">
        <p className="text-sm font-semibold">{formatGoal(program.goal)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Primary training goal</p>
      </div>
      <p className="text-xs text-muted-foreground">Continue to see your full program breakdown →</p>
    </div>
  );
}

// ─── Slide 1: Profile Summary ─────────────────────────────────────────────────
function ProfileSlide({ coachProfile }: { coachProfile: Record<string, any> | null }) {
  const signals = [
    coachProfile?.primaryGoal && { label: 'Goal', value: coachProfile.primaryGoal },
    coachProfile?.trainingPreference && { label: 'Training style', value: coachProfile.trainingPreference },
    coachProfile?.trainingAge && { label: 'Training age', value: coachProfile.trainingAge },
    coachProfile?.equipment && { label: 'Equipment', value: coachProfile.equipment },
    coachProfile?.sleep && { label: 'Sleep quality', value: coachProfile.sleep },
    coachProfile?.stressEnergy && { label: 'Stress/energy', value: coachProfile.stressEnergy },
    coachProfile?.injuries && { label: 'Constraints', value: coachProfile.injuries },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const lowRecovery = coachProfile?.sleep === 'poor' || coachProfile?.sleep === 'very_poor' ||
    coachProfile?.stressEnergy === 'high_stress' || coachProfile?.stressEnergy === 'burnout';

  return (
    <div className="space-y-5 py-4">
      <div>
        <h2 className="text-xl font-bold mb-1">Here's what I used to build this.</h2>
        <p className="text-sm text-muted-foreground">
          Your program was personalized from these signals.
        </p>
      </div>
      {signals.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {signals.map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-muted/50 border px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
              <p className="text-sm font-medium capitalize">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Profile data not available.</p>
      )}
      {lowRecovery && (
        <Card className="p-4 border-border bg-muted/30">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Based on your recovery status, weekly volume has been adjusted with emphasis on quality over quantity.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Slide 2: Program Structure ───────────────────────────────────────────────
function StructureSlide({ program }: { program: TrainingProgram }) {
  return (
    <div className="space-y-5 py-4">
      <div>
        <h2 className="text-xl font-bold mb-1">Why this structure.</h2>
        <p className="text-sm text-muted-foreground">The periodization approach behind your program.</p>
      </div>
      {program.phases?.[0]?.rationale && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-4">
          <p className="text-sm leading-relaxed">{program.phases[0].rationale}</p>
        </div>
      )}
      {program.phases && program.phases.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phase Overview</p>
          {program.phases.map((phase) => (
            <div key={phase.phaseNumber} className="rounded-xl border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  Phase {phase.phaseNumber}
                </span>
                <span className="text-sm font-semibold">{phase.phaseName}</span>
              </div>
              <span className="text-xs text-muted-foreground">{phase.weeksLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Phase Slide ──────────────────────────────────────────────────────────────
function PhaseSlide({ phase }: { phase: ProgramPhase }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(0);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
          Phase {phase.phaseNumber}
        </span>
        <h2 className="text-xl font-bold">{phase.phaseName}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{phase.weeksLabel} · {phase.durationWeeks} weeks</p>

      <div className="rounded-xl bg-muted/40 border px-4 py-3">
        <p className="text-sm leading-relaxed text-foreground/90">{phase.rationale}</p>
      </div>

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template Week</p>
      <div className="space-y-2">
        {phase.trainingDays.map((day, idx) => (
          <div key={idx} className="rounded-xl border overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedDay(expandedDay === idx ? null : idx)}
            >
              <div>
                <p className="text-sm font-semibold">{day.day}</p>
                <p className="text-xs text-muted-foreground">{day.focus}</p>
              </div>
              <ChevronRight
                className={`h-4 w-4 text-muted-foreground transition-transform ${expandedDay === idx ? 'rotate-90' : ''}`}
              />
            </button>
            <AnimatePresence>
              {expandedDay === idx && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    {day.warmup && day.warmup.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Warm-up</p>
                        <ul className="space-y-0.5">
                          {day.warmup.map((w, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-primary mt-0.5">·</span> {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Exercises</p>
                      <div className="space-y-2">
                        {day.exercises.map((ex, i) => (
                          <div key={i} className="rounded-lg bg-background border px-3 py-2">
                            <p className="text-xs font-semibold">{ex.exercise}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {ex.sets}×{ex.reps} · {ex.intensity}
                            </p>
                            {ex.notes && (
                              <p className="text-[10px] text-muted-foreground/80 italic mt-0.5">{ex.notes}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {day.cooldown && day.cooldown.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Cool-down</p>
                        <ul className="space-y-0.5">
                          {day.cooldown.map((c, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-muted-foreground/60 mt-0.5">·</span> {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Progression Slide ────────────────────────────────────────────────────────
function ProgressionSlide({ program }: { program: TrainingProgram }) {
  return (
    <div className="space-y-5 py-4">
      <div>
        <h2 className="text-xl font-bold mb-1">Progression & Autoregulation</h2>
        <p className="text-sm text-muted-foreground">How to adjust intensity and progress each week.</p>
      </div>
      {program.autoregulationRules && program.autoregulationRules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Autoregulation Rules</p>
          {program.autoregulationRules.map((rule, i) => (
            <div key={i} className="rounded-xl bg-muted/40 border px-4 py-3">
              <p className="text-sm leading-relaxed">{rule}</p>
            </div>
          ))}
        </div>
      )}
      {program.phases && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phase Progression Notes</p>
          {program.phases.map((phase) =>
            phase.progressionNotes && phase.progressionNotes.length > 0 ? (
              <div key={phase.phaseNumber} className="rounded-xl bg-background border px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Phase {phase.phaseNumber}: {phase.phaseName}
                </p>
                <ul className="space-y-1">
                  {phase.progressionNotes.map((note, i) => (
                    <li key={i} className="text-xs flex items-start gap-1.5">
                      <Zap className="h-3 w-3 shrink-0 mt-0.5 text-primary" />
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
        </div>
      )}
      {program.trackingMetrics && program.trackingMetrics.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Track Each Session</p>
          <div className="rounded-xl bg-muted/40 border px-4 py-3">
            <ul className="space-y-1">
              {program.trackingMetrics.map((m, i) => (
                <li key={i} className="text-xs flex items-start gap-1.5">
                  <Calendar className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Nutrition Slide ──────────────────────────────────────────────────────────
function NutritionSlide({ plan }: { plan: NutritionPlanResult }) {
  const { macros, foods, rationale } = plan;
  const total = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
  const proteinPct = total > 0 ? Math.round((macros.proteinG * 4 / total) * 100) : 33;
  const carbsPct   = total > 0 ? Math.round((macros.carbsG   * 4 / total) * 100) : 33;
  const fatPct     = total > 0 ? Math.round((macros.fatG     * 9 / total) * 100) : 34;

  const macroRows = [
    { icon: Beef,    label: 'Protein', grams: macros.proteinG, pct: proteinPct, color: 'bg-rose-500',   text: 'text-rose-600 dark:text-rose-400' },
    { icon: Wheat,   label: 'Carbs',   grams: macros.carbsG,   pct: carbsPct,   color: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400' },
    { icon: Droplets,label: 'Fat',     grams: macros.fatG,     pct: fatPct,     color: 'bg-blue-500',   text: 'text-blue-600 dark:text-blue-400' },
  ];

  return (
    <div className="space-y-5 py-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-green-500/10 shrink-0">
          <Apple className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Your nutrition blueprint.</h2>
          <p className="text-sm text-muted-foreground">Dialed in for your training goal.</p>
        </div>
      </div>

      {/* Calorie target */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Daily Target</p>
          <p className="text-3xl font-bold mt-0.5">{macros.calories.toLocaleString()}</p>
        </div>
        <p className="text-sm text-muted-foreground font-medium">kcal / day</p>
      </div>

      {/* Macro bars */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Macro Breakdown</p>
        {macroRows.map(({ icon: Icon, label, grams, pct, color, text }) => (
          <div key={label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 ${text}`} />
                <span className="font-medium">{label}</span>
              </div>
              <span className={`font-bold ${text}`}>{grams}g <span className="text-muted-foreground font-normal">({pct}%)</span></span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${color}`}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 * macroRows.findIndex(r => r.label === label) }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Rationale */}
      <div className="rounded-xl bg-muted/40 border px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{rationale}</p>
      </div>

      {/* Key foods */}
      {foods && foods.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prioritize These Foods</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {foods.slice(0, 6).map((food, i) => (
              <div key={i} className="rounded-xl border bg-background px-3 py-2.5">
                <p className="text-xs font-semibold">{food.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{food.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Confirm Slide ────────────────────────────────────────────────────────────
function ConfirmSlide({
  program, saving, onSave, onAdjust,
}: {
  program: TrainingProgram;
  saving: boolean;
  onSave: () => void;
  onAdjust: () => void;
}) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 mx-auto">
        <Target className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">This is your program. Let's go.</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {program.durationWeeks} weeks · {formatGoal(program.goal).toLowerCase()} · {program.daysPerWeek} days/week
        </p>
      </div>
      <div className="flex items-center justify-center gap-6">
        {[
          { icon: Dumbbell, label: `${program.phases?.length || 1} phases` },
          { icon: Calendar, label: `${program.daysPerWeek} days/week` },
          { icon: Zap, label: 'RPE-based' },
        ].map(({ icon: Icon, label }, i) => (
          <div key={i} className="text-center">
            <Icon className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Button
          className="w-full h-12 rounded-xl text-base font-semibold"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Save &amp; Start Program
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full rounded-xl text-xs text-muted-foreground"
          onClick={onAdjust}
          disabled={saving}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Adjust parameters &amp; regenerate
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function ProgramWalkthrough({ program, userName, coachProfile, onSaved, onAdjust }: Props) {
  const phases = program.phases || [];
  const PHASE_START = 3;
  const progressionIdx = PHASE_START + phases.length;
  const hasNutrition = !!program.nutritionPlan;
  const nutritionIdx = progressionIdx + 1;
  const confirmIdx = hasNutrition ? nutritionIdx + 1 : progressionIdx + 1;
  const totalSlides = confirmIdx + 1;

  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);

  function goNext() {
    if (slide < totalSlides - 1) {
      setDirection(1);
      setSlide(s => s + 1);
    }
  }

  function goPrev() {
    if (slide > 0) {
      setDirection(-1);
      setSlide(s => s - 1);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/coach/program`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ program }),
      });
      if (!resp.ok) throw new Error('Failed to save');
      toast.success("Program saved! Today's workout is ready.");
      onSaved();
    } catch {
      toast.error('Failed to save program. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderSlide() {
    if (slide === 0) return <WelcomeSlide program={program} userName={userName} />;
    if (slide === 1) return <ProfileSlide coachProfile={coachProfile} />;
    if (slide === 2) return <StructureSlide program={program} />;
    if (slide >= PHASE_START && slide < progressionIdx) {
      return <PhaseSlide phase={phases[slide - PHASE_START]} />;
    }
    if (slide === progressionIdx) return <ProgressionSlide program={program} />;
    if (hasNutrition && slide === nutritionIdx) return <NutritionSlide plan={program.nutritionPlan!} />;
    return (
      <ConfirmSlide program={program} saving={saving} onSave={handleSave} onAdjust={onAdjust} />
    );
  }

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <div className="flex-1 flex flex-col min-h-[calc(100vh-120px)]">
      {/* Slide label */}
      <div className="px-4 pt-4 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Program Walkthrough · {slide + 1} / {totalSlides}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 pb-32">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={slide}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: 'easeInOut' }}
            >
              {renderSlide()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={goPrev}
            disabled={slide === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => { setDirection(i > slide ? 1 : -1); setSlide(i); }}
                className={`rounded-full transition-all ${
                  i === slide
                    ? 'w-4 h-2 bg-primary'
                    : i < slide
                    ? 'w-2 h-2 bg-primary/40'
                    : 'w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'
                }`}
              />
            ))}
          </div>

          {slide < totalSlides - 1 ? (
            <Button size="sm" className="rounded-xl" onClick={goNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <div className="w-16" />
          )}
        </div>
      </div>
    </div>
  );
}
