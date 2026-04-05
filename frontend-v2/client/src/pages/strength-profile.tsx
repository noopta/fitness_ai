import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import {
  Dumbbell, TrendingUp, TrendingDown, Minus,
  Loader2, Activity, BarChart3, Zap, Brain,
  Apple, Flame, Target, CheckCircle, XCircle,
  Lightbulb, Utensils, RefreshCw,
} from 'lucide-react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

// ─── Strength Profile Types ───────────────────────────────────────────────────

interface WeekPoint { week: string; rm: number; rmLbs: number }

interface LiftSummary {
  canonicalName: string;
  category: string;
  primaryMuscle: string;
  isCompound: boolean;
  current1RMkg: number;
  current1RMLbs: number;
  monthlyGainPct: number | null;
  totalTonnageKg: number;
  sessionCount: number;
  weekSeries: WeekPoint[];
}

interface StrengthProfileData {
  overallStrengthIndex: number | null;
  strengthTier: string;
  maturityLabel: string;
  maturityPct: number;
  totalLogs: number;
  monthTonnageKg: number;
  radarScores: Record<string, number>;
  lifts: LiftSummary[];
  aiInsights: string[];
}

// ─── Nutrition Profile Types ──────────────────────────────────────────────────

interface MacroSplit { proteinPct: number; carbsPct: number; fatPct: number }

interface NutritionMetrics {
  avgCalories: number;
  avgProtein: number;
  avgCarbs: number;
  avgFat: number;
  macroSplit: MacroSplit;
  proteinPerKg: number | null;
  calorieTrend: 'increasing' | 'decreasing' | 'stable';
  consistencyPct: number;
  avgMealsPerDay: number;
  totalDays?: number;
  loggedDays?: number;
  trainingDayCalories?: number | null;
  restDayCalories?: number | null;
  trainingDayProtein?: number | null;
  trainingDayCarbs?: number | null;
  morningMealPct?: number;
  eveningCaloriePct?: number;
  trainingDaysPerWeek?: number;
  highProteinEnergyAvg?: number | null;
  lowProteinEnergyAvg?: number | null;
  trackedLifts?: string[];
}

type CapacityLevel = 'severely_limited' | 'limited' | 'adequate' | 'good' | 'optimal';
type RatingLevel = 'poor' | 'below_average' | 'average' | 'good' | 'excellent';
type EnergyWindowLevel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

interface DimensionScores {
  dailyLife: number;
  gymPerformance: number;
  mentalClarity: number;
  recovery: number;
  nutritionTiming: number;
  bodyComposition: number;
}

interface DailyLifeImpact {
  score: number; grade: string; summary: string;
  morningEnergy: EnergyWindowLevel; afternoonEnergy: EnergyWindowLevel; eveningEnergy: EnergyWindowLevel;
  morningEnergyDetail: string; afternoonEnergyDetail: string; eveningEnergyDetail: string;
  moodStabilityRating: number; moodStabilityDetail: string;
  keyFactors: string[]; recommendations: string[];
}

interface GymPerformanceData {
  score: number; grade: string; summary: string;
  strengthCapacity: CapacityLevel; strengthCapacityDetail: string;
  enduranceCapacity: CapacityLevel; enduranceCapacityDetail: string;
  recoveryBetweenSets: RatingLevel; recoveryBetweenSetsDetail: string;
  keyLimiter: string;
  preWorkoutReadiness: RatingLevel; postWorkoutRecovery: RatingLevel;
  recommendations: string[];
}

interface LiftImpact {
  lift: string;
  impactLevel: 'optimal' | 'good' | 'moderate' | 'limited' | 'poor';
  currentImpact: string; scienceBacking: string; recommendation: string;
}

interface MentalClarityData {
  score: number; grade: string; summary: string;
  focusRating: number;
  glucoseStabilityRating: number; glucoseStabilityDetail: string;
  brainFuelAdequacy: 'insufficient' | 'marginal' | 'adequate' | 'optimal'; brainFuelDetail: string;
  neurotransmitterSupport: 'poor' | 'moderate' | 'good' | 'excellent'; neurotransmitterDetail: string;
  keyFactors: string[]; recommendations: string[];
}

interface EnergyWindow { level: 'very_low' | 'low' | 'moderate' | 'high'; detail: string }

interface EnergyPatternData {
  pattern: 'front_loaded' | 'back_loaded' | 'balanced' | 'irregular';
  summary: string;
  morningWindow: EnergyWindow; midDayWindow: EnergyWindow;
  afternoonWindow: EnergyWindow; eveningWindow: EnergyWindow;
  crashRisk: 'low' | 'moderate' | 'high' | 'very_high'; crashRiskDetail: string;
  optimalMealTiming: string; recommendations: string[];
}

interface RecoveryAndSleepData {
  score: number; grade: string; summary: string;
  muscleRepairCapacity: RatingLevel; muscleRepairDetail: string;
  sleepQualityImpact: 'negative' | 'neutral' | 'positive'; sleepQualityDetail: string;
  inflammationRisk: 'low' | 'moderate' | 'high'; inflammationDetail: string;
  hormoneSupport: 'poor' | 'moderate' | 'good' | 'excellent'; hormonalDetail: string;
  recommendations: string[];
}

interface MacroRecommendation {
  proteinG: number; carbsG: number; fatG: number; calories: number;
  trainingDayProteinG?: number; trainingDayCarbsG?: number;
  restDayProteinG?: number; restDayCarbsG?: number;
  rationale?: string; notes?: string;
}

interface NutritionInsight { category: string; insight: string; detail: string }

interface NutritionAnalysis {
  overallScore: number; overallGrade: string; summary: string;
  dimensionScores?: DimensionScores;
  dailyLifeImpact?: DailyLifeImpact;
  gymPerformance?: GymPerformanceData;
  liftImpact?: LiftImpact[];
  mentalClarity?: MentalClarityData;
  energyPattern?: EnergyPatternData;
  recoveryAndSleep?: RecoveryAndSleepData;
  strengths: string[];
  improvements: string[];
  insights?: NutritionInsight[];
  suggestions: string[];
  macroRecommendation: MacroRecommendation;
}

interface NutritionProfileData {
  hasData: boolean;
  metrics: NutritionMetrics;
  analysis: NutritionAnalysis;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  push:  '#6366f1',
  pull:  '#22c55e',
  legs:  '#f59e0b',
  hinge: '#ef4444',
  core:  '#8b5cf6',
};

const MATURITY_COLOR: Record<string, string> = {
  Bronze: 'text-amber-700 bg-amber-100',
  Silver: 'text-slate-600 bg-slate-200',
  Gold:   'text-yellow-600 bg-yellow-100',
};

const TIER_COLOR: Record<string, string> = {
  Beginner:     'text-slate-500',
  Novice:       'text-blue-500',
  Intermediate: 'text-green-500',
  Advanced:     'text-purple-500',
  Elite:        'text-yellow-500',
};

const GRADE_COLORS: Record<string, string> = {
  'A+': 'bg-emerald-100 text-emerald-700',
  A:   'bg-emerald-100 text-emerald-700',
  'A-':'bg-emerald-100 text-emerald-700',
  'B+':'bg-blue-100 text-blue-700',
  B:   'bg-blue-100 text-blue-700',
  'B-':'bg-blue-100 text-blue-700',
  'C+':'bg-yellow-100 text-yellow-700',
  C:   'bg-yellow-100 text-yellow-700',
  'C-':'bg-yellow-100 text-yellow-700',
  D:   'bg-red-100 text-red-700',
  F:   'bg-red-100 text-red-700',
};

const TREND_ICON = {
  increasing: <TrendingUp className="h-4 w-4 text-green-500" />,
  decreasing: <TrendingDown className="h-4 w-4 text-red-400" />,
  stable:     <Minus className="h-4 w-4 text-muted-foreground" />,
};

function formatWeekLabel(wk: string) {
  return wk.split('-')[1] ?? wk;
}

function GainBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (pct > 0) return (
    <span className="flex items-center gap-0.5 text-xs font-semibold text-green-500">
      <TrendingUp className="h-3 w-3" />+{pct}%
    </span>
  );
  if (pct < 0) return (
    <span className="flex items-center gap-0.5 text-xs font-semibold text-red-400">
      <TrendingDown className="h-3 w-3" />{pct}%
    </span>
  );
  return <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: WeekPoint[]; color: string }) {
  if (data.length < 2) return (
    <div className="h-12 flex items-center justify-center text-[10px] text-muted-foreground">
      Not enough data
    </div>
  );
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
        <Line type="monotone" dataKey="rmLbs" stroke={color} strokeWidth={1.5} dot={false} />
        <ChartTooltip
          contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
          formatter={(v: any) => [`${v} lbs`, '1RM']}
          labelFormatter={(l) => `Week ${l}`}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Lift Card ────────────────────────────────────────────────────────────────

function LiftCard({ lift, expanded, onToggle }: {
  lift: LiftSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = CATEGORY_COLOR[lift.category] ?? '#6366f1';
  return (
    <Card
      className="p-4 cursor-pointer hover:shadow-md transition-shadow select-none"
      onClick={onToggle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm truncate">{lift.canonicalName}</span>
            <Badge
              className="text-[9px] px-1.5 py-0 capitalize"
              style={{ background: color + '22', color }}
            >
              {lift.category}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground capitalize mt-0.5">{lift.primaryMuscle}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold leading-none">{lift.current1RMLbs} <span className="text-xs font-normal text-muted-foreground">lbs</span></p>
          <p className="text-[10px] text-muted-foreground">{lift.current1RMkg} kg est. 1RM</p>
        </div>
      </div>

      <div className="mt-3">
        <Sparkline data={lift.weekSeries} color={color} />
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <GainBadge pct={lift.monthlyGainPct} />
        <span className="text-[10px] text-muted-foreground">{lift.sessionCount} sessions</span>
      </div>

      {expanded && lift.weekSeries.length >= 2 && (
        <div className="mt-4 pt-4 border-t border-border/50" onClick={e => e.stopPropagation()}>
          <p className="text-xs font-semibold mb-2 text-muted-foreground">8-WEEK 1RM TREND</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={lift.weekSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tickFormatter={formatWeekLabel} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} unit=" lbs" />
              <ChartTooltip
                contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any) => [`${v} lbs`, 'Est. 1RM']}
                labelFormatter={formatWeekLabel}
              />
              <Line type="monotone" dataKey="rmLbs" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>Total tonnage: <strong className="text-foreground">{lift.totalTonnageKg.toLocaleString()} kg</strong></span>
            <span>{lift.isCompound ? 'Compound' : 'Isolation'}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Macro Bar ────────────────────────────────────────────────────────────────

function MacroBar({ proteinPct, carbsPct, fatPct }: MacroSplit) {
  return (
    <div className="space-y-1">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        <div className="bg-blue-500 transition-all" style={{ width: `${proteinPct}%` }} title={`Protein ${proteinPct}%`} />
        <div className="bg-amber-400 transition-all" style={{ width: `${carbsPct}%` }} title={`Carbs ${carbsPct}%`} />
        <div className="bg-rose-400 transition-all" style={{ width: `${fatPct}%` }} title={`Fat ${fatPct}%`} />
      </div>
      <div className="flex gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Protein {proteinPct}%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Carbs {carbsPct}%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />Fat {fatPct}%</span>
      </div>
    </div>
  );
}

// ─── Nutrition helpers ────────────────────────────────────────────────────────

const ENERGY_LEVEL_COLOR: Record<string, string> = {
  very_low: 'text-red-500', low: 'text-orange-400',
  moderate: 'text-yellow-500', high: 'text-green-500', very_high: 'text-emerald-500',
};
const ENERGY_LEVEL_LABEL: Record<string, string> = {
  very_low: 'Very Low', low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very High',
};
const CAPACITY_COLOR: Record<string, string> = {
  severely_limited: 'text-red-500', limited: 'text-orange-400',
  adequate: 'text-yellow-500', good: 'text-green-500', optimal: 'text-emerald-500',
};
const IMPACT_COLOR: Record<string, string> = {
  poor: 'bg-red-100 text-red-700', limited: 'bg-orange-100 text-orange-700',
  moderate: 'bg-yellow-100 text-yellow-700', good: 'bg-green-100 text-green-700',
  optimal: 'bg-emerald-100 text-emerald-700',
};
const CRASH_COLOR: Record<string, string> = {
  low: 'text-green-500', moderate: 'text-yellow-500',
  high: 'text-orange-400', very_high: 'text-red-500',
};
const SLEEP_COLOR: Record<string, string> = {
  negative: 'text-red-400', neutral: 'text-yellow-500', positive: 'text-green-500',
};

function EnergyDot({ level }: { level: string }) {
  const color = ENERGY_LEVEL_COLOR[level] ?? 'text-muted-foreground';
  const label = ENERGY_LEVEL_LABEL[level] ?? level;
  return <span className={`font-semibold text-sm ${color}`}>{label}</span>;
}

function SectionCard({
  title, icon: Icon, grade, score, open, onToggle, children,
}: {
  title: string; icon: any; grade?: string; score?: number;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors text-left"
        onClick={onToggle}
      >
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <span className="font-semibold text-sm flex-1">{title}</span>
        {score !== undefined && (
          <span className="text-xs text-muted-foreground mr-1">{score}/100</span>
        )}
        {grade && (
          <Badge className={`text-xs font-bold px-2 mr-2 ${GRADE_COLORS[grade] ?? 'bg-muted text-muted-foreground'}`}>
            {grade}
          </Badge>
        )}
        <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="border-t border-border/50 p-4 space-y-4">{children}</div>}
    </Card>
  );
}

function RecommendationList({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((r, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          {r}
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <div className="text-xs text-right flex-1">{children}</div>
    </div>
  );
}

// ─── Nutrition Profile Section ────────────────────────────────────────────────

function NutritionProfileSection() {
  const [data, setData] = useState<NutritionProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggleSection = (key: string) =>
    setOpenSection(prev => (prev === key ? null : key));

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    authFetch(`${API_BASE}/nutrition/profile`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span className="text-sm">Analyzing your nutrition…</span>
      </div>
    );
  }

  if (!data || !data.hasData) {
    return (
      <Card className="p-10 flex flex-col items-center gap-4 text-center text-muted-foreground">
        <Apple className="h-10 w-10 opacity-30" />
        <div>
          <p className="font-semibold">No nutrition data yet</p>
          <p className="text-sm mt-1 max-w-xs">
            Log meals in the app for at least a few days to unlock your AI-powered nutrition profile.
          </p>
        </div>
      </Card>
    );
  }

  const { metrics, analysis } = data;
  const days = metrics.loggedDays ?? metrics.totalDays ?? 0;

  // Build dimension radar data
  const radarDimensions = analysis.dimensionScores
    ? [
        { subject: 'Daily Life',  value: analysis.dimensionScores.dailyLife },
        { subject: 'Gym',         value: analysis.dimensionScores.gymPerformance },
        { subject: 'Mental',      value: analysis.dimensionScores.mentalClarity },
        { subject: 'Recovery',    value: analysis.dimensionScores.recovery },
        { subject: 'Timing',      value: analysis.dimensionScores.nutritionTiming },
        { subject: 'Body Comp',   value: analysis.dimensionScores.bodyComposition },
      ]
    : [];

  return (
    <div className="space-y-5">

      {/* ── Score Card ──────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-5">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full border-4 border-primary/30 bg-primary/5 shrink-0">
              <span className="text-2xl font-black leading-none text-primary">{analysis.overallScore}</span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">Score</span>
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold">Nutrition Profile</span>
                <Badge className={`text-sm font-bold px-2 ${GRADE_COLORS[analysis.overallGrade] ?? 'bg-muted text-muted-foreground'}`}>
                  {analysis.overallGrade}
                </Badge>
                <button
                  onClick={() => load(true)}
                  disabled={refreshing}
                  className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                  title="Refresh analysis"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">{analysis.summary}</p>
              <p className="text-[11px] text-muted-foreground">Based on {days} days of meal data</p>
            </div>
          </div>

          {/* Dimension Radar */}
          {radarDimensions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Dimension Scores</p>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarDimensions} outerRadius="70%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fontWeight: 500 }} />
                  <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
                  <ChartTooltip
                    contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`${v}/100`, 'Score']}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>

      {/* ── Daily Averages ───────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Flame className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Daily Averages</h2>
            <span className="text-xs text-muted-foreground">last {days} days</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            {[
              { label: 'Calories', value: `${Math.round(metrics.avgCalories)} kcal`, color: 'text-orange-500' },
              { label: 'Protein',  value: `${Math.round(metrics.avgProtein)}g`,      color: 'text-blue-500'   },
              { label: 'Carbs',    value: `${Math.round(metrics.avgCarbs)}g`,        color: 'text-amber-500'  },
              { label: 'Fat',      value: `${Math.round(metrics.avgFat)}g`,          color: 'text-rose-400'   },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <MacroBar {...metrics.macroSplit} />

          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border/50">
            <div className="text-center">
              <p className="text-sm font-semibold">{metrics.avgMealsPerDay.toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground">Meals/day</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold">{metrics.consistencyPct}%</p>
              <p className="text-[10px] text-muted-foreground">Consistency</p>
            </div>
            <div className="text-center flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1">
                {TREND_ICON[metrics.calorieTrend]}
                <p className="text-sm font-semibold capitalize">{metrics.calorieTrend}</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Calorie trend</p>
            </div>
          </div>

          {metrics.proteinPerKg != null && (
            <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Protein / kg bodyweight</span>
              <span className="font-bold text-sm">
                {metrics.proteinPerKg.toFixed(2)} g/kg
                <span className={`ml-1.5 text-[11px] font-normal ${
                  metrics.proteinPerKg >= 1.6 ? 'text-green-500' : metrics.proteinPerKg >= 1.2 ? 'text-yellow-500' : 'text-red-400'
                }`}>
                  {metrics.proteinPerKg >= 1.6 ? '✓ Optimal' : metrics.proteinPerKg >= 1.2 ? 'Adequate' : 'Below target'}
                </span>
              </span>
            </div>
          )}

          {metrics.highProteinEnergyAvg != null && metrics.lowProteinEnergyAvg != null && (
            <div className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Wellness insight: </span>
              On high-protein days your energy averages{' '}
              <strong className="text-foreground">{metrics.highProteinEnergyAvg.toFixed(1)}/10</strong>
              {' '}vs{' '}
              <strong className="text-foreground">{metrics.lowProteinEnergyAvg.toFixed(1)}/10</strong>
              {' '}on low-protein days.
            </div>
          )}
        </Card>
      </motion.div>

      {/* ── Training vs Rest Day Comparison ─────────────────────────────── */}
      {metrics.trainingDayCalories != null && metrics.restDayCalories != null && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Dumbbell className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Training vs Rest Day Nutrition</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Training Day', cal: metrics.trainingDayCalories!, protein: metrics.trainingDayProtein, carbs: metrics.trainingDayCarbs, color: 'border-primary/40 bg-primary/5' },
                { label: 'Rest Day', cal: metrics.restDayCalories!, protein: null, carbs: null, color: 'border-border bg-muted/30' },
              ].map(({ label, cal, protein, carbs, color }) => (
                <div key={label} className={`rounded-lg border p-3 ${color}`}>
                  <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">{label}</p>
                  <p className="text-lg font-bold text-orange-500">{Math.round(cal)} <span className="text-xs font-normal">kcal</span></p>
                  {protein != null && <p className="text-xs text-blue-500 font-medium mt-1">{Math.round(protein)}g protein</p>}
                  {carbs != null && <p className="text-xs text-amber-500 font-medium">{Math.round(carbs)}g carbs</p>}
                </div>
              ))}
            </div>
            {metrics.trainingDayCalories > metrics.restDayCalories! ? (
              <p className="text-xs text-green-500 mt-3 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Good carb periodization — higher intake on training days supports glycogen resynthesis.
              </p>
            ) : (
              <p className="text-xs text-amber-500 mt-3 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Suboptimal — training days should have more calories/carbs than rest days.
              </p>
            )}
          </Card>
        </motion.div>
      )}

      {/* ── 6 Expandable Sections ────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="space-y-3">

        {/* Daily Life Impact */}
        {analysis.dailyLifeImpact && (
          <SectionCard title="Daily Life Impact" icon={Activity}
            grade={analysis.dailyLifeImpact.grade} score={analysis.dailyLifeImpact.score}
            open={openSection === 'daily'} onToggle={() => toggleSection('daily')}>
            <p className="text-sm text-muted-foreground">{analysis.dailyLifeImpact.summary}</p>

            <div className="grid grid-cols-3 gap-3">
              {[
                { time: 'Morning', level: analysis.dailyLifeImpact.morningEnergy, detail: analysis.dailyLifeImpact.morningEnergyDetail },
                { time: 'Afternoon', level: analysis.dailyLifeImpact.afternoonEnergy, detail: analysis.dailyLifeImpact.afternoonEnergyDetail },
                { time: 'Evening', level: analysis.dailyLifeImpact.eveningEnergy, detail: analysis.dailyLifeImpact.eveningEnergyDetail },
              ].map(({ time, level, detail }) => (
                <div key={time} className="rounded-lg border border-border/50 p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{time}</p>
                  <EnergyDot level={level} />
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{detail}</p>
                </div>
              ))}
            </div>

            <DetailRow label="Mood Stability">
              <span className="font-semibold">{analysis.dailyLifeImpact.moodStabilityRating}/10</span>
              <span className="text-muted-foreground ml-2 text-[11px]">{analysis.dailyLifeImpact.moodStabilityDetail}</span>
            </DetailRow>

            {analysis.dailyLifeImpact.keyFactors.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Key Factors</p>
                <ul className="space-y-1">
                  {analysis.dailyLifeImpact.keyFactors.map((f, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5 shrink-0">•</span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Recommendations</p>
              <RecommendationList items={analysis.dailyLifeImpact.recommendations} />
            </div>
          </SectionCard>
        )}

        {/* Gym Performance */}
        {analysis.gymPerformance && (
          <SectionCard title="Gym Performance" icon={Dumbbell}
            grade={analysis.gymPerformance.grade} score={analysis.gymPerformance.score}
            open={openSection === 'gym'} onToggle={() => toggleSection('gym')}>
            <p className="text-sm text-muted-foreground">{analysis.gymPerformance.summary}</p>

            <div className="space-y-1">
              <DetailRow label="Strength Capacity">
                <span className={`font-semibold capitalize ${CAPACITY_COLOR[analysis.gymPerformance.strengthCapacity]}`}>
                  {analysis.gymPerformance.strengthCapacity.replace('_', ' ')}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.gymPerformance.strengthCapacityDetail}</p>
              </DetailRow>
              <DetailRow label="Endurance Capacity">
                <span className={`font-semibold capitalize ${CAPACITY_COLOR[analysis.gymPerformance.enduranceCapacity]}`}>
                  {analysis.gymPerformance.enduranceCapacity.replace('_', ' ')}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.gymPerformance.enduranceCapacityDetail}</p>
              </DetailRow>
              <DetailRow label="Recovery Between Sets">
                <span className={`font-semibold capitalize ${CAPACITY_COLOR[analysis.gymPerformance.recoveryBetweenSets as keyof typeof CAPACITY_COLOR]}`}>
                  {analysis.gymPerformance.recoveryBetweenSets.replace('_', ' ')}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.gymPerformance.recoveryBetweenSetsDetail}</p>
              </DetailRow>
              <DetailRow label="Pre-Workout Readiness">
                <span className="font-semibold capitalize">{analysis.gymPerformance.preWorkoutReadiness.replace('_', ' ')}</span>
              </DetailRow>
              <DetailRow label="Post-Workout Recovery">
                <span className="font-semibold capitalize">{analysis.gymPerformance.postWorkoutRecovery.replace('_', ' ')}</span>
              </DetailRow>
            </div>

            {analysis.gymPerformance.keyLimiter && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs">
                <span className="font-semibold text-destructive">Key Limiter: </span>
                <span className="text-muted-foreground">{analysis.gymPerformance.keyLimiter}</span>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Recommendations</p>
              <RecommendationList items={analysis.gymPerformance.recommendations} />
            </div>
          </SectionCard>
        )}

        {/* Lift-by-Lift Impact */}
        {analysis.liftImpact && analysis.liftImpact.length > 0 && (
          <SectionCard title="Lift-by-Lift Impact" icon={BarChart3}
            open={openSection === 'lifts'} onToggle={() => toggleSection('lifts')}>
            <div className="space-y-3">
              {analysis.liftImpact.map((item, i) => (
                <div key={i} className="rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm">{item.lift}</span>
                    <Badge className={`text-[10px] capitalize px-1.5 py-0 ${IMPACT_COLOR[item.impactLevel] ?? 'bg-muted text-muted-foreground'}`}>
                      {item.impactLevel}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{item.currentImpact}</p>
                  <p className="text-[11px] text-muted-foreground/70 italic mb-2">{item.scienceBacking}</p>
                  <div className="flex items-start gap-1.5 text-[11px] text-primary">
                    <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" />
                    {item.recommendation}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Mental Clarity */}
        {analysis.mentalClarity && (
          <SectionCard title="Mental Clarity & Focus" icon={Brain}
            grade={analysis.mentalClarity.grade} score={analysis.mentalClarity.score}
            open={openSection === 'mental'} onToggle={() => toggleSection('mental')}>
            <p className="text-sm text-muted-foreground">{analysis.mentalClarity.summary}</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border/50 p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Focus Rating</p>
                <p className="text-xl font-bold text-primary">{analysis.mentalClarity.focusRating}<span className="text-xs font-normal">/10</span></p>
              </div>
              <div className="rounded-lg border border-border/50 p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Glucose Stability</p>
                <p className="text-xl font-bold text-amber-500">{analysis.mentalClarity.glucoseStabilityRating}<span className="text-xs font-normal">/10</span></p>
              </div>
            </div>

            <div className="space-y-1">
              <DetailRow label="Glucose Stability">
                <p className="text-muted-foreground text-[11px]">{analysis.mentalClarity.glucoseStabilityDetail}</p>
              </DetailRow>
              <DetailRow label="Brain Fuel">
                <span className="font-semibold capitalize">{analysis.mentalClarity.brainFuelAdequacy}</span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.mentalClarity.brainFuelDetail}</p>
              </DetailRow>
              <DetailRow label="Neurotransmitter Support">
                <span className="font-semibold capitalize">{analysis.mentalClarity.neurotransmitterSupport}</span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.mentalClarity.neurotransmitterDetail}</p>
              </DetailRow>
            </div>

            <div>
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Recommendations</p>
              <RecommendationList items={analysis.mentalClarity.recommendations} />
            </div>
          </SectionCard>
        )}

        {/* Energy Pattern */}
        {analysis.energyPattern && (
          <SectionCard title="Energy Pattern & Timing" icon={Zap}
            open={openSection === 'energy'} onToggle={() => toggleSection('energy')}>
            <p className="text-sm text-muted-foreground">{analysis.energyPattern.summary}</p>

            {/* Timeline */}
            <div>
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Daily Energy Timeline</p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Morning', w: analysis.energyPattern.morningWindow },
                  { label: 'Mid-Day', w: analysis.energyPattern.midDayWindow },
                  { label: 'Afternoon', w: analysis.energyPattern.afternoonWindow },
                  { label: 'Evening', w: analysis.energyPattern.eveningWindow },
                ].map(({ label, w }) => {
                  const pct = { very_low: 20, low: 40, moderate: 60, high: 80 }[w.level] ?? 50;
                  const barColor = pct >= 70 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-400';
                  return (
                    <div key={label} className="rounded-lg border border-border/50 p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase mb-1">{label}</p>
                      <div className="h-12 flex items-end justify-center mb-1">
                        <div className={`w-4 rounded-t ${barColor}`} style={{ height: `${pct}%` }} />
                      </div>
                      <p className={`text-[10px] font-semibold capitalize ${ENERGY_LEVEL_COLOR[w.level]}`}>
                        {w.level.replace('_', ' ')}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <DetailRow label="Crash Risk">
                <span className={`font-semibold capitalize ${CRASH_COLOR[analysis.energyPattern.crashRisk]}`}>
                  {analysis.energyPattern.crashRisk.replace('_', ' ')}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.energyPattern.crashRiskDetail}</p>
              </DetailRow>
              <DetailRow label="Pattern">
                <span className="font-semibold capitalize">{analysis.energyPattern.pattern.replace('_', ' ')}</span>
              </DetailRow>
            </div>

            {analysis.energyPattern.optimalMealTiming && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
                <span className="font-semibold text-primary">Optimal Timing: </span>
                <span className="text-muted-foreground">{analysis.energyPattern.optimalMealTiming}</span>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Recommendations</p>
              <RecommendationList items={analysis.energyPattern.recommendations} />
            </div>
          </SectionCard>
        )}

        {/* Recovery & Sleep */}
        {analysis.recoveryAndSleep && (
          <SectionCard title="Recovery & Sleep" icon={Activity}
            grade={analysis.recoveryAndSleep.grade} score={analysis.recoveryAndSleep.score}
            open={openSection === 'recovery'} onToggle={() => toggleSection('recovery')}>
            <p className="text-sm text-muted-foreground">{analysis.recoveryAndSleep.summary}</p>

            <div className="space-y-1">
              <DetailRow label="Muscle Repair">
                <span className={`font-semibold capitalize ${CAPACITY_COLOR[analysis.recoveryAndSleep.muscleRepairCapacity]}`}>
                  {analysis.recoveryAndSleep.muscleRepairCapacity.replace('_', ' ')}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.recoveryAndSleep.muscleRepairDetail}</p>
              </DetailRow>
              <DetailRow label="Sleep Quality Impact">
                <span className={`font-semibold capitalize ${SLEEP_COLOR[analysis.recoveryAndSleep.sleepQualityImpact]}`}>
                  {analysis.recoveryAndSleep.sleepQualityImpact}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.recoveryAndSleep.sleepQualityDetail}</p>
              </DetailRow>
              <DetailRow label="Inflammation Risk">
                <span className={`font-semibold capitalize ${
                  analysis.recoveryAndSleep.inflammationRisk === 'low' ? 'text-green-500'
                  : analysis.recoveryAndSleep.inflammationRisk === 'moderate' ? 'text-yellow-500' : 'text-red-400'
                }`}>
                  {analysis.recoveryAndSleep.inflammationRisk}
                </span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.recoveryAndSleep.inflammationDetail}</p>
              </DetailRow>
              <DetailRow label="Hormone Support">
                <span className="font-semibold capitalize">{analysis.recoveryAndSleep.hormoneSupport}</span>
                <p className="text-muted-foreground text-[11px] mt-0.5">{analysis.recoveryAndSleep.hormonalDetail}</p>
              </DetailRow>
            </div>

            <div>
              <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Recommendations</p>
              <RecommendationList items={analysis.recoveryAndSleep.recommendations} />
            </div>
          </SectionCard>
        )}
      </motion.div>

      {/* ── Strengths & Improvements ─────────────────────────────────────── */}
      {(analysis.strengths?.length > 0 || analysis.improvements?.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {analysis.strengths?.length > 0 && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <h3 className="font-semibold text-sm">Strengths</h3>
                </div>
                <ul className="space-y-2">
                  {analysis.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-green-500 mt-0.5 shrink-0">•</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {analysis.improvements?.length > 0 && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <XCircle className="h-4 w-4 text-amber-500" />
                  <h3 className="font-semibold text-sm">Areas to Improve</h3>
                </div>
                <ul className="space-y-2">
                  {analysis.improvements.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-amber-500 mt-0.5 shrink-0">•</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Target Macros ────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Recommended Targets</h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Calories', value: `${analysis.macroRecommendation.calories}`, unit: 'kcal', color: 'text-orange-500', diff: analysis.macroRecommendation.calories - Math.round(metrics.avgCalories) },
              { label: 'Protein',  value: `${analysis.macroRecommendation.proteinG}`, unit: 'g',    color: 'text-blue-500',   diff: analysis.macroRecommendation.proteinG - Math.round(metrics.avgProtein) },
              { label: 'Carbs',    value: `${analysis.macroRecommendation.carbsG}`,   unit: 'g',    color: 'text-amber-500',  diff: analysis.macroRecommendation.carbsG - Math.round(metrics.avgCarbs) },
              { label: 'Fat',      value: `${analysis.macroRecommendation.fatG}`,     unit: 'g',    color: 'text-rose-400',   diff: analysis.macroRecommendation.fatG - Math.round(metrics.avgFat) },
            ].map(({ label, value, unit, color, diff }) => (
              <div key={label} className="text-center">
                <p className={`text-xl font-bold ${color}`}>{value}<span className="text-xs font-normal ml-0.5">{unit}</span></p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
                {diff !== 0 && (
                  <p className={`text-[10px] font-medium ${diff > 0 ? 'text-green-500' : 'text-red-400'}`}>
                    {diff > 0 ? '+' : ''}{diff}{unit}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Training / Rest Day Split */}
          {analysis.macroRecommendation.trainingDayProteinG != null && (
            <div className="grid grid-cols-2 gap-3 mb-4 pt-4 border-t border-border/50">
              {[
                {
                  label: 'Training Day Target',
                  protein: analysis.macroRecommendation.trainingDayProteinG,
                  carbs: analysis.macroRecommendation.trainingDayCarbsG,
                  color: 'border-primary/30 bg-primary/5',
                },
                {
                  label: 'Rest Day Target',
                  protein: analysis.macroRecommendation.restDayProteinG,
                  carbs: analysis.macroRecommendation.restDayCarbsG,
                  color: 'border-border bg-muted/30',
                },
              ].map(({ label, protein, carbs, color }) => (
                <div key={label} className={`rounded-lg border p-3 ${color}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
                  {protein != null && <p className="text-xs text-blue-500 font-medium">{protein}g protein</p>}
                  {carbs != null && <p className="text-xs text-amber-500 font-medium">{carbs}g carbs</p>}
                </div>
              ))}
            </div>
          )}

          {(analysis.macroRecommendation.rationale || analysis.macroRecommendation.notes) && (
            <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">
              {analysis.macroRecommendation.rationale ?? analysis.macroRecommendation.notes}
            </p>
          )}
        </Card>
      </motion.div>

      {/* ── Suggestions ─────────────────────────────────────────────────── */}
      {analysis.suggestions?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Utensils className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Actionable Suggestions</h2>
            </div>
            <RecommendationList items={analysis.suggestions} />
          </Card>
        </motion.div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ProfileTab = 'strength' | 'nutrition';

export default function StrengthProfilePage() {
  const [data, setData] = useState<StrengthProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedLift, setExpandedLift] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('strength');

  useEffect(() => {
    authFetch(`${API_BASE}/strength/profile`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar variant="full" />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span className="text-sm">Building your profile…</span>
        </div>
      </div>
    );
  }

  const hasData = data && data.lifts.length > 0;

  const radarData = data
    ? ['push', 'pull', 'legs', 'hinge', 'core'].map(cat => ({
        subject: cat.charAt(0).toUpperCase() + cat.slice(1),
        value: data.radarScores[cat] ?? 0,
        fullMark: 10,
      }))
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-bold">My Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Strength analytics, 1RM estimates, and AI-powered nutrition insights.
          </p>
        </div>

        {/* ── Tab Switcher ─────────────────────────────────────────────────── */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {([
            { id: 'strength',  label: 'Strength',  Icon: Dumbbell },
            { id: 'nutrition', label: 'Nutrition',  Icon: Apple    },
          ] as { id: ProfileTab; label: string; Icon: any }[]).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Strength Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'strength' && (
          <>
            {/* ── Hero Bar */}
            {data && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full border-4 border-primary/30 bg-primary/5 shrink-0">
                      <span className="text-2xl font-black leading-none text-primary">
                        {data.overallStrengthIndex ?? '—'}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">Index</span>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-lg font-bold ${TIER_COLOR[data.strengthTier] ?? ''}`}>
                          {data.strengthTier}
                        </span>
                        <Badge className={`text-[10px] font-semibold ${MATURITY_COLOR[data.maturityLabel]}`}>
                          {data.maturityLabel} Profile
                        </Badge>
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                          <span>Profile confidence</span>
                          <span>{data.maturityPct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-700"
                            style={{ width: `${data.maturityPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex gap-4 pt-1 flex-wrap">
                        <div>
                          <p className="text-xs text-muted-foreground">Workouts logged</p>
                          <p className="text-sm font-bold">{data.totalLogs}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Month tonnage</p>
                          <p className="text-sm font-bold">{data.monthTonnageKg.toLocaleString()} kg</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Lifts tracked</p>
                          <p className="text-sm font-bold">{data.lifts.length}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {/* ── No Data Empty State */}
            {!hasData && !loading && (
              <Card className="p-10 flex flex-col items-center gap-4 text-center text-muted-foreground">
                <BarChart3 className="h-10 w-10 opacity-30" />
                <div>
                  <p className="font-semibold">No data yet</p>
                  <p className="text-sm mt-1 max-w-xs">
                    Log some workouts with weights to start building your strength profile. 1RM estimates appear after your first session.
                  </p>
                </div>
              </Card>
            )}

            {hasData && (
              <>
                {/* ── AI Insights */}
                {data.aiInsights.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                    <Card className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Brain className="h-4 w-4 text-primary" />
                        <h2 className="font-semibold text-sm">AI Insights</h2>
                      </div>
                      <ul className="space-y-2">
                        {data.aiInsights.map((insight, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </motion.div>
                )}

                {/* ── Movement Balance Radar */}
                {radarData.some(d => d.value > 0) && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <Card className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Activity className="h-4 w-4 text-primary" />
                        <h2 className="font-semibold text-sm">Movement Balance</h2>
                        <span className="text-xs text-muted-foreground">volume by category (0–10)</span>
                      </div>
                      <ResponsiveContainer width="100%" height={220}>
                        <RadarChart data={radarData} outerRadius="70%">
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fontWeight: 500 }} />
                          <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
                          <ChartTooltip
                            contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                            formatter={(v: any) => [`${v}/10`, 'Score']}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </Card>
                  </motion.div>
                )}

                {/* ── Key Lifts Grid */}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Dumbbell className="h-4 w-4 text-primary" />
                    <h2 className="font-semibold text-sm">Key Lifts</h2>
                    <span className="text-xs text-muted-foreground">click to expand trend</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.lifts.map((lift, i) => (
                      <motion.div
                        key={lift.canonicalName}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 + i * 0.04 }}
                      >
                        <LiftCard
                          lift={lift}
                          expanded={expandedLift === lift.canonicalName}
                          onToggle={() =>
                            setExpandedLift(prev =>
                              prev === lift.canonicalName ? null : lift.canonicalName
                            )
                          }
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                {/* ── All Lifts Trend */}
                {data.lifts.some(l => l.weekSeries.length >= 2) && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <Card className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        <h2 className="font-semibold text-sm">1RM Trends</h2>
                        <span className="text-xs text-muted-foreground">compound lifts, last 8 weeks</span>
                      </div>

                      {(() => {
                        const compounds = data.lifts.filter(l => l.isCompound && l.weekSeries.length >= 2).slice(0, 6);
                        if (compounds.length === 0) return null;

                        const weekSet = new Set<string>();
                        compounds.forEach(l => l.weekSeries.forEach(p => weekSet.add(p.week)));
                        const weeks = Array.from(weekSet).sort();

                        const merged = weeks.map(week => {
                          const row: Record<string, any> = { week };
                          compounds.forEach(l => {
                            const pt = l.weekSeries.find(p => p.week === week);
                            row[l.canonicalName] = pt?.rmLbs ?? null;
                          });
                          return row;
                        });

                        return (
                          <>
                            <div className="flex flex-wrap gap-3 mb-3">
                              {compounds.map((l) => (
                                <div key={l.canonicalName} className="flex items-center gap-1">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLOR[l.category] ?? '#6366f1' }} />
                                  <span className="text-[11px] text-muted-foreground">{l.canonicalName}</span>
                                </div>
                              ))}
                            </div>
                            <ResponsiveContainer width="100%" height={200}>
                              <LineChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="week" tickFormatter={formatWeekLabel} tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} width={40} unit=" lbs" />
                                <ChartTooltip
                                  contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                                  formatter={(v: any, name: string) => [`${v} lbs`, name]}
                                  labelFormatter={formatWeekLabel}
                                />
                                {compounds.map((l) => (
                                  <Line
                                    key={l.canonicalName}
                                    type="monotone"
                                    dataKey={l.canonicalName}
                                    stroke={CATEGORY_COLOR[l.category] ?? '#6366f1'}
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls
                                  />
                                ))}
                              </LineChart>
                            </ResponsiveContainer>
                          </>
                        );
                      })()}
                    </Card>
                  </motion.div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Nutrition Tab ────────────────────────────────────────────────── */}
        {activeTab === 'nutrition' && <NutritionProfileSection />}

      </main>
    </div>
  );
}
