import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ChevronLeft, ChevronRight, Dumbbell, Zap, Target, Loader2,
  CheckCircle2, RotateCcw, Calendar, Flame, Moon
} from 'lucide-react';
import { toast } from 'sonner';
import type { TrainingProgram, ProgramPhase } from './ProgramSetup';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Props {
  program: TrainingProgram;
  userName: string | null;
  coachProfile: Record<string, any> | null;
  onSaved: () => void;
  onAdjust: () => void;
}

const PHASE_COLORS: Record<string, { badge: string; border: string }> = {
  Foundation: { badge: 'bg-blue-500/15 text-blue-600', border: 'border-blue-500/30' },
  'Foundation/Correction': { badge: 'bg-blue-500/15 text-blue-600', border: 'border-blue-500/30' },
  Corrective: { badge: 'bg-blue-500/15 text-blue-600', border: 'border-blue-500/30' },
  Build: { badge: 'bg-purple-500/15 text-purple-600', border: 'border-purple-500/30' },
  Hypertrophy: { badge: 'bg-purple-500/15 text-purple-600', border: 'border-purple-500/30' },
  'Build/Hypertrophy': { badge: 'bg-purple-500/15 text-purple-600', border: 'border-purple-500/30' },
  Peak: { badge: 'bg-orange-500/15 text-orange-600', border: 'border-orange-500/30' },
  Strength: { badge: 'bg-orange-500/15 text-orange-600', border: 'border-orange-500/30' },
  'Peak/Strength': { badge: 'bg-orange-500/15 text-orange-600', border: 'border-orange-500/30' },
};

function getPhaseBadge(name: string) {
  return PHASE_COLORS[name] || { badge: 'bg-primary/10 text-primary', border: 'border-primary/20' };
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

// Slide 0: Welcome
function WelcomeSlide({ program, userName }: { program: TrainingProgram; userName: string | null }) {
  return (
    <div className="text-center space-y-6 py-8">
      <div className="grid h-20 w-20 place-items-center rounded-3xl bg-primary/10 mx-auto">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Your program is ready{userName ? `, ${userName.split(' ')[0]}` : ''}.</h2>
        <p className="text-muted-foreground">Your personalized training plan has been built from your intake data.</p>
      </div>
      <div className="flex items-center justify-center gap-6 pt-2">
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{program.durationWeeks}</p>
          <p className="text-xs text-muted-foreground">Weeks</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{program.phases?.length || 1}</p>
          <p className="text-xs text-muted-foreground">Phases</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{program.daysPerWeek}</p>
          <p className="text-xs text-muted-foreground">Days/week</p>
        </div>
      </div>
      <div className="rounded-xl bg-muted/50 border px-6 py-4 inline-block">
        <p className="text-sm font-semibold">{formatGoal(program.goal)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Primary training goal</p>
      </div>
      <p className="text-xs text-muted-foreground">Continue to see your full program breakdown →</p>
    </div>
  );
}

// Slide 1: Profile summary
function ProfileSlide({ program, coachProfile }: { program: TrainingProgram; coachProfile: Record<string, any> | null }) {
  const signals = [
    coachProfile?.primaryGoal && { label: 'Goal', value: coachProfile.primaryGoal },
    coachProfile?.trainingPreference && { label: 'Training style', value: coachProfile.trainingPreference },
    coachProfile?.trainingAge && { label: 'Training age', value: coachProfile.trainingAge },
    coachProfile?.equipment && { label: 'Equipment', value: coachProfile.equipment },
    coachProfile?.sleep && { label: 'Sleep quality', value: coachProfile.sleep },
    coachProfile?.stressEnergy && { label: 'Stress/energy', value: coachProfile.stressEnergy },
    coachProfile?.injuries && { label: 'Constraints', value: coachProfile.injuries },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="space-y-5 py-4">
      <div>
        <h2 className="text-xl font-bold mb-1">Here's what I used to build this.</h2>
        <p className="text-sm text-muted-foreground">Your program was personalized based on these key signals from your consultation.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {signals.map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-muted/50 border px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
            <p className="text-sm font-medium capitalize">{value}</p>
          </div>
        ))}
        {signals.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">Profile data not available.</p>
        )}
      </div>
      {(coachProfile?.sleep === 'poor' || coachProfile?.sleep === 'very_poor' ||
        coachProfile?.stressEnergy === 'high_stress' || coachProfile?.stressEnergy === 'burnout') && (
        <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <Moon className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              Based on your recovery status, weekly volume has been reduced by ~15–20% with an emphasis on quality over quantity.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Slide 2: Why this structure
function StructureSlide({ program }: { program: TrainingProgram }) {
  const firstPhaseRationale = program.phases?.[0]?.rationale;
  return (
    <div className="space-y-5 py-4">
      <div>
        <h2 className="text-xl font-bold mb-1">Why this structure.</h2>
        <p className="text-sm text-muted-foreground">The periodization approach behind your program.</p>
      </div>
      {program.phases && program.phases.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-4">
            <p className="text-sm leading-relaxed">{firstPhaseRationale || 'Progressive periodization structured around your identified weaknesses.'}</p>
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phase Overview</p>
          <div className="space-y-2">
            {program.phases.map((phase) => {
              const colors = getPhaseBadge(phase.phaseName);
              return (
                <div key={phase.phaseNumber} className={`rounded-xl border px-4 py-3 flex items-center justify-between ${colors.border}`}>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${colors.badge}`}>
                      Phase {phase.phaseNumber}
                    </span>
                    <span className="text-sm font-semibold">{phase.phaseName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{phase.weeksLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Phase slide (one per phase)
function PhaseSlide({ phase }: { phase: ProgramPhase }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(0);
  const colors = getPhaseBadge(phase.phaseName);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-3">
        <span className={`rounded-lg px-3 py-1 text-sm font-bold ${colors.badge}`}>
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
          <div key={idx} className={`rounded-xl border overflow-hidden ${colors.border}`}>
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
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-500 mb-1">Warm-up</p>
                        <ul className="space-y-0.5">
                          {day.warmup.map((w, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <Flame className="h-3 w-3 shrink-0 mt-0.5 text-orange-400" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1">Exercises</p>
                      <div className="space-y-2">
                        {day.exercises.map((ex, i) => (
                          <div key={i} className="rounded-lg bg-background border px-3 py-2">
                            <p className="text-xs font-semibold">{ex.exercise}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {ex.sets}×{ex.reps} · {ex.intensity}
                            </p>
                            {ex.notes && (
                              <p className="text-[10px] text-muted-foreground italic mt-0.5">{ex.notes}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {day.cooldown && day.cooldown.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 mb-1">Cool-down</p>
                        <ul className="space-y-0.5">
                          {day.cooldown.map((c, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <Moon className="h-3 w-3 shrink-0 mt-0.5 text-blue-400" />
                              {c}
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

// Progression slide
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
          <div className="space-y-2">
            {program.autoregulationRules.map((rule, i) => (
              <div key={i} className="rounded-xl bg-muted/40 border px-4 py-3">
                <p className="text-sm leading-relaxed">{rule}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {program.phases && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phase Progression Notes</p>
          {program.phases.map((phase) => (
            phase.progressionNotes && phase.progressionNotes.length > 0 && (
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
            )
          ))}
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

// Confirm slide
function ConfirmSlide({
  program,
  saving,
  onSave,
  onAdjust,
}: {
  program: TrainingProgram;
  saving: boolean;
  onSave: () => void;
  onAdjust: () => void;
}) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-green-500/10 mx-auto">
        <Target className="h-8 w-8 text-green-500" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">This is your program. Let's go.</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {program.durationWeeks} weeks of {formatGoal(program.goal).toLowerCase()} training, {program.daysPerWeek} days per week, built specifically for you.
        </p>
      </div>
      <div className="flex items-center justify-center gap-4">
        <div className="text-center">
          <Dumbbell className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">{program.phases?.length || 1} phases</p>
        </div>
        <div className="text-center">
          <Calendar className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">{program.daysPerWeek} days/week</p>
        </div>
        <div className="text-center">
          <Zap className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">RPE-based</p>
        </div>
      </div>
      <div className="space-y-3">
        <Button
          className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-green-600 to-primary shadow-lg"
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

export function ProgramWalkthrough({ program, userName, coachProfile, onSaved, onAdjust }: Props) {
  const phases = program.phases || [];
  // Build slide sequence: welcome(0), profile(1), structure(2), ...phases, progression, confirm
  const PHASE_START = 3;
  const progressionSlideIdx = PHASE_START + phases.length;
  const confirmSlideIdx = progressionSlideIdx + 1;
  const totalSlides = confirmSlideIdx + 1;

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
      toast.success('Program saved! Today\'s workout is ready.');
      onSaved();
    } catch {
      toast.error('Failed to save program. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderSlide() {
    if (slide === 0) return <WelcomeSlide program={program} userName={userName} />;
    if (slide === 1) return <ProfileSlide program={program} coachProfile={coachProfile} />;
    if (slide === 2) return <StructureSlide program={program} />;
    if (slide >= PHASE_START && slide < progressionSlideIdx) {
      return <PhaseSlide phase={phases[slide - PHASE_START]} />;
    }
    if (slide === progressionSlideIdx) return <ProgressionSlide program={program} />;
    if (slide === confirmSlideIdx) return (
      <ConfirmSlide program={program} saving={saving} onSave={handleSave} onAdjust={onAdjust} />
    );
    return null;
  }

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <div className="flex-1 flex flex-col min-h-[calc(100vh-120px)]">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 pb-32">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={slide}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: 'easeInOut' }}
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
                    : 'w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/60'
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
            <div className="w-16" /> /* spacer to keep dots centered */
          )}
        </div>
      </div>
    </div>
  );
}
