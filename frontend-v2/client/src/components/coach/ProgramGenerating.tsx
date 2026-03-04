import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Target, Dumbbell, BarChart2, Zap, Sparkles, Apple } from 'lucide-react';

const STAGES = [
  { icon: Brain,    label: 'Reading your profile',         desc: 'Intake data, goals, and training history…' },
  { icon: Target,   label: 'Mapping your weak points',     desc: 'Aligning diagnostic signals to exercise selection…' },
  { icon: Dumbbell, label: 'Structuring your phases',      desc: 'Building Foundation → Build → Peak periodization…' },
  { icon: BarChart2,label: 'Calibrating progression',      desc: 'Setting RPE targets and progression triggers…' },
  { icon: Zap,      label: 'Applying textbook protocols',  desc: 'Cross-referencing NASM/NCSF methodologies…' },
  { icon: Apple,    label: 'Building your nutrition plan', desc: 'Calculating macros for your goal and body weight…' },
  { icon: Sparkles, label: 'Finalizing your program',      desc: 'Putting it all together…' },
];

const FACTS = [
  'Periodization was pioneered by Soviet sports scientists in the 1960s.',
  'RPE-based training adapts to daily readiness better than fixed percentages.',
  'The Foundation phase uses supercompensation to prime the body for heavier loading.',
  "NASM's OPT model starts with stabilization before adding strength or power phases.",
  'Weak lockout = triceps or shoulder stability; weak off the chest = pec recruitment.',
  'Deload weeks reduce accumulated fatigue while preserving strength adaptations.',
  'Close-grip bench:bench ratio below 0.9 suggests triceps are the primary limiter.',
  'NCSF recommends 0.8g/lb of bodyweight protein minimum for strength athletes.',
  'Sleep is the single highest-leverage recovery variable for strength adaptation.',
];

export function ProgramGenerating() {
  const [stageIdx, setStageIdx] = useState(0);
  const [factIdx, setFactIdx] = useState(0);

  useEffect(() => {
    // Advance through stages every ~7s (total ~49s for 7 stages)
    const stageTimer = setInterval(() => {
      setStageIdx(i => Math.min(i + 1, STAGES.length - 1));
    }, 7000);

    const factTimer = setInterval(() => {
      setFactIdx(i => (i + 1) % FACTS.length);
    }, 5000);

    return () => {
      clearInterval(stageTimer);
      clearInterval(factTimer);
    };
  }, []);

  const progress = Math.min(((stageIdx + 1) / STAGES.length) * 90 + 5, 95);
  const CurrentIcon = STAGES[stageIdx].icon;

  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-120px)] px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8 text-center"
      >
        {/* Animated icon */}
        <div className="relative mx-auto w-24 h-24">
          <motion.div
            className="absolute inset-0 rounded-3xl bg-primary/10"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-3xl border-2 border-primary/20"
            animate={{ scale: [1, 1.15, 1], opacity: [1, 0, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={stageIdx}
                initial={{ scale: 0.6, opacity: 0, rotate: -15 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.6, opacity: 0, rotate: 15 }}
                transition={{ duration: 0.35 }}
              >
                <CurrentIcon className="h-10 w-10 text-primary" />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Heading + stage label */}
        <div className="space-y-2">
          <h2 className="text-xl font-bold">Building your program…</h2>
          <AnimatePresence mode="wait">
            <motion.div
              key={stageIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="space-y-0.5"
            >
              <p className="text-sm font-medium text-foreground">{STAGES[stageIdx].label}</p>
              <p className="text-xs text-muted-foreground">{STAGES[stageIdx].desc}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          {/* Stage dots */}
          <div className="flex items-center justify-center gap-1">
            {STAGES.map((_, i) => (
              <motion.div
                key={i}
                className="rounded-full"
                animate={{
                  width: i === stageIdx ? 16 : 6,
                  height: 6,
                  backgroundColor: i <= stageIdx ? 'var(--primary)' : 'var(--muted)',
                  opacity: i <= stageIdx ? 1 : 0.4,
                }}
                transition={{ duration: 0.3 }}
              />
            ))}
          </div>
        </div>

        {/* Rotating fact card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={factIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="rounded-xl bg-muted/40 border border-border/60 px-5 py-4"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Did you know?
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">{FACTS[factIdx]}</p>
          </motion.div>
        </AnimatePresence>

        <p className="text-xs text-muted-foreground">
          30–60 seconds — personalizing your training program and nutrition plan.
        </p>
      </motion.div>
    </div>
  );
}
