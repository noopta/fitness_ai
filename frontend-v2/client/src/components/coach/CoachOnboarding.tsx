import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronRight, Sparkles, Heart, Target, Dumbbell, Moon, Settings, User } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type AnswerMap = Record<string, string>;

type StepType = 'textarea' | 'choice' | 'text' | 'multiselect' | 'section';

interface Choice { value: string; label: string; desc?: string }

interface Step {
  id: string;
  type: StepType;
  question?: string;
  subtext?: string;
  placeholder?: string;
  optional?: boolean;
  choices?: Choice[];
  // For section dividers
  sectionTitle?: string;
  sectionDesc?: string;
  sectionIcon?: React.ComponentType<{ className?: string }>;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS: Step[] = [
  // ── Section: Goals & Motivation ──────────────────────────────────────────
  {
    id: '_s_goals',
    type: 'section',
    sectionTitle: 'Goals & Motivation',
    sectionDesc: "Let's start with what brought you here and what you're working toward.",
    sectionIcon: Target,
  },
  {
    id: 'primaryGoal',
    type: 'textarea',
    question: 'What is your primary fitness goal right now?',
    subtext: 'Short-term (3–6 months) and long-term (1–2+ years). Be as specific as possible.',
    placeholder: 'e.g. Short-term: add 20 lbs to my bench and drop 8 lbs of fat over the next 4 months. Long-term: compete in my first powerlifting meet within 18 months.',
  },
  {
    id: 'goalWhy',
    type: 'textarea',
    question: 'Why is this goal important to you?',
    subtext: "What will achieving it mean for your life, career, confidence, or family? The more honest you are, the better I can coach you.",
    placeholder: 'e.g. I want to feel strong and confident again after a rough year. My health affects how I show up for my kids.',
  },
  {
    id: 'pastAttempts',
    type: 'textarea',
    question: "What have you tried before, and what worked or didn't?",
    subtext: 'Previous programs, trainers, diets, apps — anything relevant. No judgment.',
    placeholder: 'e.g. Ran Starting Strength for 6 months — made great gains but plateau\'d. Tried keto but couldn\'t sustain it socially.',
    optional: true,
  },
  {
    id: 'commitment',
    type: 'choice',
    question: 'How committed are you to making this happen right now?',
    choices: [
      { value: '10', label: 'All in — 10/10', desc: 'Top priority. I will do whatever it takes.' },
      { value: '8', label: 'Very committed — 8/10', desc: 'High priority but life has other demands too.' },
      { value: '6', label: 'Moderate — 6/10', desc: 'I want this but consistency will be a challenge.' },
      { value: '4', label: 'Testing the waters — 4/10', desc: 'Exploring what\'s possible right now.' },
    ],
  },

  // ── Section: Medical & Health ─────────────────────────────────────────────
  {
    id: '_s_medical',
    type: 'section',
    sectionTitle: 'Health & Medical History',
    sectionDesc: "This helps ensure your program is safe and optimal for your body. All answers stay private.",
    sectionIcon: Heart,
  },
  {
    id: 'medicalConditions',
    type: 'textarea',
    question: 'Any current or past medical conditions, chronic illnesses, or surgeries?',
    subtext: 'Include hypertension, diabetes, heart issues, asthma, thyroid, autoimmune disorders, or anything that affects your training.',
    placeholder: 'e.g. Hypothyroidism (managed with medication). Appendix removed in 2019. No other conditions.',
    optional: true,
  },
  {
    id: 'medications',
    type: 'textarea',
    question: 'Are you currently taking any medications or supplements?',
    subtext: 'Include dosage and reason if comfortable. This helps calibrate recovery, nutrition, and intensity recommendations.',
    placeholder: 'e.g. Levothyroxine 50mcg daily (thyroid). Creatine 5g/day. Fish oil 2g/day.',
    optional: true,
  },
  {
    id: 'injuries',
    type: 'textarea',
    question: 'Any injuries, joint pain, or orthopedic issues — recent or old?',
    subtext: 'Include back/neck problems, concussions, or anything affecting movement and balance.',
    placeholder: 'e.g. Left knee MCL sprain (2022, mostly healed). Chronic lower back tightness. Right shoulder clicking on overhead press.',
    optional: true,
  },
  {
    id: 'hormonal',
    type: 'textarea',
    question: 'Any hormonal, neurological, or reproductive health factors we should know about?',
    subtext: 'Optional — includes menopause, postpartum, PCOS, low T, thyroid, or anything affecting energy and recovery.',
    placeholder: 'e.g. Perimenopausal — dealing with sleep disruption and energy swings.',
    optional: true,
  },

  // ── Section: Training History ─────────────────────────────────────────────
  {
    id: '_s_training',
    type: 'section',
    sectionTitle: 'Training Background',
    sectionDesc: "Understanding where you're coming from helps me meet you exactly where you are.",
    sectionIcon: Dumbbell,
  },
  {
    id: 'trainingAge',
    type: 'choice',
    question: 'How long have you been training consistently?',
    choices: [
      { value: 'beginner', label: 'Under 1 year', desc: 'Still building the foundation' },
      { value: 'intermediate', label: '1–3 years', desc: 'Comfortable with main movements' },
      { value: 'advanced', label: '3–5 years', desc: 'Solid base, optimizing details' },
      { value: 'elite', label: '5+ years', desc: 'Experienced, chasing every marginal gain' },
    ],
  },
  {
    id: 'currentRoutine',
    type: 'textarea',
    question: 'What does your current training look like?',
    subtext: 'Frequency, duration, type of training. Be specific if you can.',
    placeholder: 'e.g. 4 days/week: Mon/Thu upper, Tue/Fri lower. ~60 min sessions. Mostly barbell compound work. No cardio currently.',
    optional: true,
  },
  {
    id: 'strengthLevel',
    type: 'textarea',
    question: 'What are your current working weights on main lifts?',
    subtext: 'Approximate 1RMs or working weights. Skip lifts you don\'t do.',
    placeholder: 'e.g. Bench: 185 lbs × 5. Squat: 225 lbs × 5. Deadlift: 315 lbs × 3. OHP: 115 lbs × 5.',
    optional: true,
  },
  {
    id: 'trainingPreference',
    type: 'choice',
    question: 'What training style fits you best?',
    choices: [
      { value: 'strength', label: 'Strength-focused', desc: 'Heavy compound lifts, low reps, progressive overload' },
      { value: 'hypertrophy', label: 'Muscle building', desc: 'Moderate weight, higher volume, pump-focused' },
      { value: 'athletic', label: 'Athletic / functional', desc: 'Power, speed, sport-specific conditioning' },
      { value: 'mixed', label: 'Balanced mix', desc: 'Strength + aesthetics + conditioning' },
    ],
  },

  // ── Section: Lifestyle ────────────────────────────────────────────────────
  {
    id: '_s_lifestyle',
    type: 'section',
    sectionTitle: 'Lifestyle & Recovery',
    sectionDesc: "Training is only one piece. Recovery and lifestyle drive 50% of your results.",
    sectionIcon: Moon,
  },
  {
    id: 'sleep',
    type: 'choice',
    question: 'How is your sleep — quality and quantity?',
    choices: [
      { value: 'great', label: '7–9 hrs, consistent', desc: 'Wake rested most days' },
      { value: 'ok', label: '6–7 hrs, variable', desc: 'Decent but not optimal' },
      { value: 'poor', label: 'Under 6 hrs or disrupted', desc: 'Consistently tired, poor quality' },
      { value: 'very_poor', label: 'Severely disrupted', desc: 'Insomnia, infant, shift work, etc.' },
    ],
  },
  {
    id: 'stressEnergy',
    type: 'choice',
    question: 'How would you rate your overall stress and energy levels day-to-day?',
    choices: [
      { value: 'low_stress', label: 'Low stress, good energy', desc: 'Feeling recovered most of the time' },
      { value: 'moderate', label: 'Moderate stress', desc: 'Life is busy but manageable' },
      { value: 'high_stress', label: 'High stress, fatigue', desc: 'Running on fumes a lot' },
      { value: 'burnout', label: 'Burnout / very high stress', desc: 'Recovery is a major concern' },
    ],
  },
  {
    id: 'lifestyle',
    type: 'textarea',
    question: 'Walk me through a typical weekday.',
    subtext: 'Wake time, work schedule, when you train, stress sources, and wind-down. The more I know, the better I can fit training into your actual life.',
    placeholder: 'e.g. Up at 6:30am. Desk job, high screen time. Train after work around 6pm. Bed by 11pm but usually on phone till midnight. High-pressure job.',
    optional: true,
  },
  {
    id: 'recoveryPractices',
    type: 'textarea',
    question: 'Any wellness or recovery practices you currently use?',
    subtext: 'Sauna, massage, meditation, cold plunge, therapy — anything that contributes to your recovery.',
    placeholder: 'e.g. Weekly sports massage. Morning 10-min meditation. Sauna 2x/week at the gym.',
    optional: true,
  },

  // ── Section: Preferences & Logistics ─────────────────────────────────────
  {
    id: '_s_prefs',
    type: 'section',
    sectionTitle: 'Preferences & Logistics',
    sectionDesc: "Let's make sure the program actually fits your life.",
    sectionIcon: Settings,
  },
  {
    id: 'daysPerWeek',
    type: 'choice',
    question: 'How many days per week can you realistically train?',
    choices: [
      { value: '3', label: '3 days', desc: 'Full body or upper/lower split' },
      { value: '4', label: '4 days', desc: 'Upper/lower or push/pull/legs' },
      { value: '5', label: '5 days', desc: 'Higher frequency, more volume' },
      { value: '6', label: '6 days', desc: 'High commitment, daily training' },
    ],
  },
  {
    id: 'equipment',
    type: 'choice',
    question: 'What equipment do you train with?',
    choices: [
      { value: 'commercial', label: 'Full commercial gym', desc: 'Barbells, cables, machines — everything available' },
      { value: 'limited', label: 'Limited setup', desc: 'Dumbbells, bands, some machines' },
      { value: 'home', label: 'Home gym', desc: 'Barbell, plates, and basic home equipment' },
    ],
  },
  {
    id: 'accountability',
    type: 'choice',
    question: 'How do you want to track accountability and check-ins?',
    choices: [
      { value: 'app_daily', label: 'Daily app check-ins', desc: 'Log workouts and nutrition every day' },
      { value: 'weekly_review', label: 'Weekly progress reviews', desc: 'Weekly recap and plan adjustments' },
      { value: 'on_demand', label: 'On-demand coaching', desc: 'Ask when I need help, no strict check-ins' },
      { value: 'flexible', label: 'Flexible / whatever works', desc: 'No strong preference' },
    ],
  },

  // ── Section: Body & Aesthetics ────────────────────────────────────────────
  {
    id: '_s_body',
    type: 'section',
    sectionTitle: 'Body Composition & Aesthetics',
    sectionDesc: "Being honest here leads to a much better program. Everything stays between us.",
    sectionIcon: User,
  },
  {
    id: 'bodyStats',
    type: 'textarea',
    question: 'What are your current height, weight, and approximate body fat % if known?',
    subtext: 'Used to calibrate caloric needs, strength standards, and body composition targets.',
    placeholder: "e.g. 5'11\", 195 lbs, ~18% body fat. Or just: 5'8\", 155 lbs — don't know body fat.",
    optional: true,
  },
  {
    id: 'aestheticGoals',
    type: 'textarea',
    question: 'Any specific aesthetic goals or areas you want to prioritize?',
    subtext: 'Leaner midsection, more defined shoulders, better posture, fuller legs — be specific.',
    placeholder: 'e.g. Want a more defined chest and shoulders. Stomach is my main concern. Would love better posture — I sit all day.',
    optional: true,
  },
  {
    id: 'budget',
    type: 'text',
    question: "What's your weekly food budget?",
    subtext: "Optional — used to suggest meals that fit both your nutrition goals and your wallet.",
    placeholder: 'e.g. $80/week or $150/week',
    optional: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseWeightToKg(raw: string): number | null {
  if (!raw.trim()) return null;
  // Try to extract numbers from strings like "5'11\", 195 lbs, ~18%"
  const lbsMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds)/i);
  if (lbsMatch) return Math.round(parseFloat(lbsMatch[1]) / 2.20462 * 10) / 10;
  const kgMatch = raw.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (kgMatch) return parseFloat(kgMatch[1]);
  const num = parseFloat(raw.replace(/[^\d.]/g, ''));
  if (!isNaN(num) && num > 40) return num > 150 ? Math.round(num / 2.20462 * 10) / 10 : num;
  return null;
}

function totalQuestionSteps() {
  return STEPS.filter(s => s.type !== 'section').length;
}

function questionIndex(currentIdx: number): number {
  return STEPS.slice(0, currentIdx + 1).filter(s => s.type !== 'section').length;
}

// ─── Test user preset answers ─────────────────────────────────────────────────

const TEST_EMAIL = 'pro@liftoff.test';

const TEST_PRESET_ANSWERS: AnswerMap = {
  primaryGoal: 'Short-term: add 25 lbs to my bench and hit a 405 lb deadlift within 4 months. Long-term: compete in my first powerlifting meet within 18 months.',
  goalWhy: 'I want to feel genuinely strong again. Hitting big numbers gives me confidence and a sense of control that carries into work and family life.',
  pastAttempts: "Ran Starting Strength for 8 months — made good gains but plateau'd around month 5. Tried a bro split for 3 months — no clear progress.",
  commitment: '8',
  medicalConditions: 'None. Appendix removed 2019, fully recovered.',
  medications: 'Creatine 5g/day, fish oil 2g/day, vitamin D 2000 IU.',
  injuries: 'Mild left knee discomfort on deep squats — manageable with a slight heel elevation. No shoulder issues.',
  hormonal: 'None relevant.',
  trainingAge: 'intermediate',
  currentRoutine: '4 days/week: Mon/Thu upper, Tue/Fri lower. ~60 min sessions. Mostly barbell compound work. No dedicated cardio.',
  strengthLevel: "Bench: 205 lbs × 5. Squat: 275 lbs × 5. Deadlift: 365 lbs × 3. OHP: 135 lbs × 5.",
  trainingPreference: 'strength',
  sleep: 'ok',
  stressEnergy: 'moderate',
  lifestyle: 'Up at 6:30am. Desk job with back-to-back meetings. Train after work around 6:30pm. Bed by 11pm. High-pressure sales role.',
  recoveryPractices: 'Weekly foam rolling. Sauna 1x/week at the gym. No formal massage or meditation.',
  daysPerWeek: '4',
  equipment: 'commercial',
  accountability: 'weekly_review',
  bodyStats: "5'11\", 192 lbs, ~17% body fat.",
  aestheticGoals: 'Leaner midsection, more developed upper chest and shoulders. Better posture from sitting all day.',
  budget: '$100/week',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  userName: string | null;
  userEmail?: string | null;
  existingAnswers?: Partial<AnswerMap>;
  onComplete: (answers: AnswerMap) => void;
}

export function CoachOnboarding({ userName, userEmail, existingAnswers, onComplete }: Props) {
  const isTestUser = userEmail === TEST_EMAIL;
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>(existingAnswers as AnswerMap || {});
  const [currentInput, setCurrentInput] = useState('');
  const [saving, setSaving] = useState(false);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const firstName = userName?.split(' ')[0] || 'there';
  const totalQ = totalQuestionSteps();
  const currentQ = questionIndex(stepIdx);

  // Auto-fill text/textarea inputs for test user when step changes
  const presetValue = isTestUser && step ? TEST_PRESET_ANSWERS[step.id] || '' : '';

  function advance(value: string) {
    const updated = { ...answers, [step.id]: value };
    setAnswers(updated);
    setCurrentInput('');
    if (isLast) {
      submitAll(updated);
    } else {
      setStepIdx(i => i + 1);
    }
  }

  function skip() { advance(''); }

  // For section cards — just advance to next step
  function nextStep() {
    if (isLast) submitAll(answers);
    else setStepIdx(i => i + 1);
  }

  async function submitAll(final: AnswerMap) {
    setSaving(true);
    try {
      // Extract structured fields from answers for legacy profile fields
      const weightKg = parseWeightToKg(final.bodyStats || '');
      const trainingAgeMap: Record<string, string> = {
        beginner: 'beginner', intermediate: 'intermediate',
        advanced: 'advanced', elite: 'advanced',
      };

      await fetch(`${API_BASE}/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trainingAge: trainingAgeMap[final.trainingAge] || final.trainingAge || undefined,
          equipment: final.equipment || undefined,
          weightKg: weightKg || undefined,
          constraintsText: final.injuries || undefined,
          coachGoal: final.primaryGoal,
          coachBudget: final.budget || undefined,
          coachOnboardingDone: true,
          coachProfile: JSON.stringify(final),
        }),
      });
      onComplete(final);
    } catch {
      onComplete(final);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 overflow-y-auto">
      <div className="w-full max-w-lg py-8">
        {/* Fixed top: icon + progress */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-blue-500/20 mx-auto mb-3">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          {stepIdx === 0 && (
            <p className="text-sm text-muted-foreground mb-3">
              Hey {firstName} — I'm your AI coach. This will take about 3 minutes and makes everything dramatically better.
            </p>
          )}
          {/* Progress bar */}
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(currentQ / totalQ) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          {step.type !== 'section' && (
            <p className="text-xs text-muted-foreground mt-1.5">{currentQ} of {totalQ}</p>
          )}
        </motion.div>

        {/* Question/section card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
          >
            {step.type === 'section' ? (
              // Section divider card
              <Card className="p-8 text-center space-y-4">
                {step.sectionIcon && (
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 mx-auto">
                    <step.sectionIcon className="h-6 w-6 text-primary" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold">{step.sectionTitle}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5">{step.sectionDesc}</p>
                </div>
                <Button onClick={nextStep} className="rounded-xl w-full">
                  Let's go <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Card>
            ) : (
              // Question card
              <Card className="p-6 space-y-5">
                <div>
                  <h2 className="text-base font-bold leading-snug">{step.question}</h2>
                  {step.subtext && (
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{step.subtext}</p>
                  )}
                </div>

                {/* Choice */}
                {step.type === 'choice' && step.choices && (
                  <div className="space-y-2">
                    {step.choices.map(c => (
                      <button
                        key={c.value}
                        onClick={() => advance(c.value)}
                        className="w-full text-left rounded-xl border p-3.5 hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">{c.label}</p>
                            {c.desc && <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>}
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </button>
                    ))}
                    {step.optional && (
                      <button onClick={skip} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors">
                        Prefer not to say / Skip
                      </button>
                    )}
                  </div>
                )}

                {/* Textarea */}
                {step.type === 'textarea' && (
                  <div className="space-y-3">
                    <textarea
                      autoFocus
                      key={step.id}
                      value={currentInput || presetValue}
                      onChange={e => setCurrentInput(e.target.value)}
                      onKeyDown={e => {
                        const val = currentInput || presetValue;
                        if (e.key === 'Enter' && e.metaKey && val.trim()) advance(val.trim());
                      }}
                      placeholder={step.placeholder}
                      rows={4}
                      className="w-full resize-none rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/60"
                    />
                    <div className="flex items-center justify-between gap-2">
                      {step.optional && (
                        <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
                          Skip for now
                        </button>
                      )}
                      <Button
                        onClick={() => advance((currentInput || presetValue).trim())}
                        disabled={!(currentInput || presetValue).trim() && !step.optional}
                        className="rounded-xl ml-auto"
                        size="sm"
                      >
                        {isLast && saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ChevronRight className="h-3.5 w-3.5 ml-1" /></>}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Text input */}
                {step.type === 'text' && (
                  <div className="space-y-3">
                    <input
                      autoFocus
                      key={step.id}
                      type="text"
                      value={currentInput || presetValue}
                      onChange={e => setCurrentInput(e.target.value)}
                      onKeyDown={e => {
                        const val = currentInput || presetValue;
                        if (e.key === 'Enter') advance(val.trim());
                      }}
                      placeholder={step.placeholder}
                      className="w-full rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="flex items-center justify-between gap-2">
                      {step.optional && (
                        <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
                          Skip for now
                        </button>
                      )}
                      <Button
                        onClick={() => advance((currentInput || presetValue).trim())}
                        disabled={!(currentInput || presetValue).trim() && !step.optional}
                        className="rounded-xl ml-auto"
                        size="sm"
                      >
                        {isLast && saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ChevronRight className="h-3.5 w-3.5 ml-1" /></>}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Back button */}
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
