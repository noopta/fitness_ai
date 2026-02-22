import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Sparkles, Apple } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface NutritionLog {
  id: string;
  date: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  notes?: string;
}

interface NutritionPlan {
  macros: { proteinG: number; carbsG: number; fatG: number; calories: number };
  foods: Array<{ name: string; reason: string }>;
  rationale: string;
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
  isPro: boolean;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function NutritionTab({ latestSession, weightKg, trainingAge, isPro }: Props) {
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [form, setForm] = useState({ date: todayStr(), proteinG: '', carbsG: '', fatG: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [aiPlan, setAiPlan] = useState<NutritionPlan | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/nutrition/log`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  }, []);

  // Pre-fill form with today's log if it exists
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
          goal: latestSession?.plan?.goal || 'strength_peak',
          weightKg,
          trainingAge,
          primaryLimiter: latestSession?.primaryLimiter || null,
          selectedLift: latestSession?.selectedLift || null,
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

  const protein = Number(form.proteinG) || 0;
  const carbs = Number(form.carbsG) || 0;
  const fat = Number(form.fatG) || 0;
  const calories = protein * 4 + carbs * 4 + fat * 9;

  // 7-day trend data
  const trendData = [...logs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map(l => ({ date: l.date.slice(5), protein: l.proteinG, carbs: l.carbsG, fat: l.fatG }));

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Daily log */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
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
              { key: 'proteinG', label: 'Protein (g)', color: '#6366f1' },
              { key: 'carbsG', label: 'Carbs (g)', color: '#22c55e' },
              { key: 'fatG', label: 'Fat (g)', color: '#f59e0b' },
            ].map(({ key, label, color }) => (
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
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-bold">{calories} kcal</span>
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

      {/* AI Recommendation */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Macro Recommendation</p>
            <Button onClick={getAiPlan} disabled={aiLoading || !isPro} size="sm" variant="outline" className="rounded-xl text-xs">
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Get AI Plan
            </Button>
          </div>

          {!isPro && (
            <p className="text-xs text-muted-foreground">AI nutrition recommendations are a Pro feature.</p>
          )}

          {aiPlan && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Protein', value: aiPlan.macros.proteinG + 'g', color: '#6366f1' },
                  { label: 'Carbs', value: aiPlan.macros.carbsG + 'g', color: '#22c55e' },
                  { label: 'Fat', value: aiPlan.macros.fatG + 'g', color: '#f59e0b' },
                  { label: 'Calories', value: aiPlan.macros.calories + '', color: '#ef4444' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl border p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-base font-bold mt-0.5" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{aiPlan.rationale}</p>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recommended Foods</p>
                {aiPlan.foods.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2">
                    <Apple className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{f.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
