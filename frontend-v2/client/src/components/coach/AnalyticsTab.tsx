import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Loader2, BarChart3 } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface DataPoint {
  sessionId: string;
  date: string;
  lift: string;
  primaryLimiter: string | null;
  archetype: string | null;
  efficiencyScore: number | null;
  hypothesisScores: Array<{ label: string; score: number; category: string }>;
  phaseScores: Array<{ phase_id: string; points: number }>;
  primaryPhase: string | null;
  indices: Record<string, { value: number; confidence: number } | null>;
}

interface AnalyticsData {
  dataPoints: DataPoint[];
  limiterCounts: Record<string, number>;
}

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function formatLift(id: string) {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/coach/analytics`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.dataPoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center p-6">
        <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-semibold">No data yet</p>
        <p className="text-sm text-muted-foreground">Complete your first analysis to see progress charts here.</p>
      </div>
    );
  }

  const { dataPoints, limiterCounts } = data;

  // Efficiency score trend
  const efficiencyData = dataPoints.map(d => ({
    date: d.date,
    score: d.efficiencyScore,
    lift: formatLift(d.lift),
  }));

  // Limiter frequency bar chart
  const limiterData = Object.entries(limiterCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Average hypothesis scores across all sessions
  const hypMap: Record<string, { total: number; count: number }> = {};
  for (const d of dataPoints) {
    for (const h of d.hypothesisScores) {
      if (!hypMap[h.label]) hypMap[h.label] = { total: 0, count: 0 };
      hypMap[h.label].total += h.score;
      hypMap[h.label].count += 1;
    }
  }
  const hypothesisData = Object.entries(hypMap)
    .map(([label, v]) => ({ label, avg: Math.round(v.total / v.count) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  // Phase frequency
  const phaseMap: Record<string, number> = {};
  for (const d of dataPoints) {
    for (const ps of d.phaseScores) {
      phaseMap[ps.phase_id] = (phaseMap[ps.phase_id] || 0) + ps.points;
    }
  }
  const phaseData = Object.entries(phaseMap)
    .map(([phase, total]) => ({ phase, total }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Efficiency Score Trend */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Muscle Balance Score — Trend</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={efficiencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                formatter={(val: any) => [`${val}/100`, 'Balance Score']}
              />
              <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} name="Balance Score" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Limiter Frequency */}
        {limiterData.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Recurring Limiters</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={limiterData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    formatter={(val: any) => [val, 'Sessions']}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        )}

        {/* Phase weakness */}
        {phaseData.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card className="p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Phase Weakness Totals</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={phaseData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="phase" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Hypothesis Score Distribution */}
      {hypothesisData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Average Hypothesis Scores (all sessions)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hypothesisData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 10 }} width={160} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                  formatter={(val: any) => [`${val}/100`, 'Avg Score']}
                />
                <Bar dataKey="avg" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* Session list */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Card className="p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Session History</p>
          <div className="space-y-2">
            {[...dataPoints].reverse().map((d, i) => (
              <div key={d.sessionId} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                <div>
                  <span className="text-sm font-medium">{formatLift(d.lift)}</span>
                  <span className="text-xs text-muted-foreground ml-2">{d.date}</span>
                </div>
                <div className="flex items-center gap-3">
                  {d.primaryLimiter && (
                    <span className="text-xs text-muted-foreground hidden sm:block">{d.primaryLimiter}</span>
                  )}
                  {d.efficiencyScore !== null && (
                    <span className="text-xs font-bold text-primary">{d.efficiencyScore}/100</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
