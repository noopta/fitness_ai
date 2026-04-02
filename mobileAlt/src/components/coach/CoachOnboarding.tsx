import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Button } from '../ui/Button';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingProfile {
  // Section 1 – Goals
  primaryGoal: string;
  goalWhy: string;
  pastAttempts: string;
  obstacle: string;
  commitment: string;
  // Section 2 – Health
  biologicalSex: string;
  parq: string[];
  medicalConditions: string[];
  medicalNotes: string;
  medications: string;
  injuries: string;
  hormonalHealth: string;
  // Section 3 – Training
  trainingAge: string;
  trainingDays: number;
  sessionDuration: string;
  trainingTypes: string[];
  benchWeight: string; benchSets: string; benchReps: string;
  squatWeight: string; squatSets: string; squatReps: string;
  deadliftWeight: string; deadliftSets: string; deadliftReps: string;
  ohpWeight: string; ohpSets: string; ohpReps: string;
  rowWeight: string; rowSets: string; rowReps: string;
  trainingStyle: string;
  // Section 4 – Nutrition
  dietaryRestrictions: string[];
  nutritionQuality: string;
  dailyProtein: string;
  // Section 5 – Lifestyle
  activityLevel: string;
  sleepQuality: string;
  stressEnergy: string;
  typicalWeekday: string;
  recoveryPractices: string[];
  recoveryNotes: string;
  // Section 6 – Preferences
  daysPerWeek: string;
  equipment: string;
  accountability: string;
  // Section 7 – Body Composition
  heightFt: string;
  heightIn: string;
  weightLbs: string;
  bodyFat: string;
  aestheticGoals: string[];
  aestheticNotes: string;
  weeklyBudget: string;
}

const EMPTY: OnboardingProfile = {
  primaryGoal: '', goalWhy: '', pastAttempts: '', obstacle: '', commitment: '',
  biologicalSex: '', parq: [], medicalConditions: [], medicalNotes: '', medications: '',
  injuries: '', hormonalHealth: '',
  trainingAge: '', trainingDays: 4, sessionDuration: '', trainingTypes: [],
  benchWeight: '', benchSets: '', benchReps: '',
  squatWeight: '', squatSets: '', squatReps: '',
  deadliftWeight: '', deadliftSets: '', deadliftReps: '',
  ohpWeight: '', ohpSets: '', ohpReps: '',
  rowWeight: '', rowSets: '', rowReps: '',
  trainingStyle: '',
  dietaryRestrictions: [], nutritionQuality: '', dailyProtein: '',
  activityLevel: '', sleepQuality: '', stressEnergy: '', typicalWeekday: '',
  recoveryPractices: [], recoveryNotes: '',
  daysPerWeek: '', equipment: '', accountability: '',
  heightFt: '', heightIn: '', weightLbs: '', bodyFat: '',
  aestheticGoals: [], aestheticNotes: '', weeklyBudget: '',
};

interface CoachOnboardingProps {
  onComplete: (profile: OnboardingProfile) => void;
}

const TOTAL_STEPS = 8;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toggleExclusive(arr: string[], val: string, exclusive: string): string[] {
  if (val === exclusive) return arr.includes(exclusive) ? [] : [exclusive];
  const without = arr.filter(v => v !== exclusive && v !== val);
  return arr.includes(val) ? without : [...without, val];
}

function toggleSimple(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={s.sectionHeading}>
      <Text style={s.sectionTitle}>{title}</Text>
      {sub ? <Text style={s.sectionSub}>{sub}</Text> : null}
    </View>
  );
}

function QLabel({ text, optional }: { text: string; optional?: boolean }) {
  return (
    <View style={s.qLabelRow}>
      <Text style={s.qLabel}>{text}</Text>
      {optional && <Text style={s.qOptional}>optional</Text>}
    </View>
  );
}

function SingleSelect<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.optionList}>
      {options.map(opt => {
        const sel = value === opt.value;
        return (
          <Pressable key={opt.value} onPress={() => onChange(opt.value)}
            style={[s.optionCard, sel && s.optionCardSel]}>
            <View style={[s.radio, sel && s.radioSel]}>
              {sel && <View style={s.radioInner} />}
            </View>
            <View style={s.optionTextWrap}>
              <Text style={[s.optionLabel, sel && s.optionLabelSel]}>{opt.label}</Text>
              {opt.sub ? <Text style={s.optionSub}>{opt.sub}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MultiSelect({
  options, values, onChange, exclusive,
}: {
  options: { value: string; label: string; sub?: string }[];
  values: string[];
  onChange: (v: string[]) => void;
  exclusive?: string;
}) {
  return (
    <View style={s.optionList}>
      {options.map(opt => {
        const sel = values.includes(opt.value);
        return (
          <Pressable key={opt.value}
            onPress={() => onChange(
              exclusive
                ? toggleExclusive(values, opt.value, exclusive)
                : toggleSimple(values, opt.value)
            )}
            style={[s.optionCard, sel && s.optionCardSel]}>
            <View style={[s.checkbox, sel && s.checkboxSel]}>
              {sel && <Text style={s.checkmark}>✓</Text>}
            </View>
            <View style={s.optionTextWrap}>
              <Text style={[s.optionLabel, sel && s.optionLabelSel]}>{opt.label}</Text>
              {opt.sub ? <Text style={s.optionSub}>{opt.sub}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function TA({
  value, onChange, placeholder, height,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; height?: number;
}) {
  return (
    <TextInput
      style={[s.textArea, height ? { minHeight: height } : null]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      multiline
      textAlignVertical="top"
    />
  );
}

function NumInput({ value, onChange, placeholder, unit }: {
  value: string; onChange: (v: string) => void; placeholder?: string; unit?: string;
}) {
  return (
    <View style={s.numRow}>
      <TextInput
        style={[s.textInput, { flex: 1 }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? '0'}
        placeholderTextColor={colors.mutedForeground}
        keyboardType="numeric"
      />
      {unit ? <Text style={s.unit}>{unit}</Text> : null}
    </View>
  );
}

// ── Option constants ──────────────────────────────────────────────────────────

const OBSTACLES = [
  { value: 'time', label: 'Time & schedule', sub: 'Life gets busy and training gets skipped' },
  { value: 'motivation', label: 'Motivation & discipline', sub: 'Hard to stay consistent when results feel slow' },
  { value: 'no_plan', label: "Didn't have the right plan", sub: "Followed programs that weren't built for my goals" },
  { value: 'injury', label: 'Injury or health setbacks', sub: 'Kept getting derailed by physical issues' },
  { value: 'no_results', label: 'Not seeing results fast enough', sub: 'Got discouraged and stopped' },
  { value: 'consistent', label: "I've been pretty consistent", sub: "Consistency hasn't been the main issue" },
];

const COMMITMENTS = [
  { value: '10', label: 'All in — 10/10', sub: 'Top priority. I will do whatever it takes.' },
  { value: '8', label: 'Very committed — 8/10', sub: 'High priority but life has other demands too.' },
  { value: '6', label: 'Moderate — 6/10', sub: 'I want this but consistency will be a challenge.' },
  { value: '4', label: 'Testing the waters — 4/10', sub: 'Exploring what\'s possible right now.' },
];

const SEXES = [
  { value: 'male', label: 'Male', sub: 'Biological male' },
  { value: 'female', label: 'Female', sub: 'Biological female' },
  { value: 'prefer_not', label: 'Prefer not to say', sub: 'Skip this question' },
];

const PARQ_OPTIONS = [
  { value: 'heart', label: 'Heart condition', sub: 'A doctor has said you have a heart condition and should only exercise under supervision' },
  { value: 'chest_pain', label: 'Chest pain with activity', sub: 'You feel pain in your chest during or after physical activity' },
  { value: 'dizziness', label: 'Dizziness or loss of balance', sub: 'You have lost balance or become dizzy from exertion in the past 12 months' },
  { value: 'joint', label: 'Bone / joint / soft-tissue issues', sub: 'A problem that could be worsened by exercise' },
  { value: 'bp_meds', label: 'Medication for blood pressure or heart', sub: 'A doctor currently prescribes you medication for either condition' },
  { value: 'chronic', label: 'Chronic condition (diabetes, epilepsy, etc.)', sub: 'A diagnosed condition that may affect exercise safety' },
  { value: 'other', label: 'Other concern not listed above', sub: 'Any other reason exercise may not be safe for you right now' },
  { value: 'none', label: 'None of the above — I\'m PAR-Q clear', sub: 'I am not aware of any health reason to restrict my activity' },
];

const MEDICAL_CONDITIONS = [
  { value: 'hypertension', label: 'Hypertension / high blood pressure' },
  { value: 't2_diabetes', label: 'Type 2 diabetes' },
  { value: 't1_diabetes', label: 'Type 1 diabetes' },
  { value: 'heart', label: 'Heart condition' },
  { value: 'asthma', label: 'Asthma' },
  { value: 'hypothyroid', label: 'Hypothyroidism' },
  { value: 'hyperthyroid', label: 'Hyperthyroidism' },
  { value: 'arthritis', label: 'Arthritis / joint degeneration' },
  { value: 'osteoporosis', label: 'Osteoporosis / low bone density' },
  { value: 'sleep_apnea', label: 'Sleep apnea' },
  { value: 'fatigue', label: 'Chronic fatigue / fibromyalgia' },
  { value: 'mental', label: 'Anxiety / depression' },
  { value: 'none', label: 'None of the above' },
];

const TRAINING_AGES = [
  { value: 'beginner', label: 'Under 1 year', sub: 'Still building the foundation' },
  { value: 'early_intermediate', label: '1–3 years', sub: 'Comfortable with main movements' },
  { value: 'intermediate', label: '3–5 years', sub: 'Solid base, optimizing details' },
  { value: 'advanced', label: '5+ years', sub: 'Experienced, chasing every marginal gain' },
];

const TRAINING_TYPES = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbells', label: 'Dumbbells' },
  { value: 'machines', label: 'Machines' },
  { value: 'cables', label: 'Cables' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'hiit', label: 'HIIT' },
];

const SESSION_DURATIONS = ['30', '45', '60', '75', '90', '120'];

const TRAINING_STYLES = [
  { value: 'strength', label: 'Strength-focused', sub: 'Heavy compound lifts, low reps, progressive overload' },
  { value: 'muscle', label: 'Muscle building', sub: 'Moderate weight, higher volume, pump-focused' },
  { value: 'athletic', label: 'Athletic / functional', sub: 'Power, speed, sport-specific conditioning' },
  { value: 'balanced', label: 'Balanced mix', sub: 'Strength + aesthetics + conditioning' },
];

const DIETARY_RESTRICTIONS = [
  { value: 'none', label: 'None / No restrictions', sub: 'I eat everything' },
  { value: 'vegetarian', label: 'Vegetarian', sub: 'No meat' },
  { value: 'vegan', label: 'Vegan', sub: 'No animal products' },
  { value: 'gluten_free', label: 'Gluten-free', sub: 'Celiac or gluten sensitivity' },
  { value: 'dairy_free', label: 'Dairy-free', sub: 'Lactose intolerance or preference' },
  { value: 'halal_kosher', label: 'Halal / Kosher', sub: 'Religious dietary requirements' },
  { value: 'allergies', label: 'Food allergies', sub: 'Nuts, shellfish, or other allergies' },
];

const NUTRITION_QUALITY = [
  { value: 'poor', label: 'Poor', sub: 'Mostly processed food, irregular meals' },
  { value: 'inconsistent', label: 'Inconsistent', sub: 'Good days and bad days — no real structure' },
  { value: 'decent', label: 'Decent', sub: 'Generally healthy, room for improvement' },
  { value: 'solid', label: 'Solid', sub: 'Track macros or meal prep regularly' },
  { value: 'optimized', label: 'Optimized', sub: 'Dialed in — I know exactly what I eat' },
];

const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary', sub: 'Desk job, mostly sitting 8+ hours/day' },
  { value: 'light', label: 'Lightly active', sub: 'Mix of sitting and moving — some walking' },
  { value: 'moderate', label: 'Moderately active', sub: 'On my feet a fair amount — retail, teaching, etc.' },
  { value: 'very_active', label: 'Very active / manual labor', sub: 'Physically demanding job or high daily movement' },
];

const SLEEP_QUALITY = [
  { value: 'great', label: '7–9 hrs, consistent', sub: 'Wake rested most days' },
  { value: 'decent', label: '6–7 hrs, variable', sub: 'Decent but not optimal' },
  { value: 'poor', label: 'Under 6 hrs or disrupted', sub: 'Consistently tired, poor quality' },
  { value: 'severe', label: 'Severely disrupted', sub: 'Insomnia, infant, shift work, etc.' },
];

const STRESS_ENERGY = [
  { value: 'low', label: 'Low stress, good energy', sub: 'Feeling recovered most of the time' },
  { value: 'moderate', label: 'Moderate stress', sub: 'Life is busy but manageable' },
  { value: 'high', label: 'High stress, fatigue', sub: 'Running on fumes a lot' },
  { value: 'burnout', label: 'Burnout / very high stress', sub: 'Recovery is a major concern' },
];

const RECOVERY_PRACTICES = [
  { value: 'sauna', label: 'Sauna' },
  { value: 'cold_plunge', label: 'Cold plunge / ice bath' },
  { value: 'massage', label: 'Massage / soft tissue' },
  { value: 'foam_roll', label: 'Foam rolling / stretching' },
  { value: 'meditation', label: 'Meditation / breathwork' },
  { value: 'yoga', label: 'Yoga / mobility work' },
  { value: 'none', label: 'None currently' },
];

const DAYS_PER_WEEK = [
  { value: '3', label: '3 days', sub: 'Full body or upper/lower split' },
  { value: '4', label: '4 days', sub: 'Upper/lower or push/pull/legs' },
  { value: '5', label: '5 days', sub: 'Higher frequency, more volume' },
  { value: '6', label: '6 days', sub: 'High commitment, daily training' },
];

const EQUIPMENT = [
  { value: 'full_gym', label: 'Full commercial gym', sub: 'Barbells, cables, machines — everything available' },
  { value: 'limited', label: 'Limited setup', sub: 'Dumbbells, bands, some machines' },
  { value: 'home_gym', label: 'Home gym', sub: 'Barbell, plates, and basic home equipment' },
];

const ACCOUNTABILITY = [
  { value: 'daily', label: 'Daily app check-ins', sub: 'Log workouts and nutrition every day' },
  { value: 'weekly', label: 'Weekly progress reviews', sub: 'Weekly recap and plan adjustments' },
  { value: 'on_demand', label: 'On-demand coaching', sub: 'Ask when I need help, no strict check-ins' },
  { value: 'flexible', label: 'Flexible / whatever works', sub: 'No strong preference' },
];

const AESTHETIC_GOALS = [
  { value: 'chest', label: 'Chest' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'arms', label: 'Arms / biceps / triceps' },
  { value: 'back', label: 'Back / lats' },
  { value: 'core', label: 'Core / midsection' },
  { value: 'legs', label: 'Legs / quads / hams' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'posture', label: 'Posture improvement' },
  { value: 'leanness', label: 'Overall leanness' },
];

const SECTION_TITLES = [
  'Goals & Motivation',
  'Health & Medical',
  'Training Background',
  'Nutrition Baseline',
  'Lifestyle & Recovery',
  'Preferences & Logistics',
  'Body Composition',
  'Ready to Build',
];

// ── Main Component ────────────────────────────────────────────────────────────

export function CoachOnboarding({ onComplete }: CoachOnboardingProps) {
  const [step, setStep] = useState(1);
  const [p, setP] = useState<OnboardingProfile>(EMPTY);

  function set<K extends keyof OnboardingProfile>(key: K, val: OnboardingProfile[K]) {
    setP(prev => ({ ...prev, [key]: val }));
  }

  function isValid(): boolean {
    if (step === 1) return !!p.primaryGoal.trim() && !!p.goalWhy.trim() && !!p.obstacle && !!p.commitment;
    if (step === 2) return !!p.biologicalSex && p.parq.length > 0;
    if (step === 3) return !!p.trainingAge && !!p.trainingStyle;
    if (step === 4) return !!p.nutritionQuality;
    if (step === 5) return !!p.activityLevel && !!p.sleepQuality && !!p.stressEnergy;
    if (step === 6) return !!p.daysPerWeek && !!p.equipment && !!p.accountability;
    return true;
  }

  function handleNext() {
    if (step < TOTAL_STEPS) { setStep(step + 1); }
    else { onComplete(p); }
  }

  const progress = step / TOTAL_STEPS;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Progress bar */}
      <View style={s.progressWrap}>
        <View style={s.progressBg}>
          <View style={[s.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>
        <Text style={s.progressLabel}>{SECTION_TITLES[step - 1]} · {step} of {TOTAL_STEPS}</Text>
      </View>

      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Step 1: Goals & Motivation ──────────────────────────────────── */}
        {step === 1 && (
          <View style={s.stepWrap}>
            <SectionHeading
              title="Goals & Motivation"
              sub="Be as specific as possible — this shapes everything Anakin builds for you."
            />

            <QLabel text="What is your primary fitness goal right now?" />
            <Text style={s.fieldSub}>Short-term (3–6 months) and long-term (1–2+ years).</Text>
            <TA
              value={p.primaryGoal}
              onChange={v => set('primaryGoal', v)}
              placeholder="e.g. Short-term: add 20 lbs to my bench and drop 8 lbs of fat over the next 4 months. Long-term: compete in my first powerlifting meet within 18 months."
              height={100}
            />

            <QLabel text="Why is this goal important to you?" />
            <Text style={s.fieldSub}>What will achieving it mean for your life, career, or family?</Text>
            <TA
              value={p.goalWhy}
              onChange={v => set('goalWhy', v)}
              placeholder="e.g. I want to feel strong and confident again after a rough year. My health affects how I show up for my kids."
              height={80}
            />

            <QLabel text="What have you tried before, and what worked or didn't?" optional />
            <TA
              value={p.pastAttempts}
              onChange={v => set('pastAttempts', v)}
              placeholder="e.g. Ran Starting Strength for 6 months — made great gains but plateau'd. Tried keto but couldn't sustain it socially."
              height={80}
            />

            <QLabel text="What's been your biggest obstacle to consistency in the past?" />
            <SingleSelect options={OBSTACLES} value={p.obstacle as any} onChange={v => set('obstacle', v)} />

            <QLabel text="How committed are you to making this happen right now?" />
            <SingleSelect options={COMMITMENTS} value={p.commitment as any} onChange={v => set('commitment', v)} />
          </View>
        )}

        {/* ── Step 2: Health & Medical ─────────────────────────────────────── */}
        {step === 2 && (
          <View style={s.stepWrap}>
            <SectionHeading
              title="Health & Medical"
              sub="This calibrates recommendations and keeps your training safe."
            />

            <QLabel text="What is your biological sex?" />
            <Text style={s.fieldSub}>Calibrates caloric targets and hormonal recommendations.</Text>
            <SingleSelect options={SEXES} value={p.biologicalSex as any} onChange={v => set('biologicalSex', v)} />

            <QLabel text="PAR-Q Safety Screen — check any that apply" />
            <Text style={s.fieldSub}>Industry-standard Physical Activity Readiness Questionnaire.</Text>
            <MultiSelect
              options={PARQ_OPTIONS}
              values={p.parq}
              onChange={v => set('parq', v)}
              exclusive="none"
            />

            <QLabel text="Any current or past medical conditions, chronic illnesses, or surgeries?" optional />
            <MultiSelect
              options={MEDICAL_CONDITIONS}
              values={p.medicalConditions}
              onChange={v => set('medicalConditions', v)}
              exclusive="none"
            />
            {!p.medicalConditions.includes('none') && p.medicalConditions.length > 0 && (
              <TA
                value={p.medicalNotes}
                onChange={v => set('medicalNotes', v)}
                placeholder="Any additional details about these conditions..."
                height={60}
              />
            )}

            <QLabel text="Are you currently taking any medications or supplements?" optional />
            <TA
              value={p.medications}
              onChange={v => set('medications', v)}
              placeholder="e.g. Levothyroxine 50mcg daily (thyroid). Creatine 5g/day. Fish oil 2g/day."
              height={70}
            />

            <QLabel text="Any injuries, joint pain, or orthopedic issues — recent or old?" optional />
            <TA
              value={p.injuries}
              onChange={v => set('injuries', v)}
              placeholder="e.g. Left knee MCL sprain (2022, mostly healed). Chronic lower back tightness."
              height={70}
            />

            <QLabel text="Any hormonal, neurological, or reproductive health factors?" optional />
            <Text style={s.fieldSub}>Includes menopause, postpartum, PCOS, low T, thyroid, or anything affecting energy and recovery.</Text>
            <TA
              value={p.hormonalHealth}
              onChange={v => set('hormonalHealth', v)}
              placeholder="e.g. Perimenopausal — dealing with sleep disruption and energy swings."
              height={70}
            />
          </View>
        )}

        {/* ── Step 3: Training Background ───────────────────────────────────── */}
        {step === 3 && (
          <View style={s.stepWrap}>
            <SectionHeading title="Training Background" sub="Tell Anakin what your training looks like today." />

            <QLabel text="How long have you been training consistently?" />
            <SingleSelect options={TRAINING_AGES} value={p.trainingAge as any} onChange={v => set('trainingAge', v)} />

            <QLabel text="What does your current training look like?" optional />
            <Text style={s.fieldSub}>Days per week</Text>
            <View style={s.daysRow}>
              {[1, 2, 3, 4, 5, 6, 7].map(d => (
                <Pressable
                  key={d}
                  onPress={() => set('trainingDays', d)}
                  style={[s.dayChip, p.trainingDays === d && s.dayChipSel]}
                >
                  <Text style={[s.dayChipText, p.trainingDays === d && s.dayChipTextSel]}>{d}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldSub, { marginTop: spacing.sm }]}>Session duration</Text>
            <View style={s.durationRow}>
              {SESSION_DURATIONS.map(d => (
                <Pressable
                  key={d}
                  onPress={() => set('sessionDuration', d)}
                  style={[s.durChip, p.sessionDuration === d && s.durChipSel]}
                >
                  <Text style={[s.durChipText, p.sessionDuration === d && s.durChipTextSel]}>{d} min</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldSub, { marginTop: spacing.sm }]}>Training types (select all that apply)</Text>
            <View style={s.tagRow}>
              {TRAINING_TYPES.map(t => {
                const sel = p.trainingTypes.includes(t.value);
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => set('trainingTypes', toggleSimple(p.trainingTypes, t.value))}
                    style={[s.tag, sel && s.tagSel]}
                  >
                    <Text style={[s.tagText, sel && s.tagTextSel]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <QLabel text="Current working weights on main lifts" optional />
            <Text style={s.fieldSub}>Approximate 1RMs or working weights. Skip lifts you don't do.</Text>
            <View style={s.strengthHeader}>
              <Text style={[s.strengthCol, { flex: 2 }]}>Exercise</Text>
              <Text style={s.strengthCol}>Weight (lbs)</Text>
              <Text style={s.strengthCol}>Sets</Text>
              <Text style={s.strengthCol}>Reps</Text>
            </View>
            {[
              { label: 'Bench Press', wKey: 'benchWeight', sKey: 'benchSets', rKey: 'benchReps' },
              { label: 'Squat', wKey: 'squatWeight', sKey: 'squatSets', rKey: 'squatReps' },
              { label: 'Deadlift', wKey: 'deadliftWeight', sKey: 'deadliftSets', rKey: 'deadliftReps' },
              { label: 'Overhead Press', wKey: 'ohpWeight', sKey: 'ohpSets', rKey: 'ohpReps' },
              { label: 'Barbell Row', wKey: 'rowWeight', sKey: 'rowSets', rKey: 'rowReps' },
            ].map(row => (
              <View key={row.label} style={s.strengthRow}>
                <Text style={[s.strengthName, { flex: 2 }]}>{row.label}</Text>
                <TextInput
                  style={s.strengthInput}
                  value={(p as any)[row.wKey]}
                  onChangeText={v => set(row.wKey as any, v)}
                  placeholder="—"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
                <TextInput
                  style={s.strengthInput}
                  value={(p as any)[row.sKey]}
                  onChangeText={v => set(row.sKey as any, v)}
                  placeholder="—"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
                <TextInput
                  style={s.strengthInput}
                  value={(p as any)[row.rKey]}
                  onChangeText={v => set(row.rKey as any, v)}
                  placeholder="—"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
              </View>
            ))}

            <QLabel text="What training style fits you best?" />
            <SingleSelect options={TRAINING_STYLES} value={p.trainingStyle as any} onChange={v => set('trainingStyle', v)} />
          </View>
        )}

        {/* ── Step 4: Nutrition Baseline ───────────────────────────────────── */}
        {step === 4 && (
          <View style={s.stepWrap}>
            <SectionHeading title="Nutrition Baseline" sub="Anakin uses this to set your initial nutrition targets." />

            <QLabel text="Any dietary restrictions or preferences?" optional />
            <MultiSelect
              options={DIETARY_RESTRICTIONS}
              values={p.dietaryRestrictions}
              onChange={v => set('dietaryRestrictions', v)}
              exclusive="none"
            />

            <QLabel text="How would you rate your current nutrition?" />
            <SingleSelect options={NUTRITION_QUALITY} value={p.nutritionQuality as any} onChange={v => set('nutritionQuality', v)} />

            <QLabel text="Approximate daily protein intake, if you know it?" optional />
            <NumInput
              value={p.dailyProtein}
              onChange={v => set('dailyProtein', v)}
              placeholder="150"
              unit="g / day"
            />
          </View>
        )}

        {/* ── Step 5: Lifestyle & Recovery ────────────────────────────────── */}
        {step === 5 && (
          <View style={s.stepWrap}>
            <SectionHeading title="Lifestyle & Recovery" sub="Recovery and lifestyle directly impact training capacity." />

            <QLabel text="What is your daily activity level outside of training?" />
            <Text style={s.fieldSub}>This affects calorie burn (NEAT) and recovery capacity.</Text>
            <SingleSelect options={ACTIVITY_LEVELS} value={p.activityLevel as any} onChange={v => set('activityLevel', v)} />

            <QLabel text="How is your sleep — quality and quantity?" />
            <SingleSelect options={SLEEP_QUALITY} value={p.sleepQuality as any} onChange={v => set('sleepQuality', v)} />

            <QLabel text="How would you rate your overall stress and energy levels day-to-day?" />
            <SingleSelect options={STRESS_ENERGY} value={p.stressEnergy as any} onChange={v => set('stressEnergy', v)} />

            <QLabel text="Walk me through a typical weekday." optional />
            <Text style={s.fieldSub}>Wake time, work schedule, when you train, stress sources, wind-down.</Text>
            <TA
              value={p.typicalWeekday}
              onChange={v => set('typicalWeekday', v)}
              placeholder="e.g. Up at 6:30am. Desk job, high screen time. Train after work around 6pm. Bed by 11pm but usually on phone till midnight."
              height={80}
            />

            <QLabel text="Any wellness or recovery practices you currently use?" optional />
            <MultiSelect
              options={RECOVERY_PRACTICES}
              values={p.recoveryPractices}
              onChange={v => set('recoveryPractices', v)}
              exclusive="none"
            />
            {!p.recoveryPractices.includes('none') && p.recoveryPractices.length > 0 && (
              <TA
                value={p.recoveryNotes}
                onChange={v => set('recoveryNotes', v)}
                placeholder="Any other notes?"
                height={60}
              />
            )}
          </View>
        )}

        {/* ── Step 6: Preferences & Logistics ─────────────────────────────── */}
        {step === 6 && (
          <View style={s.stepWrap}>
            <SectionHeading title="Preferences & Logistics" sub="These parameters drive how your program is structured." />

            <QLabel text="How many days per week can you realistically train?" />
            <SingleSelect options={DAYS_PER_WEEK} value={p.daysPerWeek as any} onChange={v => set('daysPerWeek', v)} />

            <QLabel text="What equipment do you train with?" />
            <SingleSelect options={EQUIPMENT} value={p.equipment as any} onChange={v => set('equipment', v)} />

            <QLabel text="How do you want to track accountability and check-ins?" />
            <SingleSelect options={ACCOUNTABILITY} value={p.accountability as any} onChange={v => set('accountability', v)} />
          </View>
        )}

        {/* ── Step 7: Body Composition ─────────────────────────────────────── */}
        {step === 7 && (
          <View style={s.stepWrap}>
            <SectionHeading
              title="Body Composition & Aesthetics"
              sub="Used to calibrate caloric needs, strength standards, and body composition targets."
            />

            <QLabel text="Current height, weight, and approximate body fat %?" optional />
            <View style={s.statsGrid}>
              <View style={s.statsCell}>
                <Text style={s.statsLabel}>Height (ft)</Text>
                <TextInput
                  style={s.statsInput}
                  value={p.heightFt}
                  onChangeText={v => set('heightFt', v)}
                  placeholder="5"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
              </View>
              <View style={s.statsCell}>
                <Text style={s.statsLabel}>Height (in)</Text>
                <TextInput
                  style={s.statsInput}
                  value={p.heightIn}
                  onChangeText={v => set('heightIn', v)}
                  placeholder="10"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
              </View>
              <View style={s.statsCell}>
                <Text style={s.statsLabel}>Weight (lbs)</Text>
                <TextInput
                  style={s.statsInput}
                  value={p.weightLbs}
                  onChangeText={v => set('weightLbs', v)}
                  placeholder="175"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
              </View>
              <View style={s.statsCell}>
                <Text style={s.statsLabel}>Body fat %</Text>
                <TextInput
                  style={s.statsInput}
                  value={p.bodyFat}
                  onChangeText={v => set('bodyFat', v)}
                  placeholder="18"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <QLabel text="Any specific aesthetic goals or areas to prioritize?" optional />
            <View style={s.tagRow}>
              {AESTHETIC_GOALS.map(g => {
                const sel = p.aestheticGoals.includes(g.value);
                return (
                  <Pressable
                    key={g.value}
                    onPress={() => set('aestheticGoals', toggleSimple(p.aestheticGoals, g.value))}
                    style={[s.tag, sel && s.tagSel]}
                  >
                    <Text style={[s.tagText, sel && s.tagTextSel]}>{g.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {p.aestheticGoals.length > 0 && (
              <TA
                value={p.aestheticNotes}
                onChange={v => set('aestheticNotes', v)}
                placeholder="Any additional details about your aesthetic goals?"
                height={60}
              />
            )}

            <QLabel text="What's your weekly food budget?" optional />
            <Text style={s.fieldSub}>Used to suggest meals that fit your nutrition goals and wallet.</Text>
            <NumInput
              value={p.weeklyBudget}
              onChange={v => set('weeklyBudget', v)}
              placeholder="100"
              unit="$ / week"
            />
          </View>
        )}

        {/* ── Step 8: Consent ──────────────────────────────────────────────── */}
        {step === 8 && (
          <View style={s.stepWrap}>
            <View style={s.consentIcon}>
              <Text style={s.consentIconText}>A</Text>
            </View>
            <Text style={s.consentTitle}>You're all set.</Text>
            <Text style={s.consentBody}>
              Axiom provides AI-generated fitness guidance for informational and coaching purposes only — not medical advice.
              {'\n\n'}
              If you flagged any health concerns above, please consult a physician before beginning a new exercise program.
              {'\n\n'}
              Your data is kept private and never sold.
            </Text>
          </View>
        )}

        {/* Nav buttons */}
        <View style={s.navRow}>
          {step > 1 ? (
            <Button variant="outline" onPress={() => setStep(step - 1)} style={s.navBtn}>Back</Button>
          ) : (
            <View style={s.navBtn} />
          )}
          <Button
            onPress={handleNext}
            disabled={!isValid()}
            style={s.navBtn}
          >
            {step === TOTAL_STEPS ? 'Build My Profile →' : 'Next'}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 40 },
  stepWrap: { gap: spacing.md },

  // Progress
  progressWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
    gap: 4,
  },
  progressBg: {
    height: 3,
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  progressLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
  },

  // Section headings
  sectionHeading: { gap: 4, marginBottom: spacing.xs },
  sectionTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  sectionSub: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 20 },

  // Question labels
  qLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  qLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground, flex: 1 },
  qOptional: {
    fontSize: fontSize.xs, color: colors.mutedForeground,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm,
  },
  fieldSub: { fontSize: fontSize.sm, color: colors.mutedForeground, marginBottom: spacing.xs, lineHeight: 18 },

  // Option list (single / multi select)
  optionList: { gap: spacing.xs },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
  },
  optionCardSel: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  radio: {
    width: 20, height: 20, borderRadius: radius.full, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioSel: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.primary },
  checkbox: {
    width: 20, height: 20, borderRadius: radius.sm, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkboxSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.primaryForeground, fontSize: 12, fontWeight: fontWeight.bold },
  optionTextWrap: { flex: 1 },
  optionLabel: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  optionLabelSel: { color: colors.foreground, fontWeight: fontWeight.semibold },
  optionSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2, lineHeight: 16 },

  // Text area
  textArea: {
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm, color: colors.foreground,
    fontSize: fontSize.sm, minHeight: 80, lineHeight: 20,
  },

  // Number input
  numRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  textInput: {
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 10,
    color: colors.foreground, fontSize: fontSize.sm,
  },
  unit: { fontSize: fontSize.sm, color: colors.mutedForeground, flexShrink: 0 },

  // Day chips (1-7)
  daysRow: { flexDirection: 'row', gap: spacing.xs },
  dayChip: {
    width: 38, height: 38, borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  dayChipSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  dayChipTextSel: { color: colors.primaryForeground },

  // Duration chips
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  durChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
  },
  durChipSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  durChipText: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  durChipTextSel: { color: colors.primaryForeground },

  // Tag chips (training types, aesthetic goals)
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: {
    paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
  },
  tagSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  tagTextSel: { color: colors.primaryForeground },

  // Strength table
  strengthHeader: {
    flexDirection: 'row', paddingVertical: spacing.xs, borderBottomWidth: 1,
    borderBottomColor: colors.border, marginBottom: spacing.xs,
  },
  strengthCol: { flex: 1, fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.semibold },
  strengthRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  strengthName: { fontSize: fontSize.xs, color: colors.foreground, fontWeight: fontWeight.medium },
  strengthInput: {
    flex: 1, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 6,
    fontSize: fontSize.xs, color: colors.foreground, textAlign: 'center',
  },

  // Body stats grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statsCell: { flex: 1, minWidth: '45%', gap: 4 },
  statsLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  statsInput: {
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 10,
    fontSize: fontSize.sm, color: colors.foreground, textAlign: 'center',
  },

  // Consent
  consentIcon: {
    width: 72, height: 72, borderRadius: radius.full,
    backgroundColor: colors.foreground, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: spacing.md,
  },
  consentIconText: { fontSize: 32, fontWeight: fontWeight.bold, color: colors.primaryForeground },
  consentTitle: {
    fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground,
    textAlign: 'center', marginBottom: spacing.sm,
  },
  consentBody: {
    fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 22,
    textAlign: 'center', paddingHorizontal: spacing.sm,
  },

  // Nav
  navRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  navBtn: { flex: 1 },
});
