import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dumbbell } from 'lucide-react';
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
  impact?: {
    bodyComposition: string;
    energy: string;
    mood: string;
    recovery: string;
  };
  expectedOutcomes?: {
    tdee: number;
    surplusOrDeficit: number;
    weeklyWeightChangeLb: number;
    monthlyWeightChangeLb: number;
    strengthGainNote: string;
  };
}

export interface MealSuggestion {
  name: string;
  description: string;
  mealType: string;
  macros: { proteinG: number; carbsG: number; fatG: number; calories: number };
  estimatedCostUSD: number;
  prepMinutes: number;
  keyIngredients: string[];
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

const DURATION_OPTIONS = [
  { weeks: 4, label: '4 Weeks', sublabel: 'Introductory / Deload block' },
  { weeks: 8, label: '8 Weeks', sublabel: 'Standard mesocycle', recommended: true },
  { weeks: 12, label: '12 Weeks', sublabel: 'Full macrocycle' },
  { weeks: 16, label: '16 Weeks', sublabel: 'Competition prep' },
];

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
        // goal is intentionally omitted — backend infers from trainingPreference
        body: JSON.stringify({ daysPerWeek, durationWeeks, gender: coachProfile?.gender || null }),
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

  // Infer goal label from coachProfile for display only
  const inferredGoalLabel = (() => {
    const pref = (coachProfile?.trainingPreference || '').toLowerCase();
    if (pref === 'strength') return 'Strength Peak';
    if (pref === 'hypertrophy') return 'Hypertrophy';
    if (pref === 'athletic') return 'Power / Athletic';
    if (pref === 'mixed') return 'Body Recomp';
    return 'Strength Peak';
  })();

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
            {userName ? `${userName.split(' ')[0]}, your` : 'Your'} program goal has been set to <span className="font-semibold text-foreground">{inferredGoalLabel}</span> based on your intake. Adjust duration and days below.
          </p>
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
            {inferredGoalLabel} · {durationWeeks} weeks · {daysPerWeek} days/week
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
