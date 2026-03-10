import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import {
  Dumbbell, TrendingUp, Target, Loader2, Activity, Calendar, BarChart3,
} from 'lucide-react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface IndexScore { value: number; confidence: number }
interface EfficiencyPoint { date: string; score: number; lift: string }
interface LimiterEntry { name: string; count: number }
interface SessionEntry {
  id: string; date: string; selectedLift: string;
  primaryLimiter: string | null; efficiencyScore: number | null;
}
interface ProgressionPoint { date: string; maxWeightKg: number; sets: number; reps: string }
interface ExerciseProgression { name: string; data: ProgressionPoint[] }
interface WeekVolume { week: string; totalSets: number; totalExercises: number }
interface WeightLog { date: string; weightLbs: number }

interface StrengthProfileData {
  latestIndices: Record<string, IndexScore> | null;
  efficiencyTrend: EfficiencyPoint[];
  topLimiters: LimiterEntry[];
  sessionHistory: SessionEntry[];
  progressionData: ExerciseProgression[];
  weeklyVolumeData: WeekVolume[];
  weightLogs: WeightLog[];
  totalSessions: number;
  totalWorkouts: number;
}

function formatLiftName(id: string) {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeek(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const LINE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

export default function StrengthProfilePage() {
  const [data, setData] = useState<StrengthProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);

  useEffect(() => {
    authFetch(`${API_BASE}/strength-profile`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setData(d);
          if (d.progressionData?.length > 0) setSelectedExercise(d.progressionData[0].name);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar variant="full" />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  const hasAnyData = data && (data.totalSessions > 0 || data.totalWorkouts > 0);

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Strength Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A comprehensive view of your strength, balance, and progression based on your diagnostics and workout logs.
          </p>
        </div>

        {/* Summary stats */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Diagnostics', value: data.totalSessions, icon: Target },
              { label: 'Workouts Logged', value: data.totalWorkouts, icon: Dumbbell },
              { label: 'Top Limiters', value: data.topLimiters.length, icon: Activity },
              { label: 'Exercises Tracked', value: data.progressionData.length, icon: TrendingUp },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label} className="p-4 flex flex-col gap-1">
                <Icon className="h-4 w-4 text-primary" />
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </Card>
            ))}
          </div>
        )}

        {!hasAnyData && (
          <Card className="p-10 flex flex-col items-center gap-4 text-center text-muted-foreground">
            <BarChart3 className="h-10 w-10 opacity-30" />
            <div>
              <p className="font-semibold">No data yet</p>
              <p className="text-sm mt-1 max-w-xs">
                Complete a diagnostic analysis or log some workouts to start building your strength profile.
              </p>
            </div>
          </Card>
        )}

        {/* Muscle balance radar */}
        {data?.latestIndices && Object.keys(data.latestIndices).length > 0 && (() => {
          const INDEX_LABELS: Record<string, string> = {
            quad_index: 'Quads',
            posterior_index: 'Posterior',
            back_tension_index: 'Back',
            triceps_index: 'Triceps',
            shoulder_index: 'Shoulders',
          };
          const radarData = Object.entries(data.latestIndices).map(([key, val]) => ({
            subject: INDEX_LABELS[key] || key,
            value: Math.round((val as IndexScore).value),
            fullMark: 100,
          }));
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold">Muscle Balance</h2>
                  <span className="text-xs text-muted-foreground ml-1">from latest diagnostic</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                    <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                    <ChartTooltip
                      contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      formatter={(v: any) => [`${v}/100`, 'Score']}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </Card>
            </motion.div>
          );
        })()}

        {/* Efficiency score trend */}
        {data?.efficiencyTrend && data.efficiencyTrend.length > 1 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Efficiency Score Trend</h2>
                <span className="text-xs text-muted-foreground ml-1">across all diagnostics</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.efficiencyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={30} />
                  <ChartTooltip
                    contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    formatter={(v: any) => [`${v}/100`, 'Score']}
                    labelFormatter={formatShortDate}
                  />
                  <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        )}

        {/* Top limiters */}
        {data?.topLimiters && data.topLimiters.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Recurring Limiters</h2>
                <span className="text-xs text-muted-foreground ml-1">most frequent weak points</span>
              </div>
              <div className="space-y-2">
                {data.topLimiters.map((l, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-muted-foreground w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{l.name}</span>
                        <Badge variant="secondary" className="text-[10px] ml-2 shrink-0">
                          {l.count} {l.count === 1 ? 'session' : 'sessions'}
                        </Badge>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${(l.count / data.topLimiters[0].count) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {/* Weekly workout volume */}
        {data?.weeklyVolumeData && data.weeklyVolumeData.length > 1 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Weekly Volume</h2>
                <span className="text-xs text-muted-foreground ml-1">sets logged per week</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.weeklyVolumeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} width={30} />
                  <ChartTooltip
                    contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    formatter={(v: any, name: string) => [v, name === 'totalSets' ? 'Total Sets' : 'Exercises']}
                    labelFormatter={formatWeek}
                  />
                  <Bar dataKey="totalSets" fill="#6366f1" radius={[3, 3, 0, 0]} name="Sets" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        )}

        {/* Exercise progression */}
        {data?.progressionData && data.progressionData.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold">Progressive Overload</h2>
                  <span className="text-xs text-muted-foreground ml-1">weight over time</span>
                </div>
              </div>

              {/* Exercise selector pills */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {data.progressionData.map((ex, i) => (
                  <button
                    key={ex.name}
                    onClick={() => setSelectedExercise(ex.name)}
                    className={[
                      'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                      selectedExercise === ex.name
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    ].join(' ')}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>

              {selectedExercise && (() => {
                const ex = data.progressionData.find(e => e.name === selectedExercise);
                if (!ex) return null;
                return (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={ex.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} width={40} unit="kg" />
                      <ChartTooltip
                        contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                        formatter={(v: any) => [`${v}kg`, 'Max Weight']}
                        labelFormatter={formatShortDate}
                      />
                      <Line type="monotone" dataKey="maxWeightKg" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                );
              })()}
            </Card>
          </motion.div>
        )}

        {/* Session history table */}
        {data?.sessionHistory && data.sessionHistory.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Diagnostic History</h2>
              </div>
              <div className="space-y-2">
                {data.sessionHistory.map(s => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{formatLiftName(s.selectedLift)}</p>
                      <p className="text-xs text-muted-foreground">{formatShortDate(s.date)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      {s.primaryLimiter && (
                        <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[150px]">
                          {s.primaryLimiter}
                        </span>
                      )}
                      {s.efficiencyScore !== null && (
                        <Badge variant="secondary" className="text-xs font-bold">
                          {s.efficiencyScore}/100
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </main>
    </div>
  );
}
