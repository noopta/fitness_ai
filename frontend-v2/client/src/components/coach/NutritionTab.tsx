import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Loader2, Sparkles, Apple, UtensilsCrossed, Clock, DollarSign,
  TrendingUp, Zap, Brain, Dumbbell, Check, AlertTriangle, ChevronDown, ChevronUp, Scale,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { NutritionPlanResult, MealSuggestion } from './ProgramSetup';

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

function NutritionPlanCard({ plan }: { plan: NutritionPlanResult }) {
  const [showFoods, setShowFoods] = useState(false);
  const [outcomeView, setOutcomeView] = useState<'week' | 'month'>('week');
  const totalMacroG = plan.macros.proteinG + plan.macros.carbsG + plan.macros.fatG;

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
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Coach Rationale</p>
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
            {plan.expectedOutcomes.strengthGainNote && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/20 px-3 py-2.5">
                <TrendingUp className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground leading-snug">{plan.expectedOutcomes.strengthGainNote}</p>
              </div>
            )}
          </div>
        </div>
      )}

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
  const typeColor = MEAL_TYPE_COLORS[meal.mealType.toLowerCase()] || 'bg-muted text-muted-foreground';
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

export function NutritionTab({ latestSession, weightKg, trainingAge, coachGoal, coachBudget, savedNutritionPlan, isPro }: Props) {
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

  // The active plan (saved takes priority over on-demand)
  const activePlan = savedNutritionPlan || aiPlan;

  useEffect(() => {
    fetch(`${API_BASE}/nutrition/log`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .catch(() => {})
      .finally(() => setLogsLoading(false));
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
      const res = await fetch(`${API_BASE}/nutrition/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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

  async function getAiPlan() {
    if (!isPro) return toast.error('Pro feature');
    setAiLoading(true);
    try {
      const res = await fetch(`${API_BASE}/coach/nutrition-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
      const res = await fetch(`${API_BASE}/coach/meal-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
      const res = await fetch(`${API_BASE}/coach/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* Nutrition Plan — saved (from program) or on-demand */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {activePlan ? (
          <NutritionPlanCard plan={activePlan} />
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
