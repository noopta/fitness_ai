import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronRight, Sparkles } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface OnboardingAnswers {
  goal: string;
  trainingAge: string;
  equipment: string;
  weightKg: string;
  constraintsText: string;
  budget: string;
}

interface Props {
  userName: string | null;
  existingAnswers?: Partial<OnboardingAnswers>;
  onComplete: (answers: OnboardingAnswers) => void;
}

type Step = {
  id: keyof OnboardingAnswers | '_done';
  question: string;
  subtext?: string;
  type: 'textarea' | 'choice' | 'text';
  choices?: Array<{ value: string; label: string; desc: string }>;
  placeholder?: string;
  optional?: boolean;
};

const STEPS: Step[] = [
  {
    id: 'goal',
    question: 'What is your primary fitness goal right now?',
    subtext: 'Describe it in 1–2 sentences. Be specific — the more detail you give, the better your coaching.',
    type: 'textarea',
    placeholder: 'e.g. I want to build muscle and get stronger on my main lifts. My bench is lagging behind my other lifts.',
  },
  {
    id: 'trainingAge',
    question: 'How long have you been training consistently?',
    type: 'choice',
    choices: [
      { value: 'beginner', label: 'Less than 1 year', desc: 'Still learning the basics' },
      { value: 'intermediate', label: '1–3 years', desc: 'Comfortable with the main lifts' },
      { value: 'advanced', label: '3+ years', desc: 'Experienced, chasing every percentage' },
    ],
  },
  {
    id: 'equipment',
    question: 'What equipment do you train with?',
    type: 'choice',
    choices: [
      { value: 'commercial', label: 'Full commercial gym', desc: 'Barbells, cables, machines — everything' },
      { value: 'limited', label: 'Limited setup', desc: 'Dumbbells, resistance bands, some machines' },
      { value: 'home', label: 'Home gym', desc: 'Barbell and plates, or basic home equipment' },
    ],
  },
  {
    id: 'weightKg',
    question: 'What is your approximate bodyweight?',
    subtext: 'Used to calibrate strength ratios and caloric needs. Optional but recommended.',
    type: 'text',
    placeholder: 'e.g. 185 lbs or 84 kg',
    optional: true,
  },
  {
    id: 'constraintsText',
    question: 'Any injuries, pain, or physical limitations we should know about?',
    subtext: 'Skip if none. This helps us avoid programming movements that could hurt you.',
    type: 'textarea',
    placeholder: 'e.g. Left knee pain on deep squats. Previous shoulder impingement on the right side.',
    optional: true,
  },
  {
    id: 'budget',
    question: 'What is your weekly food budget?',
    subtext: 'Optional. We use this to suggest meals that fit your nutrition goals and your wallet.',
    type: 'text',
    placeholder: 'e.g. $80/week or $150/week',
    optional: true,
  },
];

function parseWeightToKg(raw: string): number | null {
  if (!raw.trim()) return null;
  const num = parseFloat(raw.replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  // If > 150 it's probably lbs
  if (num > 150) return Math.round(num / 2.20462 * 10) / 10;
  return num;
}

export function CoachOnboarding({ userName, existingAnswers, onComplete }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>(existingAnswers || {});
  const [currentInput, setCurrentInput] = useState('');
  const [saving, setSaving] = useState(false);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const firstName = userName?.split(' ')[0] || 'there';

  function advance(value: string) {
    const updated = { ...answers, [step.id]: value };
    setAnswers(updated);
    setCurrentInput('');
    if (isLast) {
      submit(updated as OnboardingAnswers);
    } else {
      setStepIdx(i => i + 1);
    }
  }

  function skip() {
    advance('');
  }

  async function submit(final: OnboardingAnswers) {
    setSaving(true);
    try {
      const weightKg = parseWeightToKg(final.weightKg);
      await fetch(`${API_BASE}/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trainingAge: final.trainingAge || undefined,
          equipment: final.equipment || undefined,
          weightKg: weightKg || undefined,
          constraintsText: final.constraintsText || undefined,
          coachGoal: final.goal,
          coachBudget: final.budget || undefined,
          coachOnboardingDone: true,
        }),
      });
      onComplete(final);
    } catch {
      // Still complete even if save fails
      onComplete(final);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
      <div className="w-full max-w-lg">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-blue-500/20 mx-auto mb-4">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          {stepIdx === 0 && (
            <p className="text-muted-foreground text-sm mb-1">
              Hey {firstName}, I'm your AI coach. Let me ask you a few quick questions.
            </p>
          )}
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i < stepIdx ? 'h-1.5 w-4 bg-primary' :
                  i === stepIdx ? 'h-1.5 w-4 bg-primary' :
                  'h-1.5 w-1.5 bg-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{stepIdx + 1} of {STEPS.length}</p>
        </motion.div>

        {/* Question card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            <Card className="p-6 space-y-5">
              <div>
                <h2 className="text-lg font-bold leading-snug">{step.question}</h2>
                {step.subtext && (
                  <p className="text-sm text-muted-foreground mt-1">{step.subtext}</p>
                )}
              </div>

              {step.type === 'choice' && step.choices && (
                <div className="space-y-2">
                  {step.choices.map(c => (
                    <button
                      key={c.value}
                      onClick={() => advance(c.value)}
                      className="w-full text-left rounded-xl border p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{c.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {step.type === 'textarea' && (
                <div className="space-y-3">
                  <textarea
                    autoFocus
                    value={currentInput}
                    onChange={e => setCurrentInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.metaKey && currentInput.trim()) {
                        advance(currentInput.trim());
                      }
                    }}
                    placeholder={step.placeholder}
                    rows={3}
                    className="w-full resize-none rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="flex items-center justify-between gap-2">
                    {step.optional && (
                      <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Skip for now
                      </button>
                    )}
                    <Button
                      onClick={() => advance(currentInput.trim())}
                      disabled={!currentInput.trim() && !step.optional}
                      className="rounded-xl ml-auto"
                      size="sm"
                    >
                      {isLast && saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>Continue <ChevronRight className="h-3.5 w-3.5 ml-1" /></>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {step.type === 'text' && (
                <div className="space-y-3">
                  <input
                    autoFocus
                    type="text"
                    value={currentInput}
                    onChange={e => setCurrentInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        advance(currentInput.trim());
                      }
                    }}
                    placeholder={step.placeholder}
                    className="w-full rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="flex items-center justify-between gap-2">
                    {step.optional && (
                      <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Skip for now
                      </button>
                    )}
                    <Button
                      onClick={() => advance(currentInput.trim())}
                      disabled={!currentInput.trim() && !step.optional}
                      className="rounded-xl ml-auto"
                      size="sm"
                    >
                      {isLast && saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>Continue <ChevronRight className="h-3.5 w-3.5 ml-1" /></>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        </AnimatePresence>

        {stepIdx > 0 && (
          <button
            onClick={() => setStepIdx(i => i - 1)}
            className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
