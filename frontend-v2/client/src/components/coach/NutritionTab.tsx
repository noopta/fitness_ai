import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Loader2, Sparkles, Apple, UtensilsCrossed, Clock, DollarSign,
  TrendingUp, Zap, Brain, Dumbbell, Check, AlertTriangle, ChevronDown, ChevronUp, Scale, Target,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { NutritionPlanResult, MealSuggestion } from './ProgramSetup';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface NutritionLog {
  id: string;
  date: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  notes?: string;
}

interface SessionSummary {
  selectedLift: string | null;
  primaryLimiter: string | null;
  plan: any;
}

interface Props {
  latestSession: SessionSummary | null;
  weightKg: number | null;
  trainingAge: string | null;
  coachGoal: string | null;
  coachBudget: string | null;
  savedNutritionPlan: NutritionPlanResult | null;
  isPro: boolean;
  savedProgramDurationWeeks?: number | null;
  programStartDate?: string | null;
  coachProfile?: Record<string, any> | null;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// Parse budget string into weekly USD amount for minimum warning
function parseWeeklyUSD(budget: string): number | null {
  const lower = budget.toLowerCase();
  const num = parseFloat(budget.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return null;
  if (lower.includes('month')) return num / 4.33;
  return num; // assume weekly
}

const IMPACT_ICONS: Record<string, React.ElementType> = {
  bodyComposition: Dumbbell,
  energy: Zap,
  mood: Brain,
  recovery: TrendingUp,
};
const IMPACT_LABELS: Record<string, string> = {
  bodyComposition: 'Body Composition',
  energy: 'Energy',
  mood: 'Mood',
  recovery: 'Recovery',
};
const IMPACT_COLORS: Record<string, string> = {
  bodyComposition: 'text-blue-600 dark:text-blue-400',
  energy: 'text-amber-600 dark:text-amber-400',
  mood: 'text-violet-600 dark:text-violet-400',
  recovery: 'text-emerald-600 dark:text-emerald-400',
};

function MacroBar({ label, grams, total, color }: { label: string; grams: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((grams / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold" style={{ color }}>{grams}g <span className="text-muted-foreground font-normal">({pct}%)</span></span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

interface NutritionPlanCardProps {
  plan: NutritionPlanResult;
  savedProgramDurationWeeks?: number | null;
  programStartDate?: string | null;
  currentWeightLbs?: number | null;
}

function NutritionPlanCard({ plan, savedProgramDurationWeeks, programStartDate, currentWeightLbs }: NutritionPlanCardProps) {
  const [showFoods, setShowFoods] = useState(false);
  const [outcomeView, setOutcomeView] = useState<'week' | 'month'>('week');
  const [calorieAdjust, setCalorieAdjust] = useState(0);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const totalMacroG = plan.macros.proteinG + plan.macros.carbsG + plan.macros.fatG;

  const adjustedCalories = plan.macros.calories + calorieAdjust;
  const tdee = plan.expectedOutcomes?.tdee ?? null;
  const adjustedDeficitSurplus = tdee ? adjustedCalories - tdee : null;
  const adjustedWeeklyChange = adjustedDeficitSurplus !== null ? (adjustedDeficitSurplus * 7 / 3500) : null;

  const programEndDate: string | null = (() => {
    if (!programStartDate || !savedProgramDurationWeeks) return null;
    const start = new Date(programStartDate);
    const end = new Date(start);
    end.setDate(end.getDate() + savedProgramDurationWeeks * 7);
    return end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  const weeksRemaining: number | null = (() => {
    if (!programStartDate || !savedProgramDurationWeeks) return null;
    const start = new Date(programStartDate);
    const end = new Date(start);
    end.setDate(end.getDate() + savedProgramDurationWeeks * 7);
    const now = new Date();
    const remaining = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 7);
    return Math.max(0, Math.round(remaining));
  })();

  const weeklyWeightChangeLb = plan.expectedOutcomes?.weeklyWeightChangeLb ?? null;
  const targetWeightLbs: number | null = (() => {
    if (programEndDate && currentWeightLbs !== null && currentWeightLbs !== undefined && weeklyWeightChangeLb !== null && weeksRemaining !== null) {
      return currentWeightLbs + (weeklyWeightChangeLb * weeksRemaining);
    }
    return null;
  })();

  async function saveAdjustment() {
    setAdjustSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/nutrition-adjustment`, {
        method: 'PUT',
        body: JSON.stringify({ calorieAdjustment: calorieAdjust }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Adjustment saved');
    } catch {
      toast.error('Failed to save adjustment');
    } finally {
      setAdjustSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Nutrition Plan</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Personalized alongside your training program</p>
        </div>
        <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary uppercase tracking-wide shrink-0">
          AI Coach
        </div>
      </div>

      {/* Calorie target */}
      <div className="text-center py-2">
        <p className="text-4xl font-black tabular-nums">{plan.macros.calories.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground mt-1">kcal / day</p>
      </div>

      {/* Macro bars */}
      <div className="space-y-3">
        <MacroBar label="Protein" grams={plan.macros.proteinG} total={totalMacroG} color="#6366f1" />
        <MacroBar label="Carbs"   grams={plan.macros.carbsG}   total={totalMacroG} color="#22c55e" />
        <MacroBar label="Fat"     grams={plan.macros.fatG}     total={totalMacroG} color="#f59e0b" />
      </div>

      {/* Impact grid */}
      {plan.impact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(Object.keys(IMPACT_ICONS) as Array<keyof typeof IMPACT_ICONS>).map(key => {
            const Icon = IMPACT_ICONS[key];
            const text = (plan.impact as any)[key];
            if (!text) return null;
            return (
              <div key={key} className="flex items-start gap-2.5 rounded-xl bg-muted/30 px-3 py-2.5">
                <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${IMPACT_COLORS[key]}`} />
                <div>
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${IMPACT_COLORS[key]}`}>{IMPACT_LABELS[key]}</p>
                  <p className="text-[11px] text-foreground leading-snug mt-0.5">{text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rationale */}
      <div className="rounded-xl bg-muted/20 border border-border/50 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Anakin's Rationale</p>
        <p className="text-xs text-foreground leading-relaxed">{plan.rationale}</p>
      </div>

      {/* Expected Outcomes */}
      {plan.expectedOutcomes && (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b">
            <div className="flex items-center gap-2">
              <Scale className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Expected Outcomes</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-background border p-0.5">
              {(['week', 'month'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setOutcomeView(v)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors ${
                    outcomeView === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Per {v}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-center">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">TDEE (Maintenance)</p>
                <p className="text-sm font-bold">{plan.expectedOutcomes.tdee.toLocaleString()} kcal</p>
              </div>
              <div className={`rounded-lg px-3 py-2.5 text-center ${
                plan.expectedOutcomes.surplusOrDeficit >= 0
                  ? 'bg-amber-500/10 border border-amber-500/20'
                  : 'bg-emerald-500/10 border border-emerald-500/20'
              }`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-muted-foreground">
                  {plan.expectedOutcomes.surplusOrDeficit >= 0 ? 'Caloric Surplus' : 'Caloric Deficit'}
                </p>
                <p className={`text-sm font-bold ${
                  plan.expectedOutcomes.surplusOrDeficit >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}>
                  {plan.expectedOutcomes.surplusOrDeficit >= 0 ? '+' : ''}{plan.expectedOutcomes.surplusOrDeficit} kcal/day
                </p>
              </div>
            </div>
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
              <p className="text-[10px] font-bold text-primary uppercase tracking-wide mb-1">
                Projected Weight Change — per {outcomeView}
              </p>
              {(() => {
                const change = outcomeView === 'week'
                  ? plan.expectedOutcomes!.weeklyWeightChangeLb
                  : plan.expectedOutcomes!.monthlyWeightChangeLb;
                const sign = change >= 0 ? '+' : '';
                return (
                  <p className="text-xl font-black">
                    {sign}{change.toFixed(1)} <span className="text-sm font-semibold text-muted-foreground">lb</span>
                  </p>
                );
              })()}
            </div>

            {/* Target Weight at Program End */}
            {targetWeightLbs !== null && programEndDate && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5">
                <Target className="h-3.5 w-3.5 text-primary shrink-0" />
                <div>
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wide">Target Weight at Program End</p>
                  <p className="text-xs font-semibold mt-0.5">
                    {targetWeightLbs.toFixed(1)} lbs <span className="text-muted-foreground font-normal">by {programEndDate}</span>
                  </p>
                </div>
              </div>
            )}

            {plan.expectedOutcomes.strengthGainNote && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/20 px-3 py-2.5">
                <TrendingUp className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground leading-snug">{plan.expectedOutcomes.strengthGainNote}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Calorie Adjustment Panel */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="px-4 py-3 bg-muted/20 border-b">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Adjust Calorie Target</p>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setCalorieAdjust(v => v - 50)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/40 hover:bg-muted/70 text-foreground font-bold text-base transition-colors"
              aria-label="Decrease by 50"
            >
              −
            </button>
            <div className="text-center min-w-[90px]">
              <p className={`text-2xl font-black tabular-nums ${
                calorieAdjust < 0 ? 'text-emerald-600 dark:text-emerald-400' :
                calorieAdjust > 0 ? 'text-red-500 dark:text-red-400' :
                'text-foreground'
              }`}>
                {adjustedCalories.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">kcal / day</p>
              {calorieAdjust !== 0 && (
                <p className={`text-[10px] font-semibold ${calorieAdjust < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {calorieAdjust > 0 ? '+' : ''}{calorieAdjust} from plan
                </p>
              )}
            </div>
            <button
              onClick={() => setCalorieAdjust(v => v + 50)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/40 hover:bg-muted/70 text-foreground font-bold text-base transition-colors"
              aria-label="Increase by 50"
            >
              +
            </button>
          </div>

          {adjustedDeficitSurplus !== null && (
            <div className={`rounded-lg px-3 py-2 text-center text-[11px] ${
              adjustedDeficitSurplus <= 0
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400'
            }`}>
              {adjustedDeficitSurplus <= 0
                ? `Deficit: ${Math.abs(adjustedDeficitSurplus)} kcal/day`
                : `Surplus: ${adjustedDeficitSurplus} kcal/day`}
              {adjustedWeeklyChange !== null && (
                <span className="ml-1 font-semibold">
                  → ~{Math.abs(adjustedWeeklyChange).toFixed(2)} lb/week {adjustedWeeklyChange <= 0 ? 'loss' : 'gain'}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={saveAdjustment}
              disabled={calorieAdjust === 0 || adjustSaving}
              size="sm"
              className="rounded-xl text-xs flex-1"
            >
              {adjustSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Save Adjustment
            </Button>
            {calorieAdjust !== 0 && (
              <Button
                onClick={() => setCalorieAdjust(0)}
                variant="ghost"
                size="sm"
                className="rounded-xl text-xs"
              >
                Reset
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground text-center">Adjust in 50 kcal steps</p>
        </div>
      </div>

      {/* Recommended foods (collapsed by default) */}
      <div>
        <button
          onClick={() => setShowFoods(v => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showFoods ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showFoods ? 'Hide' : 'Show'} recommended foods ({plan.foods.length})
        </button>
        <AnimatePresence initial={false}>
          {showFoods && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mt-3 space-y-2"
            >
              {plan.foods.map((f, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2">
                  <Apple className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium">{f.name}</p>
                    <p className="text-[10px] text-muted-foreground">{f.reason}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

const MEAL_TYPE_COLORS: Record<string, string> = {
  breakfast: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  lunch: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  dinner: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  snack: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

function MealCard({ meal }: { meal: MealSuggestion }) {
  const [open, setOpen] = useState(false);
  const typeColor = MEAL_TYPE_COLORS[(meal.mealType || '').toLowerCase()] || 'bg-muted text-muted-foreground';
  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <button
        className="w-full text-left p-4 flex items-start justify-between gap-3"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-sm font-semibold">{meal.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${typeColor}`}>
              {meal.mealType}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">{meal.description}</p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><Zap className="h-2.5 w-2.5" />{meal.macros.calories} kcal</span>
            <span className="text-[#6366f1] font-medium">P {meal.macros.proteinG}g</span>
            <span className="text-[#22c55e] font-medium">C {meal.macros.carbsG}g</span>
            <span className="text-[#f59e0b] font-medium">F {meal.macros.fatG}g</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground">
          {meal.estimatedCostUSD > 0 && (
            <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />${meal.estimatedCostUSD}</span>
          )}
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{meal.prepMinutes}m</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 border-t bg-muted/10 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Key Ingredients</p>
              <div className="flex flex-wrap gap-1.5">
                {meal.keyIngredients.map((ing, i) => (
                  <span key={i} className="rounded-md bg-background border border-border/60 px-2 py-1 text-[11px]">{ing}</span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function NutritionTab({
  latestSession,
  weightKg,
  trainingAge,
  coachGoal,
  coachBudget,
  savedNutritionPlan,
  isPro,
  savedProgramDurationWeeks,
  programStartDate,
  coachProfile,
}: Props) {
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [form, setForm] = useState({ date: todayStr(), proteinG: '', carbsG: '', fatG: '', notes: '' });
  const [saving, setSaving] = useState(false);

  // On-demand AI plan (if no saved plan)
  const [aiPlan, setAiPlan] = useState<NutritionPlanResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Meal suggestions
  const [meals, setMeals] = useState<MealSuggestion[]>([]);
  const [mealsLoading, setMealsLoading] = useState(false);

  // Budget editing
  const [budget, setBudget] = useState(coachBudget || '');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetEditing, setBudgetEditing] = useState(false);

  // Body weight logs
  const [bwLogs, setBwLogs] = useState<Array<{ id: string; date: string; weightLbs: number; notes?: string }>>([]);
  const [bwLogsLoading, setBwLogsLoading] = useState(true);
  const [bwForm, setBwForm] = useState({ date: todayStr(), weightLbs: '', notes: '' });
  const [bwSaving, setBwSaving] = useState(false);

  // Meal description parser
  const [mealDesc, setMealDesc] = useState('');
  const [mealParsing, setMealParsing] = useState(false);
  const [parsedMeal, setParsedMeal] = useState<{ name: string; proteinG: number; carbsG: number; fatG: number; calories: number; mealType: string; confidence: string; notes: string } | null>(null);
  const [mealAdding, setMealAdding] = useState(false);

  // The active plan (saved takes priority over on-demand)
  const activePlan = savedNutritionPlan || aiPlan;

  // Derive current weight from most recent bw log
  const currentWeightLbs = bwLogs.length > 0 ? bwLogs[bwLogs.length - 1].weightLbs : null;

  useEffect(() => {
    // Fetch nutrition logs
    authFetch(`${API_BASE}/nutrition/log`)
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .catch(() => {})
      .finally(() => setLogsLoading(false));

    // Fetch body weight logs (parallel)
    authFetch(`${API_BASE}/coach/body-weight`)
      .then(r => r.json())
      .then(d => setBwLogs(d.logs || []))
      .catch(() => {})
      .finally(() => setBwLogsLoading(false));
  }, []);

  useEffect(() => {
    const todayLog = logs.find(l => l.date === todayStr());
    if (todayLog) {
      setForm({
        date: todayLog.date,
        proteinG: String(todayLog.proteinG),
        carbsG: String(todayLog.carbsG),
        fatG: String(todayLog.fatG),
        notes: todayLog.notes || '',
      });
    }
  }, [logs]);

  async function saveLog() {
    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/nutrition/log`, {
        method: 'POST',
        body: JSON.stringify({
          date: form.date,
          proteinG: Number(form.proteinG) || 0,
          carbsG: Number(form.carbsG) || 0,
          fatG: Number(form.fatG) || 0,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setLogs(prev => {
        const next = prev.filter(l => l.date !== form.date);
        return [data, ...next].sort((a, b) => b.date.localeCompare(a.date));
      });
      toast.success('Log saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function saveBwLog() {
    setBwSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/body-weight`, {
        method: 'POST',
        body: JSON.stringify({
          date: bwForm.date,
          weightLbs: Number(bwForm.weightLbs),
          notes: bwForm.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setBwLogs(prev => {
        const next = prev.filter(l => l.date !== bwForm.date);
        return [...next, data].sort((a, b) => a.date.localeCompare(b.date));
      });
      toast.success('Weight logged');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setBwSaving(false);
    }
  }

  async function getAiPlan() {
    if (!isPro) return toast.error('Pro feature');
    setAiLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/nutrition-plan`, {
        method: 'POST',
        body: JSON.stringify({
          goal: coachGoal || latestSession?.plan?.goal || 'strength_peak',
          weightKg,
          trainingAge,
          primaryLimiter: latestSession?.primaryLimiter || null,
          selectedLift: latestSession?.selectedLift || null,
          budget: budget || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setAiPlan(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate plan');
    } finally {
      setAiLoading(false);
    }
  }

  async function getMealSuggestions() {
    if (!isPro || !activePlan) return;
    setMealsLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/meal-suggestions`, {
        method: 'POST',
        body: JSON.stringify({
          macros: activePlan.macros,
          budget: budget || null,
          goal: coachGoal || 'strength',
          numberOfMeals: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMeals(data.meals || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to get meal suggestions');
    } finally {
      setMealsLoading(false);
    }
  }

  async function saveBudget() {
    setBudgetSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/budget`, {
        method: 'PUT',
        body: JSON.stringify({ budget: budget.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save budget');
      setBudgetEditing(false);
      toast.success('Budget saved');
    } catch {
      toast.error('Failed to save budget');
    } finally {
      setBudgetSaving(false);
    }
  }

  async function parseMeal() {
    if (!mealDesc.trim()) return;
    setMealParsing(true);
    setParsedMeal(null);
    try {
      const res = await authFetch(`${API_BASE}/nutrition/parse-meal`, {
        method: 'POST',
        body: JSON.stringify({ description: mealDesc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze meal');
      setParsedMeal(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to analyze meal');
    } finally {
      setMealParsing(false);
    }
  }

  async function addParsedMealToLog() {
    if (!parsedMeal) return;
    setMealAdding(true);
    try {
      const res = await authFetch(`${API_BASE}/nutrition/meals`, {
        method: 'POST',
        body: JSON.stringify({
          date: form.date,
          name: parsedMeal.name,
          mealType: parsedMeal.mealType || 'meal',
          proteinG: parsedMeal.proteinG,
          carbsG: parsedMeal.carbsG,
          fatG: parsedMeal.fatG,
          calories: parsedMeal.calories,
          notes: mealDesc,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to add meal');
      }
      // Add macros to the daily log form so the user can save totals
      setForm(f => ({
        ...f,
        proteinG: String((Number(f.proteinG) || 0) + parsedMeal.proteinG),
        carbsG: String((Number(f.carbsG) || 0) + parsedMeal.carbsG),
        fatG: String((Number(f.fatG) || 0) + parsedMeal.fatG),
      }));
      toast.success(`${parsedMeal.name} added to log`);
      setParsedMeal(null);
      setMealDesc('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add meal');
    } finally {
      setMealAdding(false);
    }
  }

  const protein = Number(form.proteinG) || 0;
  const carbs = Number(form.carbsG) || 0;
  const fat = Number(form.fatG) || 0;
  const calories = protein * 4 + carbs * 4 + fat * 9;

  const trendData = [...logs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map(l => ({ date: l.date.slice(5), protein: l.proteinG, carbs: l.carbsG, fat: l.fatG }));

  // Budget minimum warning
  const weeklyUSD = budget ? parseWeeklyUSD(budget) : null;
  const belowMinimum = weeklyUSD !== null && weeklyUSD < 40;

  // Body weight chart — actual logs + projection to program end
  const weeklyChangeLbForChart = activePlan?.expectedOutcomes?.weeklyWeightChangeLb ?? null;

  const bwCombinedChart = (() => {
    const sortedLogs = [...bwLogs].sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, { label: string; actual: number | null; projected: number | null }>();

    // Actual data (last 20 entries)
    sortedLogs.slice(-20).forEach(l => {
      map.set(l.date, { label: l.date.slice(5), actual: l.weightLbs, projected: null });
    });

    // Projection from last log to program end
    if (currentWeightLbs !== null && weeklyChangeLbForChart !== null && programStartDate && savedProgramDurationWeeks) {
      const anchorStr = sortedLogs.length > 0
        ? sortedLogs[sortedLogs.length - 1].date
        : new Date().toISOString().split('T')[0];
      const anchorDate = new Date(anchorStr + 'T00:00:00');
      const endDate = new Date(programStartDate + 'T00:00:00');
      endDate.setDate(endDate.getDate() + savedProgramDurationWeeks * 7);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (endDate > today) {
        // Bridge: connect projection line to last actual
        const anchor = map.get(anchorStr);
        if (anchor) anchor.projected = currentWeightLbs;
        else map.set(anchorStr, { label: anchorStr.slice(5), actual: null, projected: currentWeightLbs });

        // Weekly points from anchor+7 to just before end
        let d = new Date(anchorDate);
        d.setDate(d.getDate() + 7);
        while (d < endDate) {
          const weeks = (d.getTime() - anchorDate.getTime()) / 604800000;
          const projW = parseFloat((currentWeightLbs + weeklyChangeLbForChart * weeks).toFixed(1));
          const ds = d.toISOString().split('T')[0];
          const ex = map.get(ds);
          if (ex) ex.projected = projW;
          else map.set(ds, { label: ds.slice(5), actual: null, projected: projW });
          d = new Date(d);
          d.setDate(d.getDate() + 7);
        }

        // End date point (target)
        const endStr = endDate.toISOString().split('T')[0];
        const weeksToEnd = (endDate.getTime() - anchorDate.getTime()) / 604800000;
        const endW = parseFloat((currentWeightLbs + weeklyChangeLbForChart * weeksToEnd).toFixed(1));
        const endEx = map.get(endStr);
        if (endEx) endEx.projected = endW;
        else map.set(endStr, { label: 'End', actual: null, projected: endW });
      }
    }

    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  })();

  const hasProjection = bwCombinedChart.some(p => p.projected !== null);
  const showBwChart = bwCombinedChart.some(p => p.actual !== null) || hasProjection;

  // Today's logged body weight
  const todayBwLog = bwLogs.find(l => l.date === todayStr());

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* Nutrition Plan — saved (from program) or on-demand */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {activePlan ? (
          <NutritionPlanCard
            plan={activePlan}
            savedProgramDurationWeeks={savedProgramDurationWeeks}
            programStartDate={programStartDate}
            currentWeightLbs={currentWeightLbs}
          />
        ) : (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Nutrition Plan</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {savedNutritionPlan
                    ? 'Generated with your training program'
                    : 'Generate a personalized macro plan'}
                </p>
              </div>
              <Button onClick={getAiPlan} disabled={aiLoading || !isPro} size="sm" variant="outline" className="rounded-xl text-xs">
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                {aiLoading ? 'Generating…' : 'Get AI Plan'}
              </Button>
            </div>
            {!isPro && (
              <p className="text-xs text-muted-foreground">AI nutrition recommendations are a Pro feature.</p>
            )}
            {isPro && (
              <p className="text-xs text-muted-foreground">
                Generate a new nutrition plan, or run "New Program" to get one alongside your training plan.
              </p>
            )}
          </Card>
        )}
      </motion.div>

      {/* Meal Suggestions */}
      {activePlan && isPro && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meal Suggestions</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {budget ? `Tailored to ${budget} · ` : ''}Matched to your macro targets
                </p>
              </div>
              <Button
                onClick={getMealSuggestions}
                disabled={mealsLoading}
                size="sm"
                variant="outline"
                className="rounded-xl text-xs"
              >
                {mealsLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <UtensilsCrossed className="h-3.5 w-3.5 mr-1" />}
                {mealsLoading ? 'Finding meals…' : meals.length > 0 ? 'Refresh' : 'Get Meal Ideas'}
              </Button>
            </div>

            {meals.length > 0 && (
              <div className="space-y-2">
                {meals.map((meal, i) => <MealCard key={i} meal={meal} />)}
              </div>
            )}

            {meals.length === 0 && !mealsLoading && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Click "Get Meal Ideas" to generate budget-friendly meals matching your macros.
              </p>
            )}
          </Card>
        </motion.div>
      )}

      {/* Budget */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="p-5 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Food Budget</p>

          {belowMinimum && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Budget below minimum for adequate sports nutrition. We recommend at least $40–60/week for sufficient protein sources.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            {budgetEditing ? (
              <>
                <input
                  type="text"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  placeholder="e.g. $100/week or $400/month"
                  className="flex-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveBudget()}
                />
                <Button onClick={saveBudget} disabled={budgetSaving} size="sm" className="rounded-xl text-xs shrink-0">
                  {budgetSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button onClick={() => { setBudget(coachBudget || ''); setBudgetEditing(false); }} variant="ghost" size="sm" className="rounded-xl text-xs shrink-0">
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <div className="flex-1 rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-sm">{budget || <span className="text-muted-foreground text-xs">No budget set</span>}</p>
                </div>
                <Button onClick={() => setBudgetEditing(true)} variant="outline" size="sm" className="rounded-xl text-xs shrink-0">
                  <DollarSign className="h-3.5 w-3.5 mr-1" />
                  {budget ? 'Edit' : 'Set Budget'}
                </Button>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Minimum realistic: $40–60/week for adequate protein + whole foods. Affects meal suggestions and nutrition advice.
          </p>
        </Card>
      </motion.div>

      {/* Body Weight Log */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}>
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body Weight</p>
                {todayBwLog && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Today: <span className="font-bold text-foreground">{todayBwLog.weightLbs} lbs</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Input row */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={bwForm.date}
              onChange={e => setBwForm(f => ({ ...f, date: e.target.value }))}
              className="rounded-lg border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={bwForm.weightLbs}
              onChange={e => setBwForm(f => ({ ...f, weightLbs: e.target.value }))}
              placeholder="Weight (lbs)"
              className="rounded-lg border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-32"
            />
            <input
              type="text"
              value={bwForm.notes}
              onChange={e => setBwForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Notes (optional)"
              className="rounded-lg border bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-36 flex-1 min-w-[120px]"
            />
            <Button
              onClick={saveBwLog}
              disabled={bwSaving || !bwForm.weightLbs}
              size="sm"
              className="rounded-xl text-xs shrink-0"
            >
              {bwSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {/* Chart: actual + projection */}
          {showBwChart && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                  {hasProjection ? 'Progress & Projection' : 'Weight Trend'}
                </p>
                {hasProjection && (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-0.5 bg-[#6366f1] rounded" /> Logged
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 border-t-2 border-dashed border-[#a78bfa]" /> Projected
                    </span>
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={bwCombinedChart} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v}`}
                    width={38}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(value: number, name: string) => [
                      `${value} lbs`,
                      name === 'actual' ? 'Logged' : 'Projected',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                    connectNulls={false}
                    name="actual"
                    activeDot={{ r: 5 }}
                  />
                  {hasProjection && (
                    <Line
                      type="monotone"
                      dataKey="projected"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                      name="projected"
                      activeDot={{ r: 4 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Recent entries */}
          {!bwLogsLoading && bwLogs.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-2">Recent Entries</p>
              <div className="space-y-1.5">
                {[...bwLogs]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 5)
                  .map(entry => (
                    <div key={entry.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                      <span className="text-xs text-muted-foreground">{entry.date}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-semibold text-foreground">{entry.weightLbs} lbs</span>
                        {entry.notes && (
                          <span className="text-muted-foreground truncate max-w-[120px]">{entry.notes}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {bwLogsLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!bwLogsLoading && bwLogs.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No weight entries yet. Log your body weight daily to track progress.
            </p>
          )}
        </Card>
      </motion.div>

      {/* Daily log */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Card className="p-5 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily Macro Log</p>

          <div className="flex items-center gap-3">
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="rounded-lg border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'proteinG', label: 'Protein (g)', color: '#6366f1', target: activePlan?.macros.proteinG },
              { key: 'carbsG', label: 'Carbs (g)', color: '#22c55e', target: activePlan?.macros.carbsG },
              { key: 'fatG', label: 'Fat (g)', color: '#f59e0b', target: activePlan?.macros.fatG },
            ].map(({ key, label, color, target }) => (
              <div key={key} className="rounded-xl border p-3 text-center" style={{ borderColor: color + '40' }}>
                <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                <input
                  type="number"
                  min="0"
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-center text-lg font-bold bg-transparent focus:outline-none"
                  style={{ color }}
                  placeholder="0"
                />
                {target && (
                  <p className="text-[9px] text-muted-foreground mt-0.5">/{target}g target</p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-bold">{calories} kcal</span>
              {activePlan && (
                <span className="text-muted-foreground text-xs ml-1">/ {activePlan.macros.calories} target</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (optional)"
                className="rounded-lg border bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 w-40"
              />
              <Button onClick={saveLog} disabled={saving} size="sm" className="rounded-xl text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Describe a Meal */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.17 }}>
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Log a Meal by Description</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={mealDesc}
              onChange={e => setMealDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && parseMeal()}
              placeholder='e.g. "osmow\'s oz box" or "0.6 lbs ground beef, 1 cup rice"'
              className="flex-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button onClick={parseMeal} disabled={mealParsing || !mealDesc.trim()} size="sm" className="rounded-xl text-xs shrink-0 gap-1">
              {mealParsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {!mealParsing && 'Analyze'}
            </Button>
          </div>
          <AnimatePresence>
            {parsedMeal && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="rounded-xl border bg-muted/20 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{parsedMeal.name}</p>
                    {parsedMeal.notes && <p className="text-[11px] text-muted-foreground mt-0.5">{parsedMeal.notes}</p>}
                  </div>
                  <span className={`shrink-0 text-[10px] rounded-full px-2 py-0.5 font-medium ${
                    parsedMeal.confidence === 'high' ? 'bg-green-500/15 text-green-600' :
                    parsedMeal.confidence === 'medium' ? 'bg-yellow-500/15 text-yellow-600' :
                    'bg-red-500/15 text-red-500'
                  }`}>
                    {parsedMeal.confidence} confidence
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: 'Protein', value: `${parsedMeal.proteinG}g`, color: '#6366f1' },
                    { label: 'Carbs', value: `${parsedMeal.carbsG}g`, color: '#22c55e' },
                    { label: 'Fat', value: `${parsedMeal.fatG}g`, color: '#f59e0b' },
                    { label: 'Calories', value: `${parsedMeal.calories}`, color: 'hsl(var(--foreground))' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg border p-2" style={{ borderColor: color + '30' }}>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className="text-sm font-bold" style={{ color }}>{value}</p>
                    </div>
                  ))}
                </div>
                <Button onClick={addParsedMealToLog} disabled={mealAdding} size="sm" className="w-full rounded-xl text-xs">
                  {mealAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                  Add to {form.date === todayStr() ? "Today's" : form.date} Log
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </motion.div>

      {/* 7-day trend */}
      {trendData.length > 1 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">7-Day Macro Trend</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="protein" stroke="#6366f1" strokeWidth={2} dot={false} name="Protein (g)" />
                <Line type="monotone" dataKey="carbs" stroke="#22c55e" strokeWidth={2} dot={false} name="Carbs (g)" />
                <Line type="monotone" dataKey="fat" stroke="#f59e0b" strokeWidth={2} dot={false} name="Fat (g)" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* Recent logs */}
      {!logsLoading && logs.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <Card className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent Logs</p>
            <div className="space-y-2">
              {logs.slice(0, 7).map(log => {
                const kcal = log.proteinG * 4 + log.carbsG * 4 + log.fatG * 9;
                return (
                  <div key={log.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{log.date}</span>
                    <div className="flex gap-4 text-xs">
                      <span className="text-[#6366f1] font-medium">{log.proteinG}g P</span>
                      <span className="text-[#22c55e] font-medium">{log.carbsG}g C</span>
                      <span className="text-[#f59e0b] font-medium">{log.fatG}g F</span>
                      <span className="text-muted-foreground">{kcal} kcal</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
