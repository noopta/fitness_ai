import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Sparkles, Heart } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Checkin {
  id: string;
  date: string;
  mood: number;
  energy: number;
  sleepHours: number;
  stress: number;
}

interface Props {
  latestPlan: any;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const EMOJI_SCALE = ['', '😞', '😐', '🙂', '😊', '🤩'];

function SliderInput({ label, value, onChange, emoji = false }: {
  label: string; value: number; onChange: (v: number) => void; emoji?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs font-bold text-primary">
          {emoji ? EMOJI_SCALE[value] || value : value}
          {!emoji && '/5'}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Low</span>
        <span>High</span>
      </div>
    </div>
  );
}

export function WellnessTab({ latestPlan }: Props) {
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ mood: 3, energy: 3, sleepHours: 7.5, stress: 2 });
  const [saving, setSaving] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/wellness/checkins`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCheckins(d.checkins || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function submitCheckin() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/wellness/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date: todayStr(), ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setCheckins(prev => {
        const next = prev.filter(c => c.date !== todayStr());
        return [data.checkin, ...next].sort((a, b) => b.date.localeCompare(a.date));
      });
      setInsight(data.insight || null);
      toast.success('Check-in saved!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Trend data (last 7 days)
  const trendData = [...checkins]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map(c => ({ date: c.date.slice(5), mood: c.mood, energy: c.energy, sleep: c.sleepHours, stress: c.stress }));

  // Prehab from plan hypotheses
  const hypotheses = latestPlan?.diagnostic_signals?.hypothesis_scores || [];
  const weakHypotheses = hypotheses.filter((h: any) => h.score >= 40).slice(0, 3);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Daily Check-in */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily Check-in</p>
            <span className="text-xs text-muted-foreground">{todayStr()}</span>
          </div>

          <SliderInput label="Mood" value={form.mood} onChange={v => setForm(f => ({ ...f, mood: v }))} emoji />
          <SliderInput label="Energy" value={form.energy} onChange={v => setForm(f => ({ ...f, energy: v }))} />
          <SliderInput label="Stress" value={form.stress} onChange={v => setForm(f => ({ ...f, stress: v }))} />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Sleep Hours</span>
              <span className="text-xs font-bold text-primary">{form.sleepHours}h</span>
            </div>
            <input
              type="range"
              min={4}
              max={12}
              step={0.5}
              value={form.sleepHours}
              onChange={e => setForm(f => ({ ...f, sleepHours: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>4h</span>
              <span>12h</span>
            </div>
          </div>

          <Button onClick={submitCheckin} disabled={saving} className="w-full rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Heart className="h-4 w-4 mr-2" />}
            Submit Check-in
          </Button>
        </Card>
      </motion.div>

      {/* AI Wellness Insight */}
      {insight && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="p-4 border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-primary mb-0.5">Recovery Insight</p>
                <p className="text-sm">{insight}</p>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Recovery dashboard */}
      {trendData.length > 1 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">7-Day Recovery Trend</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[1, 5]} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="mood" stroke="#6366f1" strokeWidth={2} dot={false} name="Mood" />
                <Line type="monotone" dataKey="energy" stroke="#22c55e" strokeWidth={2} dot={false} name="Energy" />
                <Line type="monotone" dataKey="stress" stroke="#ef4444" strokeWidth={2} dot={false} name="Stress" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* Prehab recommendations */}
      {weakHypotheses.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="p-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prehab / Injury Prevention</p>
            <p className="text-xs text-muted-foreground">Based on your weakness data, these areas need proactive attention:</p>
            {weakHypotheses.map((h: any, i: number) => (
              <div key={i} className="rounded-lg bg-muted/30 px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold">{h.label}</p>
                  <span className="text-xs font-bold text-amber-500">{h.score}/100</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {h.category === 'muscle' && 'Focus on strengthening this muscle group with isolation work and controlled eccentrics.'}
                  {h.category === 'mechanical' && 'Address movement pattern through technique drills and controlled tempo work.'}
                  {h.category === 'stability' && 'Prioritize stability and proprioception work — unilateral movements and isometric holds.'}
                  {!['muscle', 'mechanical', 'stability'].includes(h.category) && 'Dedicate extra volume to address this weakness before it becomes an injury risk.'}
                </p>
              </div>
            ))}
          </Card>
        </motion.div>
      )}

      {/* Recent checkins */}
      {!loading && checkins.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent Check-ins</p>
            <div className="space-y-2">
              {checkins.slice(0, 7).map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{c.date}</span>
                  <div className="flex gap-4 text-xs">
                    <span>{EMOJI_SCALE[c.mood]}</span>
                    <span className="text-[#22c55e]">E:{c.energy}/5</span>
                    <span className="text-[#6366f1]">{c.sleepHours}h</span>
                    <span className="text-[#ef4444]">S:{c.stress}/5</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
