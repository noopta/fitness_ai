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
} from 'lucide-react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

// ─── Types ────────────────────────────────────────────────────────────────────

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

function formatWeekLabel(wk: string) {
  // "2026-W10" → "W10"
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

      {/* Sparkline */}
      <div className="mt-3">
        <Sparkline data={lift.weekSeries} color={color} />
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <GainBadge pct={lift.monthlyGainPct} />
        <span className="text-[10px] text-muted-foreground">{lift.sessionCount} sessions</span>
      </div>

      {/* Expanded: full 1RM trend chart */}
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StrengthProfilePage() {
  const [data, setData] = useState<StrengthProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedLift, setExpandedLift] = useState<string | null>(null);

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

  // Radar data for Push/Pull/Legs/Hinge/Core
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
          <h1 className="text-2xl font-bold">Strength Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live 1RM estimates, movement balance, and AI insights from your workout logs.
          </p>
        </div>

        {/* ── Hero Bar ────────────────────────────────────────────────────── */}
        {data && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-4">

                {/* Strength Index */}
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

                  {/* Maturity progress bar */}
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

        {/* ── No Data Empty State ──────────────────────────────────────────── */}
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
            {/* ── AI Insights ────────────────────────────────────────────── */}
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

            {/* ── Movement Balance Radar ───────────────────────────────── */}
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

            {/* ── Key Lifts Grid ───────────────────────────────────────── */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="flex items-center gap-2 mb-3">
                <Dumbbell className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-sm">Key Lifts</h2>
                <span className="text-xs text-muted-foreground">tap to expand trend</span>
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

            {/* ── All Lifts Trend (multi-line toggle) ─────────────────── */}
            {data.lifts.some(l => l.weekSeries.length >= 2) && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <h2 className="font-semibold text-sm">1RM Trends</h2>
                    <span className="text-xs text-muted-foreground">compound lifts, last 8 weeks</span>
                  </div>

                  {/* Build a unified week axis across compound lifts */}
                  {(() => {
                    const compounds = data.lifts.filter(l => l.isCompound && l.weekSeries.length >= 2).slice(0, 6);
                    if (compounds.length === 0) return null;

                    // Collect all week keys and build merged dataset
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
                        {/* Legend */}
                        <div className="flex flex-wrap gap-3 mb-3">
                          {compounds.map((l, i) => (
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
      </main>
    </div>
  );
}
