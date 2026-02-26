import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dumbbell, Zap, Target, RefreshCw, Check } from 'lucide-react';
import { ProgramGenerating } from './ProgramGenerating';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

export interface ProgramExercise {
  exercise: string;
  sets: number;
  reps: string;
  intensity: string;
  notes?: string;
}

export interface ProgramDay {
  day: string;
  focus: string;
  warmup: string[];
  exercises: ProgramExercise[];
  cooldown: string[];
}

export interface ProgramPhase {
  phaseNumber: number;
  phaseName: string;
  rationale: string;
  durationWeeks: number;
  weeksLabel: string;
  trainingDays: ProgramDay[];
  progressionNotes: string[];
  deloadProtocol: string;
}

export interface NutritionPlanResult {
  macros: { proteinG: number; carbsG: number; fatG: number; calories: number };
  foods: Array<{ name: string; reason: string }>;
  rationale: string;
}

export interface TrainingProgram {
  goal: string;
  daysPerWeek: number;
  durationWeeks: number;
  phases: ProgramPhase[];
  autoregulationRules: string[];
  trackingMetrics: string[];
  nutritionPlan?: NutritionPlanResult;
}

interface Props {
  userName: string | null;
  coachProfile: Record<string, any> | null;
  onGenerated: (program: TrainingProgram) => void;
  onUpdateIntake?: () => void;
}

const GOAL_OPTIONS = [
  {
    id: 'strength',
    label: 'Strength Peak',
    desc: 'Max strength, low reps, high intensity',
    icon: Target,
  },
  {
    id: 'hypertrophy',
    label: 'Hypertrophy',
    desc: 'Muscle growth, moderate reps',
    icon: Dumbbell,
  },
  {
    id: 'athletic',
    label: 'Power',
    desc: 'Speed-strength, athletic performance',
    icon: Zap,
  },
  {
    id: 'mixed',
    label: 'Body Recomp',
    desc: 'Strength + fat loss balance',
    icon: RefreshCw,
  },
] as const;

type GoalId = typeof GOAL_OPTIONS[number]['id'];

const DURATION_OPTIONS = [
  { weeks: 4, label: '4 Weeks', sublabel: 'Introductory / Deload block' },
  { weeks: 8, label: '8 Weeks', sublabel: 'Standard mesocycle', recommended: true },
  { weeks: 12, label: '12 Weeks', sublabel: 'Full macrocycle' },
  { weeks: 16, label: '16 Weeks', sublabel: 'Competition prep' },
];

function inferGoalFromProfile(profile: Record<string, any> | null): GoalId {
  const pref = (profile?.trainingPreference || '').toLowerCase();
  if (pref.includes('strength') || pref.includes('strong')) return 'strength';
  if (pref.includes('hypertro') || pref.includes('muscle') || pref.includes('size')) return 'hypertrophy';
  if (pref.includes('athletic') || pref.includes('power') || pref.includes('sport')) return 'athletic';
  if (pref.includes('recomp') || pref.includes('fat') || pref.includes('weight loss')) return 'mixed';
  const goal = (profile?.primaryGoal || '').toLowerCase();
  if (goal.includes('strength')) return 'strength';
  if (goal.includes('muscle') || goal.includes('hypertro')) return 'hypertrophy';
  if (goal.includes('athletic') || goal.includes('power')) return 'athletic';
  return 'strength';
}

function inferDaysFromProfile(profile: Record<string, any> | null): number {
  const raw = profile?.daysPerWeek;
  if (typeof raw === 'number' && raw >= 3 && raw <= 6) return raw;
  if (typeof raw === 'string') {
    const n = parseInt(raw);
    if (n >= 3 && n <= 6) return n;
  }
  return 4;
}

export function ProgramSetup({ userName, coachProfile, onGenerated, onUpdateIntake }: Props) {
  const [goal, setGoal] = useState<GoalId>(() => inferGoalFromProfile(coachProfile));
  const [durationWeeks, setDurationWeeks] = useState<number>(8);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(() => inferDaysFromProfile(coachProfile));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/coach/program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ goal, daysPerWeek, durationWeeks }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate program');
      }
      const program: TrainingProgram = await resp.json();
      onGenerated(program);
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <ProgramGenerating />;

  const selectedGoalLabel = GOAL_OPTIONS.find(o => o.id === goal)?.label || goal;

  return (
    <div className="flex-1 flex items-center justify-center p-4 md:p-8 min-h-[calc(100vh-120px)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl space-y-6"
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 mx-auto mb-4">
            <Dumbbell className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Let's build your program</h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {userName ? `${userName.split(' ')[0]}, I've` : "I've"} pre-selected the best options from your intake. Adjust as needed.
          </p>
        </div>

        {/* Goal selector */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Training Goal</p>
          <div className="grid grid-cols-2 gap-3">
            {GOAL_OPTIONS.map(opt => {
              const Icon = opt.icon;
              const active = goal === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setGoal(opt.id)}
                  className={`relative rounded-xl border p-4 text-left transition-all ${
                    active
                      ? 'bg-primary/10 border-primary'
                      : 'bg-background border-border hover:bg-muted/50'
                  }`}
                >
                  {active && (
                    <span className="absolute top-2.5 right-2.5">
                      <Check className="h-4 w-4 text-primary" />
                    </span>
                  )}
                  <Icon className={`h-5 w-5 mb-2 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className={`text-sm font-semibold ${active ? 'text-primary' : ''}`}>{opt.label}</p>
                  <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Duration selector */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Program Duration</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DURATION_OPTIONS.map(opt => {
              const active = durationWeeks === opt.weeks;
              return (
                <button
                  key={opt.weeks}
                  onClick={() => setDurationWeeks(opt.weeks)}
                  className={`relative rounded-xl border p-3 text-left transition-all ${
                    active
                      ? 'bg-primary/10 border-primary'
                      : 'bg-background border-border hover:bg-muted/50'
                  }`}
                >
                  {opt.recommended && (
                    <span className="absolute -top-2 left-2 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground uppercase">
                      Popular
                    </span>
                  )}
                  <p className={`text-sm font-bold ${active ? 'text-primary' : ''}`}>{opt.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.sublabel}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Days per week */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days Per Week</p>
          <div className="flex gap-2">
            {[3, 4, 5, 6].map(d => (
              <button
                key={d}
                onClick={() => setDaysPerWeek(d)}
                className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition-all ${
                  daysPerWeek === d
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-background border-border hover:bg-muted/50'
                }`}
              >
                {d}
                <span className="block text-[10px] font-normal text-muted-foreground">days</span>
              </button>
            ))}
          </div>
        </div>

        {/* Summary card */}
        <Card className="p-4 bg-muted/30">
          <p className="text-xs text-muted-foreground mb-1">Program Summary</p>
          <p className="text-sm font-semibold">
            {selectedGoalLabel} · {durationWeeks} weeks · {daysPerWeek} days/week
          </p>
          {coachProfile?.sleep && (coachProfile.sleep === 'poor' || coachProfile.sleep === 'very_poor') && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Volume adjusted for recovery status ({coachProfile.sleep} sleep)
            </p>
          )}
        </Card>

        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}

        <Button
          className="w-full h-12 rounded-xl text-base font-semibold"
          onClick={handleGenerate}
          disabled={loading}
        >
          Generate My Program
        </Button>

        {onUpdateIntake && (
          <div className="text-center pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              Want to update your fitness profile first?{' '}
              <button
                onClick={onUpdateIntake}
                className="underline hover:text-foreground transition-colors"
                disabled={loading}
              >
                Re-take intake form
              </button>
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
