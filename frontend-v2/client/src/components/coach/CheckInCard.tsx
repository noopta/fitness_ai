import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, X, CheckCircle2, Heart } from 'lucide-react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Props {
  accountability: string | null | undefined;
}

type MetricKey = 'mood' | 'energy' | 'sleepHours' | 'stress';

const MOOD_EMOJI  = ['', '😞', '😕', '😐', '🙂', '😄'];
const ENERGY_EMOJI = ['', '🪫', '😴', '⚡', '🔥', '🚀'];
const STRESS_EMOJI = ['', '😤', '😰', '😐', '😌', '🧘'];

function todayStr() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns a YYYY-WW string for the current ISO week */
function currentWeekKey() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((+d - +new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Whether we should show the check-in prompt based on the accountability preference. */
function shouldShowPrompt(accountability: string | null | undefined): boolean {
  if (!accountability || accountability === 'on_demand') return false;

  const today = todayStr();
  const week = currentWeekKey();
  const dismissedDay = localStorage.getItem('checkin_dismissed_day');
  const dismissedWeek = localStorage.getItem('checkin_dismissed_week');
  const submittedDay = localStorage.getItem('checkin_submitted_day');

  // Don't re-prompt if already submitted today
  if (submittedDay === today) return false;

  if (accountability === 'app_daily') {
    // Show daily unless dismissed today
    return dismissedDay !== today;
  }

  if (accountability === 'weekly_review' || accountability === 'flexible') {
    // Show once per week unless dismissed this week
    return dismissedWeek !== week;
  }

  return false;
}

function dismissPrompt(accountability: string | null | undefined) {
  if (accountability === 'app_daily') {
    localStorage.setItem('checkin_dismissed_day', todayStr());
  } else {
    localStorage.setItem('checkin_dismissed_week', currentWeekKey());
  }
}

// ─── Slider row ─────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  emoji?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, emoji, onChange }: SliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-sm font-bold tabular-nums">
          {emoji || value}{step < 1 ? '' : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground/60">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CheckInCard({ accountability }: Props) {
  const [visible, setVisible] = useState(false);
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [sleepHours, setSleepHours] = useState(7);
  const [stress, setStress] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // Small delay so it doesn't flash on initial load
    const t = setTimeout(() => {
      setVisible(shouldShowPrompt(accountability));
    }, 800);
    return () => clearTimeout(t);
  }, [accountability]);

  function handleDismiss() {
    dismissPrompt(accountability);
    setVisible(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const resp = await authFetch(`${API_BASE}/wellness/checkin`, {
        method: 'POST',
        body: JSON.stringify({
          date: todayStr(),
          mood,
          energy,
          sleepHours,
          stress,
        }),
      });
      if (!resp.ok) throw new Error('Failed to save');
      localStorage.setItem('checkin_submitted_day', todayStr());
      setSubmitted(true);
      toast.success('Check-in saved!');
      setTimeout(() => setVisible(false), 2000);
    } catch {
      toast.error('Could not save check-in. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="p-5 border-primary/20 bg-primary/5">
            {submitted ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Check-in saved!</p>
                  <p className="text-xs text-muted-foreground">Your coach will factor this into today's recommendations.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10">
                      <Heart className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Daily Check-In</p>
                      <p className="text-xs text-muted-foreground">How are you feeling today?</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDismiss}
                    className="rounded-lg p-1 hover:bg-muted text-muted-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <SliderRow
                    label="Mood"
                    value={mood}
                    min={1}
                    max={5}
                    step={1}
                    emoji={MOOD_EMOJI[mood]}
                    onChange={setMood}
                  />
                  <SliderRow
                    label="Energy"
                    value={energy}
                    min={1}
                    max={5}
                    step={1}
                    emoji={ENERGY_EMOJI[energy]}
                    onChange={setEnergy}
                  />
                  <SliderRow
                    label="Sleep (hours)"
                    value={sleepHours}
                    min={3}
                    max={12}
                    step={0.5}
                    emoji={`${sleepHours}h`}
                    onChange={setSleepHours}
                  />
                  <SliderRow
                    label="Stress"
                    value={stress}
                    min={1}
                    max={5}
                    step={1}
                    emoji={STRESS_EMOJI[stress]}
                    onChange={setStress}
                  />
                </div>

                {/* Submit */}
                <Button
                  size="sm"
                  className="w-full rounded-xl"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Log Check-In'
                  )}
                </Button>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
