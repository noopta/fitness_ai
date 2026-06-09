// SwapWorkoutDialog (web) — swap another day's workout into today, review the
// LLM-rebalanced week, then apply. Backed by /coach/swap-day + /coach/apply-week-plan.

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, X, ChevronRight, Sparkles, Check } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface WeekDay {
  date: string;
  dayLabel: string;
  isToday?: boolean;
  isTrainingDay?: boolean;
  isLogged?: boolean;
  isSwapped?: boolean;
  locked?: boolean;
  session?: { day?: string; focus?: string } | null;
}

interface Props {
  weekDays: WeekDay[];
  onClose: () => void;
  onApplied: () => void;
}

export function SwapWorkoutDialog({ weekDays, onClose, onApplied }: Props) {
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposedWeek, setProposedWeek] = useState<WeekDay[]>([]);
  const [rationale, setRationale] = useState('');

  const todayDate = weekDays.find(d => d.isToday)?.date ?? '';
  const candidates = weekDays.filter(d => !d.isToday && d.isTrainingDay && d.session && !d.isLogged);

  async function pickSource(sourceDate: string) {
    if (!todayDate) { toast.error("Couldn't determine today's date."); return; }
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/swap-day`, {
        method: 'POST',
        body: JSON.stringify({ date: todayDate, sourceDate }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Swap failed');
      const data = await res.json();
      setProposedWeek(data.proposedWeek ?? []);
      setRationale(data.rationale ?? '');
      setStep('review');
    } catch (err: any) {
      toast.error(err.message || 'Could not plan the swap.');
    } finally {
      setLoading(false);
    }
  }

  async function applyPlan() {
    setApplying(true);
    try {
      const res = await authFetch(`${API_BASE}/coach/apply-week-plan`, {
        method: 'POST',
        body: JSON.stringify({
          week: proposedWeek.map(d => ({ date: d.date, session: d.session ?? null, locked: d.locked })),
          reason: 'Workout swap',
        }),
      });
      if (!res.ok) throw new Error();
      toast.success('Week updated!');
      onApplied();
    } catch {
      toast.error('Could not apply the new week.');
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <Card className="w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{step === 'pick' ? 'Swap today’s workout' : 'Review your week'}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Re-planning your week…</p>
          </div>
        ) : step === 'pick' ? (
          <>
            <p className="text-sm text-muted-foreground">
              Pick a workout from this week to do today instead. We’ll re-balance the rest of
              the week so you don’t double up on tired muscles.
            </p>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No other workouts available to swap in this week.
              </p>
            ) : (
              <div className="space-y-2">
                {candidates.map(d => (
                  <button
                    key={d.date}
                    onClick={() => pickSource(d.date)}
                    className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{d.session?.day || d.session?.focus || 'Workout'}</p>
                      {d.session?.focus && d.session?.day && (
                        <p className="text-xs text-muted-foreground truncate">{d.session.focus}</p>
                      )}
                    </div>
                    <span className="text-xs font-bold text-muted-foreground">{d.dayLabel}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {rationale && (
              <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
                <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{rationale}</span>
              </div>
            )}
            <div className="space-y-1.5">
              {proposedWeek.map(d => (
                <div
                  key={d.date}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    d.isToday ? 'border-foreground bg-muted' : 'border-border'
                  } ${d.locked ? 'opacity-50' : ''}`}
                >
                  <span className="w-10 text-xs font-bold text-muted-foreground">{d.dayLabel}</span>
                  <span className="flex-1 text-sm truncate">
                    {d.session ? (d.session.day || d.session.focus) : 'Rest'}
                  </span>
                  {d.isToday && <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[9px] font-bold text-background">TODAY</span>}
                  {d.isSwapped && !d.isToday && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">moved</span>}
                  {d.isLogged && <Check className="h-3.5 w-3.5 text-green-500" />}
                </div>
              ))}
            </div>
            <Button className="w-full rounded-xl" onClick={applyPlan} disabled={applying}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Apply this week
            </Button>
            <button
              onClick={() => setStep('pick')}
              disabled={applying}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground py-1"
            >
              Choose a different day
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
