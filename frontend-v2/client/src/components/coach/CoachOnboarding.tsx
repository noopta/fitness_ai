import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2, ChevronRight, Sparkles, Heart, Target, Dumbbell,
  Moon, Settings, User, Apple, Shield,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type AnswerMap = Record<string, string>;

type StepType =
  | 'textarea'
  | 'choice'
  | 'text'
  | 'multiselect'
  | 'section'
  | 'body_stats'
  | 'strength_table'
  | 'numeric_unit'
  | 'routine_builder'
  | 'multiselect_notes'
  | 'conditions_list';

interface Choice { value: string; label: string; desc?: string }

interface Step {
  id: string;
  type: StepType;
  question?: string;
  subtext?: string;
  placeholder?: string;
  optional?: boolean;
  unit?: string;
  choices?: Choice[];
  exclusiveValues?: string[];
  sectionTitle?: string;
  sectionDesc?: string;
  sectionIcon?: React.ComponentType<{ className?: string }>;
  sectionCta?: string;
  isFinalSection?: boolean;
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
    placeholder: "e.g. Ran Starting Strength for 6 months — made great gains but plateau'd. Tried keto but couldn't sustain it socially.",
    optional: true,
  },
  {
    id: 'obstacleToConsistency',
    type: 'choice',
    question: "What's been your biggest obstacle to consistency in the past?",
    choices: [
      { value: 'time', label: 'Time & schedule', desc: "Life gets busy and training gets skipped" },
      { value: 'motivation', label: 'Motivation & discipline', desc: "Hard to stay consistent when results feel slow" },
      { value: 'no_right_plan', label: "Didn't have the right plan", desc: "Followed programs that weren't built for my goals" },
      { value: 'injury', label: 'Injury or health setbacks', desc: "Kept getting derailed by physical issues" },
      { value: 'results', label: 'Not seeing results fast enough', desc: "Got discouraged and stopped" },
      { value: 'none', label: "I've been pretty consistent", desc: "Consistency hasn't been the main issue" },
    ],
  },
  {
    id: 'commitment',
    type: 'choice',
    question: 'How committed are you to making this happen right now?',
    choices: [
      { value: '10', label: 'All in — 10/10', desc: 'Top priority. I will do whatever it takes.' },
      { value: '8', label: 'Very committed — 8/10', desc: 'High priority but life has other demands too.' },
      { value: '6', label: 'Moderate — 6/10', desc: 'I want this but consistency will be a challenge.' },
      { value: '4', label: 'Testing the waters — 4/10', desc: "Exploring what's possible right now." },
    ],
  },

  // ── Section: Health & Medical ─────────────────────────────────────────────
  {
    id: '_s_medical',
    type: 'section',
    sectionTitle: 'Health & Medical History',
    sectionDesc: "This helps ensure your program is safe and optimal for your body. All answers stay private.",
    sectionIcon: Heart,
  },
  {
    id: 'gender',
    type: 'choice',
    question: 'What is your biological sex?',
    subtext: 'This calibrates caloric targets, hormone-related recommendations, and nutritional guidance. Males and females have different baseline calorie needs, hormonal profiles, and respond differently to certain vitamins and foods.',
    choices: [
      { value: 'male', label: 'Male', desc: 'Biological male' },
      { value: 'female', label: 'Female', desc: 'Biological female' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say', desc: 'Skip this question' },
    ],
  },
  {
    id: 'parqScreening',
    type: 'multiselect',
    question: 'PAR-Q Safety Screen — check any that apply to you',
    subtext: 'This is the industry-standard Physical Activity Readiness Questionnaire. Check all that apply (or "None of the above" if you\'re clear).',
    choices: [
      { value: 'heart_condition', label: 'Heart condition', desc: 'A doctor has said you have a heart condition and should only exercise under supervision' },
      { value: 'chest_pain', label: 'Chest pain with activity', desc: 'You feel pain in your chest during or after physical activity' },
      { value: 'dizziness', label: 'Dizziness or loss of balance', desc: 'You have lost balance or become dizzy from exertion in the past 12 months' },
      { value: 'joint_bone', label: 'Bone / joint / soft-tissue issues', desc: 'A problem that could be worsened by exercise' },
      { value: 'bp_heart_meds', label: 'Medication for blood pressure or heart', desc: 'A doctor currently prescribes you medication for either condition' },
      { value: 'chronic_condition', label: 'Chronic condition (diabetes, epilepsy, etc.)', desc: 'A diagnosed condition that may affect exercise safety' },
      { value: 'other_concern', label: 'Other concern not listed above', desc: 'Any other reason exercise may not be safe for you right now' },
      { value: 'none', label: "None of the above — I'm PAR-Q clear", desc: 'I am not aware of any health reason to restrict my activity' },
    ],
    exclusiveValues: ['none'],
  },
  {
    id: 'medicalConditions',
    type: 'conditions_list',
    question: 'Any current or past medical conditions, chronic illnesses, or surgeries?',
    subtext: 'Include hypertension, diabetes, heart issues, asthma, thyroid, autoimmune disorders, or anything that affects your training.',
    choices: [
      { value: 'hypertension', label: 'Hypertension / high blood pressure' },
      { value: 'type2_diabetes', label: 'Type 2 diabetes' },
      { value: 'type1_diabetes', label: 'Type 1 diabetes' },
      { value: 'heart_condition', label: 'Heart condition' },
      { value: 'asthma', label: 'Asthma' },
      { value: 'hypothyroidism', label: 'Hypothyroidism' },
      { value: 'hyperthyroidism', label: 'Hyperthyroidism' },
      { value: 'arthritis', label: 'Arthritis / joint degeneration' },
      { value: 'osteoporosis', label: 'Osteoporosis / low bone density' },
      { value: 'sleep_apnea', label: 'Sleep apnea' },
      { value: 'chronic_fatigue', label: 'Chronic fatigue / fibromyalgia' },
      { value: 'anxiety_depression', label: 'Anxiety / depression' },
      { value: 'none', label: 'None of the above' },
    ],
    exclusiveValues: ['none'],
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
    subtext: 'Include back/neck problems, concussions, or anything affecting movement.',
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
    type: 'routine_builder',
    question: 'What does your current training look like?',
    subtext: 'Frequency, duration, type of training. Be specific if you can.',
    optional: true,
  },
  {
    id: 'strengthLevel',
    type: 'strength_table',
    question: 'What are your current working weights on main lifts?',
    subtext: "Approximate 1RMs or working weights. Skip lifts you don't do.",
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

  // ── Section: Nutrition ────────────────────────────────────────────────────
  {
    id: '_s_nutrition',
    type: 'section',
    sectionTitle: 'Nutrition Baseline',
    sectionDesc: "Nutrition drives 40–60% of body composition outcomes. A few quick questions help me tailor your plan.",
    sectionIcon: Apple,
  },
  {
    id: 'dietaryRestrictions',
    type: 'multiselect',
    question: 'Any dietary restrictions or preferences?',
    subtext: 'Select all that apply.',
    choices: [
      { value: 'none', label: 'None / No restrictions', desc: 'I eat everything' },
      { value: 'vegetarian', label: 'Vegetarian', desc: 'No meat' },
      { value: 'vegan', label: 'Vegan', desc: 'No animal products' },
      { value: 'gluten_free', label: 'Gluten-free', desc: 'Celiac or gluten sensitivity' },
      { value: 'dairy_free', label: 'Dairy-free', desc: 'Lactose intolerance or preference' },
      { value: 'halal_kosher', label: 'Halal / Kosher', desc: 'Religious dietary requirements' },
      { value: 'allergies', label: 'Food allergies', desc: 'Nuts, shellfish, or other allergies' },
    ],
    exclusiveValues: ['none'],
    optional: true,
  },
  {
    id: 'nutritionQuality',
    type: 'choice',
    question: 'How would you rate your current nutrition?',
    choices: [
      { value: 'poor', label: 'Poor', desc: 'Mostly processed food, irregular meals' },
      { value: 'inconsistent', label: 'Inconsistent', desc: 'Good days and bad days — no real structure' },
      { value: 'decent', label: 'Decent', desc: 'Generally healthy, room for improvement' },
      { value: 'solid', label: 'Solid', desc: 'Track macros or meal prep regularly' },
      { value: 'optimized', label: 'Optimized', desc: 'Dialed in — I know exactly what I eat' },
    ],
  },
  {
    id: 'proteinIntake',
    type: 'numeric_unit',
    question: 'Approximate daily protein intake, if you know it?',
    subtext: 'Optional — helps calibrate nutrition recommendations.',
    unit: 'g / day',
    optional: true,
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
    id: 'activityLevel',
    type: 'choice',
    question: 'What is your daily activity level outside of training?',
    subtext: 'This affects calorie burn (NEAT) and recovery capacity.',
    choices: [
      { value: 'sedentary', label: 'Sedentary', desc: 'Desk job, mostly sitting 8+ hours/day' },
      { value: 'light', label: 'Lightly active', desc: 'Mix of sitting and moving — some walking' },
      { value: 'moderate', label: 'Moderately active', desc: 'On my feet a fair amount — retail, teaching, etc.' },
      { value: 'very_active', label: 'Very active / manual labor', desc: 'Physically demanding job or high daily movement' },
    ],
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
    type: 'multiselect_notes',
    question: 'Any wellness or recovery practices you currently use?',
    subtext: 'Sauna, massage, meditation, cold plunge, therapy — anything that contributes to your recovery.',
    choices: [
      { value: 'sauna', label: 'Sauna' },
      { value: 'cold_plunge', label: 'Cold plunge / ice bath' },
      { value: 'massage', label: 'Massage / soft tissue' },
      { value: 'foam_rolling', label: 'Foam rolling / stretching' },
      { value: 'meditation', label: 'Meditation / breathwork' },
      { value: 'yoga', label: 'Yoga / mobility work' },
      { value: 'none', label: 'None currently' },
    ],
    exclusiveValues: ['none'],
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
    type: 'body_stats',
    question: 'What are your current height, weight, and approximate body fat % if known?',
    subtext: 'Used to calibrate caloric needs, strength standards, and body composition targets.',
    optional: true,
  },
  {
    id: 'aestheticGoals',
    type: 'multiselect_notes',
    question: 'Any specific aesthetic goals or areas you want to prioritize?',
    subtext: 'Leaner midsection, more defined shoulders, better posture, fuller legs — be specific.',
    choices: [
      { value: 'chest', label: 'Chest' },
      { value: 'shoulders', label: 'Shoulders' },
      { value: 'arms', label: 'Arms / biceps / triceps' },
      { value: 'back', label: 'Back / lats' },
      { value: 'core', label: 'Core / midsection' },
      { value: 'legs', label: 'Legs / quads / hams' },
      { value: 'glutes', label: 'Glutes' },
      { value: 'posture', label: 'Posture improvement' },
      { value: 'overall_leanness', label: 'Overall leanness' },
    ],
    optional: true,
  },
  {
    id: 'budget',
    type: 'numeric_unit',
    question: "What's your weekly food budget?",
    subtext: "Optional — used to suggest meals that fit both your nutrition goals and your wallet.",
    unit: '$ / week',
    optional: true,
  },

  // ── Section: Consent & Disclaimer ────────────────────────────────────────
  {
    id: '_s_consent',
    type: 'section',
    sectionTitle: "You're all set.",
    sectionDesc: "Axiom provides AI-generated fitness guidance for informational and coaching purposes only — not medical advice. If you flagged any health concerns above, please consult a physician before beginning a new exercise program. Your data is kept private and never sold.",
    sectionIcon: Shield,
    sectionCta: "I understand — Build My Profile →",
    isFinalSection: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalQuestionSteps() {
  return STEPS.filter(s => s.type !== 'section').length;
}

function questionIndex(currentIdx: number): number {
  return STEPS.slice(0, currentIdx + 1).filter(s => s.type !== 'section').length;
}

// ─── Sub-components for new step types ───────────────────────────────────────

interface BodyStatsState {
  heightFt: string;
  heightIn: string;
  weightLbs: string;
  bodyFatPct: string;
}

function BodyStatsInput({
  onAdvance,
  onSkip,
  optional,
}: {
  onAdvance: (val: string) => void;
  onSkip: () => void;
  optional?: boolean;
}) {
  const [state, setState] = useState<BodyStatsState>({
    heightFt: '',
    heightIn: '',
    weightLbs: '',
    bodyFatPct: '',
  });

  function handleAdvance() {
    const ft = parseFloat(state.heightFt);
    const inches = parseFloat(state.heightIn);
    const lbs = parseFloat(state.weightLbs);
    const bf = parseFloat(state.bodyFatPct);

    const obj: Record<string, number> = {};
    if (!isNaN(ft)) obj.heightFt = ft;
    if (!isNaN(inches)) obj.heightIn = inches;
    if (!isNaN(lbs)) obj.weightLbs = lbs;
    if (!isNaN(bf) && state.bodyFatPct.trim() !== '') obj.bodyFatPct = bf;

    onAdvance(JSON.stringify(obj));
  }

  const hasAnyValue =
    state.heightFt.trim() !== '' ||
    state.heightIn.trim() !== '' ||
    state.weightLbs.trim() !== '';

  return (
    <div className="space-y-4">
      {/* Height */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Height</label>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 flex-1">
            <input
              type="number"
              min={4}
              max={7}
              step={1}
              value={state.heightFt}
              onChange={e => setState(s => ({ ...s, heightFt: e.target.value }))}
              placeholder="5"
              className="w-full rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
            />
            <span className="text-sm text-muted-foreground shrink-0">ft</span>
          </div>
          <div className="flex items-center gap-1.5 flex-1">
            <input
              type="number"
              min={0}
              max={11}
              step={1}
              value={state.heightIn}
              onChange={e => setState(s => ({ ...s, heightIn: e.target.value }))}
              placeholder="11"
              className="w-full rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
            />
            <span className="text-sm text-muted-foreground shrink-0">in</span>
          </div>
        </div>
      </div>

      {/* Weight */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Weight</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={50}
            max={600}
            step={1}
            value={state.weightLbs}
            onChange={e => setState(s => ({ ...s, weightLbs: e.target.value }))}
            placeholder="195"
            className="flex-1 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
          />
          <span className="text-sm text-muted-foreground shrink-0">lbs</span>
        </div>
      </div>

      {/* Body fat */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Body fat % <span className="text-muted-foreground/60 normal-case font-normal">(optional)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={3}
            max={60}
            step={1}
            value={state.bodyFatPct}
            onChange={e => setState(s => ({ ...s, bodyFatPct: e.target.value }))}
            placeholder="18"
            className="flex-1 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
          />
          <span className="text-sm text-muted-foreground shrink-0">%</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {optional && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Skip for now
          </button>
        )}
        <Button
          onClick={handleAdvance}
          disabled={!hasAnyValue && !optional}
          className="rounded-xl ml-auto"
          size="sm"
        >
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

const STRENGTH_LIFTS = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Barbell Row'];

interface StrengthRow {
  weightLbs: string;
  sets: string;
  reps: string;
}

function StrengthTableInput({
  onAdvance,
  onSkip,
  optional,
}: {
  onAdvance: (val: string) => void;
  onSkip: () => void;
  optional?: boolean;
}) {
  const [rows, setRows] = useState<Record<string, StrengthRow>>(
    Object.fromEntries(STRENGTH_LIFTS.map(l => [l, { weightLbs: '', sets: '', reps: '' }]))
  );

  function updateRow(lift: string, field: keyof StrengthRow, value: string) {
    setRows(prev => ({ ...prev, [lift]: { ...prev[lift], [field]: value } }));
  }

  function handleAdvance() {
    const filled = STRENGTH_LIFTS
      .filter(l => rows[l].weightLbs.trim() !== '')
      .map(l => {
        const r = rows[l];
        const entry: Record<string, unknown> = { lift: l, weightLbs: parseFloat(r.weightLbs) };
        if (r.sets.trim()) entry.sets = parseInt(r.sets, 10);
        if (r.reps.trim()) entry.reps = parseInt(r.reps, 10);
        return entry;
      });
    onAdvance(JSON.stringify(filled));
  }

  const hasAnyValue = STRENGTH_LIFTS.some(l => rows[l].weightLbs.trim() !== '');

  return (
    <div className="space-y-3">
      <div className="rounded-xl border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_56px_56px] gap-2 px-3 py-2 bg-muted/50 border-b">
          <span className="text-xs font-medium text-muted-foreground">Lift</span>
          <span className="text-xs font-medium text-muted-foreground text-center">Weight (lbs)</span>
          <span className="text-xs font-medium text-muted-foreground text-center">Sets</span>
          <span className="text-xs font-medium text-muted-foreground text-center">Reps</span>
        </div>
        {/* Rows */}
        {STRENGTH_LIFTS.map((lift, i) => (
          <div
            key={lift}
            className={`grid grid-cols-[1fr_80px_56px_56px] gap-2 px-3 py-2 items-center ${
              i < STRENGTH_LIFTS.length - 1 ? 'border-b' : ''
            }`}
          >
            <span className="text-sm font-medium truncate">{lift}</span>
            <input
              type="number"
              min={0}
              max={2000}
              step={5}
              value={rows[lift].weightLbs}
              onChange={e => updateRow(lift, 'weightLbs', e.target.value)}
              placeholder="—"
              className="w-full rounded-lg border bg-muted/30 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
            />
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={rows[lift].sets}
              onChange={e => updateRow(lift, 'sets', e.target.value)}
              placeholder="—"
              className="w-full rounded-lg border bg-muted/30 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
            />
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={rows[lift].reps}
              onChange={e => updateRow(lift, 'reps', e.target.value)}
              placeholder="—"
              className="w-full rounded-lg border bg-muted/30 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">All rows optional — leave blank for lifts you don't do.</p>
      <div className="flex items-center justify-between gap-2">
        {optional && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Skip for now
          </button>
        )}
        <Button
          onClick={handleAdvance}
          disabled={!hasAnyValue && !optional}
          className="rounded-xl ml-auto"
          size="sm"
        >
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function NumericUnitInput({
  unit,
  stepId,
  optional,
  onAdvance,
  onSkip,
  isBudget,
}: {
  unit?: string;
  stepId: string;
  optional?: boolean;
  onAdvance: (val: string) => void;
  onSkip: () => void;
  isBudget?: boolean;
}) {
  const [value, setValue] = useState('');

  function handleAdvance() {
    if (isBudget) {
      onAdvance(`$${value}/week`);
    } else {
      onAdvance(value.trim());
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {isBudget && (
          <span className="text-sm font-medium text-muted-foreground shrink-0">$</span>
        )}
        <input
          autoFocus
          key={stepId}
          type="number"
          min={0}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && value.trim()) handleAdvance();
          }}
          placeholder="0"
          className="flex-1 rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {unit && (
          <span className="text-sm text-muted-foreground shrink-0 whitespace-nowrap">{unit}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        {optional && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Skip for now
          </button>
        )}
        <Button
          onClick={handleAdvance}
          disabled={!value.trim() && !optional}
          className="rounded-xl ml-auto"
          size="sm"
        >
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

const TRAINING_TYPES = ['Barbell', 'Dumbbells', 'Machines', 'Cables', 'Bodyweight', 'Cardio', 'HIIT'];
const SESSION_DURATIONS = [30, 45, 60, 75, 90, 120];

function RoutineBuilderInput({
  onAdvance,
  onSkip,
  optional,
}: {
  onAdvance: (val: string) => void;
  onSkip: () => void;
  optional?: boolean;
}) {
  const [daysPerWeek, setDaysPerWeek] = useState<number | null>(null);
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null);
  const [types, setTypes] = useState<string[]>([]);

  function toggleType(t: string) {
    setTypes(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  }

  function handleAdvance() {
    const obj: Record<string, unknown> = {};
    if (daysPerWeek !== null) obj.daysPerWeek = daysPerWeek;
    if (sessionMinutes !== null) obj.sessionMinutes = sessionMinutes;
    if (types.length > 0) obj.types = types;
    onAdvance(JSON.stringify(obj));
  }

  const hasAnyValue = daysPerWeek !== null || sessionMinutes !== null || types.length > 0;

  return (
    <div className="space-y-5">
      {/* Days/week */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Days per week</label>
        <div className="flex gap-1.5 flex-wrap">
          {[1, 2, 3, 4, 5, 6, 7].map(d => (
            <button
              key={d}
              onClick={() => setDaysPerWeek(d === daysPerWeek ? null : d)}
              className={`h-9 w-9 rounded-lg text-sm font-medium border transition-colors ${
                daysPerWeek === d
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/30 border-border hover:border-primary/40 hover:bg-muted/60'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Session duration */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Session duration</label>
        <select
          value={sessionMinutes ?? ''}
          onChange={e => setSessionMinutes(e.target.value ? parseInt(e.target.value, 10) : null)}
          className="w-full rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Select duration…</option>
          {SESSION_DURATIONS.map(m => (
            <option key={m} value={m}>{m} minutes</option>
          ))}
        </select>
      </div>

      {/* Training type */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Training type</label>
        <div className="flex flex-wrap gap-2">
          {TRAINING_TYPES.map(t => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                types.includes(t)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/30 border-border hover:border-primary/40 hover:bg-muted/60'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {optional && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Skip for now
          </button>
        )}
        <Button
          onClick={handleAdvance}
          disabled={!hasAnyValue && !optional}
          className="rounded-xl ml-auto"
          size="sm"
        >
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function MultiSelectNotesInput({
  step,
  onAdvance,
  onSkip,
}: {
  step: Step;
  onAdvance: (val: string) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  function toggleItem(value: string) {
    const isExclusive = step.exclusiveValues?.includes(value);
    setSelected(prev => {
      if (isExclusive) {
        return prev.includes(value) ? [] : [value];
      } else {
        const withoutExclusive = prev.filter(v => !step.exclusiveValues?.includes(v));
        return withoutExclusive.includes(value)
          ? withoutExclusive.filter(v => v !== value)
          : [...withoutExclusive, value];
      }
    });
  }

  function handleAdvance() {
    const parts: string[] = [];
    if (selected.length > 0) parts.push(selected.join(', '));
    if (notes.trim()) parts.push(notes.trim());
    onAdvance(parts.join('; '));
  }

  const hasAnyValue = selected.length > 0 || notes.trim() !== '';

  return (
    <div className="space-y-4">
      {/* Chip grid */}
      <div className="flex flex-wrap gap-2">
        {(step.choices || []).map(c => (
          <button
            key={c.value}
            onClick={() => toggleItem(c.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              selected.includes(c.value)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/30 border-border hover:border-primary/40 hover:bg-muted/60'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Optional notes textarea */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Any other notes?"
        rows={2}
        className="w-full resize-none rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/60"
      />

      <div className="flex items-center justify-between gap-2">
        {step.optional && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Skip for now
          </button>
        )}
        <Button
          onClick={handleAdvance}
          disabled={!hasAnyValue && !step.optional}
          className="rounded-xl ml-auto"
          size="sm"
        >
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function ConditionsListInput({
  step,
  onAdvance,
  onSkip,
}: {
  step: Step;
  onAdvance: (val: string) => void;
  onSkip: () => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');

  function toggleItem(value: string) {
    const isExclusive = step.exclusiveValues?.includes(value);
    setChecked(prev => {
      if (isExclusive) {
        return prev.includes(value) ? [] : [value];
      } else {
        const withoutExclusive = prev.filter(v => !step.exclusiveValues?.includes(v));
        return withoutExclusive.includes(value)
          ? withoutExclusive.filter(v => v !== value)
          : [...withoutExclusive, value];
      }
    });
  }

  function handleAdvance() {
    const checkedLabels = (step.choices || [])
      .filter(c => checked.includes(c.value))
      .map(c => c.label);
    const parts: string[] = [];
    if (checkedLabels.length > 0) parts.push(checkedLabels.join(', '));
    if (otherText.trim()) parts.push(`Other: ${otherText.trim()}`);
    onAdvance(parts.join('; '));
  }

  const hasAnyValue = checked.length > 0 || otherText.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(step.choices || []).map(c => {
          const isChecked = checked.includes(c.value);
          return (
            <button
              key={c.value}
              onClick={() => toggleItem(c.value)}
              className={`w-full text-left rounded-xl border p-3 transition-colors ${
                isChecked
                  ? 'border-primary bg-primary/8 text-foreground'
                  : 'border-border hover:border-primary/40 hover:bg-muted/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
                  isChecked ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`}>
                  {isChecked && (
                    <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-sm font-medium">{c.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Other conditions textarea */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Other conditions</label>
        <textarea
          value={otherText}
          onChange={e => setOtherText(e.target.value)}
          placeholder="Any other conditions, surgeries, or health history…"
          rows={2}
          className="w-full resize-none rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/60"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        {step.optional && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Skip for now
          </button>
        )}
        <Button
          onClick={handleAdvance}
          disabled={!hasAnyValue && !step.optional}
          className="rounded-xl ml-auto"
          size="sm"
        >
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  userName: string | null;
  onComplete: (answers: AnswerMap) => void;
}

export function CoachOnboarding({ userName, onComplete }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentInput, setCurrentInput] = useState('');
  const [currentMultiSelect, setCurrentMultiSelect] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const firstName = userName?.split(' ')[0] || 'there';
  const totalQ = totalQuestionSteps();
  const currentQ = questionIndex(stepIdx);

  // Reset multi-select and text state when step changes
  useEffect(() => {
    setCurrentMultiSelect([]);
    setCurrentInput('');
  }, [stepIdx]);

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

  function nextStep() {
    if (step.isFinalSection) {
      submitAll(answers);
    } else if (isLast) {
      submitAll(answers);
    } else {
      setStepIdx(i => i + 1);
    }
  }

  function toggleMultiSelect(value: string) {
    const isExclusive = step.exclusiveValues?.includes(value);
    setCurrentMultiSelect(prev => {
      if (isExclusive) {
        return prev.includes(value) ? [] : [value];
      } else {
        const withoutExclusive = prev.filter(v => !step.exclusiveValues?.includes(v));
        return withoutExclusive.includes(value)
          ? withoutExclusive.filter(v => v !== value)
          : [...withoutExclusive, value];
      }
    });
  }

  function advanceMultiSelect() {
    advance(currentMultiSelect.join(', ') || '');
  }

  async function submitAll(final: AnswerMap) {
    setSaving(true);
    try {
      let weightKg: number | undefined;
      let heightCm: number | undefined;
      try {
        const bs = JSON.parse(final.bodyStats || '{}');
        if (bs.weightLbs) weightKg = Math.round(bs.weightLbs / 2.20462 * 10) / 10;
        if (bs.heightFt !== undefined && bs.heightIn !== undefined) {
          heightCm = Math.round((bs.heightFt * 12 + bs.heightIn) * 2.54 * 10) / 10;
        }
      } catch { /* ignore */ }

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
          heightCm: heightCm || undefined,
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
      <div className="w-full max-w-lg py-8 pb-24 sm:pb-8">
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
              Hey {firstName} — I'm Anakin, your AI coach. This will take about 4 minutes and makes everything dramatically better.
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
              <Card className="p-8 text-center space-y-4">
                {step.sectionIcon && (
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 mx-auto">
                    <step.sectionIcon className="h-6 w-6 text-primary" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold">{step.sectionTitle}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{step.sectionDesc}</p>
                </div>
                {step.isFinalSection ? (
                  <Button onClick={nextStep} disabled={saving} className="rounded-xl w-full">
                    {saving
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving your profile…</>
                      : step.sectionCta || 'Complete Intake'}
                  </Button>
                ) : (
                  <Button onClick={nextStep} className="rounded-xl w-full">
                    {step.sectionCta || <>Let's go <ChevronRight className="h-4 w-4 ml-1" /></>}
                  </Button>
                )}
              </Card>
            ) : (
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

                {/* Multiselect */}
                {step.type === 'multiselect' && step.choices && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {step.choices.map(c => {
                        const selected = currentMultiSelect.includes(c.value);
                        return (
                          <button
                            key={c.value}
                            onClick={() => toggleMultiSelect(c.value)}
                            className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                              selected
                                ? 'border-primary bg-primary/8 text-foreground'
                                : 'border-border hover:border-primary/40 hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
                                selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                              }`}>
                                {selected && (
                                  <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                                    <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm">{c.label}</p>
                                {c.desc && <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {step.optional && (
                        <button onClick={skip} className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
                          Skip for now
                        </button>
                      )}
                      <Button
                        onClick={advanceMultiSelect}
                        disabled={currentMultiSelect.length === 0 && !step.optional}
                        className="rounded-xl ml-auto"
                        size="sm"
                      >
                        Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Textarea */}
                {step.type === 'textarea' && (
                  <div className="space-y-3">
                    <textarea
                      autoFocus
                      key={step.id}
                      value={currentInput}
                      onChange={e => setCurrentInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.metaKey && currentInput.trim()) advance(currentInput.trim());
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
                        onClick={() => advance(currentInput.trim())}
                        disabled={!currentInput.trim() && !step.optional}
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
                      value={currentInput}
                      onChange={e => setCurrentInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') advance(currentInput.trim());
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
                        onClick={() => advance(currentInput.trim())}
                        disabled={!currentInput.trim() && !step.optional}
                        className="rounded-xl ml-auto"
                        size="sm"
                      >
                        {isLast && saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ChevronRight className="h-3.5 w-3.5 ml-1" /></>}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Body stats */}
                {step.type === 'body_stats' && (
                  <BodyStatsInput
                    onAdvance={advance}
                    onSkip={skip}
                    optional={step.optional}
                  />
                )}

                {/* Strength table */}
                {step.type === 'strength_table' && (
                  <StrengthTableInput
                    onAdvance={advance}
                    onSkip={skip}
                    optional={step.optional}
                  />
                )}

                {/* Numeric unit */}
                {step.type === 'numeric_unit' && (
                  <NumericUnitInput
                    unit={step.unit}
                    stepId={step.id}
                    optional={step.optional}
                    onAdvance={advance}
                    onSkip={skip}
                    isBudget={step.id === 'budget'}
                  />
                )}

                {/* Routine builder */}
                {step.type === 'routine_builder' && (
                  <RoutineBuilderInput
                    onAdvance={advance}
                    onSkip={skip}
                    optional={step.optional}
                  />
                )}

                {/* Multiselect with notes */}
                {step.type === 'multiselect_notes' && (
                  <MultiSelectNotesInput
                    step={step}
                    onAdvance={advance}
                    onSkip={skip}
                  />
                )}

                {/* Conditions list */}
                {step.type === 'conditions_list' && (
                  <ConditionsListInput
                    step={step}
                    onAdvance={advance}
                    onSkip={skip}
                  />
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
            Back
          </button>
        )}
      </div>
    </div>
  );
}
