import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  X, Loader2, AlertTriangle, Zap, Utensils, Calendar,
  CheckCircle2, ChevronRight, Sparkles, Clock, Heart
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface AdjustmentResult {
  disruptionType: string;
  disruptionLabel: string;
  severity: 'mild' | 'moderate' | 'significant';
  physiologicalImpacts: string[];
  trainingImpact: {
    missedSessions: number;
    intensityNote: string;
    summary: string;
  };
  nutritionalAdvice: {
    immediate: string[];
    today: string[];
    supplements: string[];
  } | null;
  suggestedShiftDays: number;
  adjustmentRationale: string;
  coachNote: string;
  recoveryTimeline: string;
}

interface Props {
  onClose: () => void;
  onApplied: () => void;
}

const SEVERITY_CONFIG = {
  mild:        { label: 'Mild impact',        color: 'text-green-600',  bg: 'bg-green-500/10',  border: 'border-green-500/30' },
  moderate:    { label: 'Moderate impact',    color: 'text-amber-600',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30' },
  significant: { label: 'Significant impact', color: 'text-red-600',    bg: 'bg-red-500/10',    border: 'border-red-500/30'   },
};

const EXAMPLE_PROMPTS = [
  "I drank a lot last night at a birthday party",
  "I've been sick with a cold for 3 days",
  "I had a work deadline and missed 2 training sessions",
  "I'm on vacation and don't have gym access this week",
  "I pulled my lower back slightly yesterday",
];

export function LifeHappenedModal({ onClose, onApplied }: Props) {
  const [stage, setStage] = useState<'input' | 'loading' | 'result'>('input');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<AdjustmentResult | null>(null);
  const [applying, setApplying] = useState(false);

  async function handleSubmit() {
    if (input.trim().length < 5) return;
    setStage('loading');
    try {
      const res = await fetch(`${API_BASE}/coach/adjust`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput: input.trim() }),
      });
      if (!res.ok) throw new Error('Failed to analyze');
      const data: AdjustmentResult = await res.json();
      setResult(data);
      setStage('result');
    } catch {
      toast.error('Failed to analyze. Please try again.');
      setStage('input');
    }
  }

  async function handleApply() {
    if (!result) return;
    setApplying(true);
    try {
      const res = await fetch(`${API_BASE}/coach/apply-adjustment`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftDays: result.suggestedShiftDays }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Schedule adjusted — your program is updated.');
      onApplied();
    } catch {
      toast.error('Failed to apply adjustment.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={stage !== 'loading' ? onClose : undefined}
      />

      {/* Modal */}
      <motion.div
        className="relative bg-background rounded-2xl w-full max-w-lg shadow-2xl z-10 overflow-hidden max-h-[90vh] flex flex-col"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10">
              <Heart className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-sm">Life Happened</h2>
              <p className="text-[11px] text-muted-foreground">Tell your coach what's going on</p>
            </div>
          </div>
          {stage !== 'loading' && (
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">

            {/* ── Stage: Input ─────────────────────────────────────── */}
            {stage === 'input' && (
              <motion.div
                key="input"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-6 space-y-5"
              >
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Missed a session? Had a rough night out? Feeling under the weather? Tell your coach what happened and get a personalized recovery plan with adjusted training and nutrition advice.
                </p>

                <textarea
                  className="w-full rounded-xl border bg-muted/40 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/60"
                  rows={4}
                  placeholder="e.g. I drank last night at my friend's birthday, didn't sleep well, and feel rough this morning..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && e.metaKey && handleSubmit()}
                  autoFocus
                />

                {/* Example prompts */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Common situations</p>
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLE_PROMPTS.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => setInput(p)}
                        className="text-[11px] rounded-full bg-muted px-2.5 py-1 hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full rounded-xl"
                  onClick={handleSubmit}
                  disabled={input.trim().length < 5}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze & Get Recovery Plan
                </Button>
              </motion.div>
            )}

            {/* ── Stage: Loading ───────────────────────────────────── */}
            {stage === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center gap-5 py-16 px-6"
              >
                <div className="relative">
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-primary" />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-semibold text-sm">Analyzing your situation…</p>
                  <p className="text-xs text-muted-foreground">Your coach is reviewing the physiological impact and adjusting your plan</p>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
                  {['Classifying disruption type', 'Calculating physiological impact', 'Building recovery protocol', 'Adjusting training schedule'].map((step, i) => (
                    <motion.div
                      key={step}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.5 }}
                      className="flex items-center gap-2"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                      {step}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Stage: Result ────────────────────────────────────── */}
            {stage === 'result' && result && (
              <motion.div
                key="result"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-6 space-y-5"
              >
                {/* Disruption header */}
                <div className={`rounded-xl border p-4 space-y-1 ${SEVERITY_CONFIG[result.severity].bg} ${SEVERITY_CONFIG[result.severity].border}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{result.disruptionLabel}</span>
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${SEVERITY_CONFIG[result.severity].color}`}>
                      {SEVERITY_CONFIG[result.severity].label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{result.coachNote}</p>
                </div>

                {/* Physiological impacts */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> What's happening to your body
                  </p>
                  <div className="space-y-1.5">
                    {result.physiologicalImpacts.map((impact, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-xs text-foreground/80 bg-muted/40 rounded-lg px-3 py-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                        {impact}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Training impact */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Zap className="h-3 w-3" /> Training impact
                  </p>
                  <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-1.5">
                    <p className="text-xs font-semibold">{result.trainingImpact.intensityNote}</p>
                    <p className="text-xs text-muted-foreground">{result.trainingImpact.summary}</p>
                  </div>
                </div>

                {/* Nutritional advice */}
                {result.nutritionalAdvice && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <Utensils className="h-3 w-3" /> Nutritional recovery
                    </p>
                    <div className="space-y-2">
                      {result.nutritionalAdvice.immediate.length > 0 && (
                        <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-4 py-3">
                          <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-1.5">Do this now</p>
                          {result.nutritionalAdvice.immediate.map((item, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-foreground/80 mb-1">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-500" />
                              {item}
                            </div>
                          ))}
                        </div>
                      )}
                      {result.nutritionalAdvice.today.length > 0 && (
                        <div className="rounded-xl bg-muted/40 px-4 py-3">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Today's eating focus</p>
                          {result.nutritionalAdvice.today.map((item, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-foreground/80 mb-1">
                              <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
                              {item}
                            </div>
                          ))}
                        </div>
                      )}
                      {result.nutritionalAdvice.supplements.length > 0 && (
                        <div className="rounded-xl bg-muted/40 px-4 py-3">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Supplements</p>
                          <p className="text-xs text-foreground/80">{result.nutritionalAdvice.supplements.join(' · ')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Schedule adjustment */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> Schedule adjustment
                  </p>
                  <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-1.5">
                    {result.suggestedShiftDays === 0 ? (
                      <p className="text-xs font-semibold text-green-600 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        No schedule change needed
                      </p>
                    ) : (
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-amber-500" />
                        Shift program back by {result.suggestedShiftDays} day{result.suggestedShiftDays !== 1 ? 's' : ''}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{result.adjustmentRationale}</p>
                  </div>
                </div>

                {/* Recovery timeline */}
                <div className="flex items-center gap-2 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
                  <Clock className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-xs text-foreground/80"><span className="font-semibold">Recovery: </span>{result.recoveryTimeline}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1 rounded-xl text-xs" onClick={onClose}>
                    Got it, keep original
                  </Button>
                  {result.suggestedShiftDays > 0 && (
                    <Button
                      className="flex-1 rounded-xl text-xs"
                      onClick={handleApply}
                      disabled={applying}
                    >
                      {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
                      Apply Adjustment
                    </Button>
                  )}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
