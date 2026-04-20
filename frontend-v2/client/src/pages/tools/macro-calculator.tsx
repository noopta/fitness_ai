import { useState } from "react";
import { Link } from "wouter";
import { Utensils, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

const ACTIVITY_MULTIPLIERS = {
  "Sedentary (desk job, no exercise)": 1.2,
  "Lightly active (1-3 days/week)": 1.375,
  "Moderately active (3-5 days/week)": 1.55,
  "Very active (6-7 days/week)": 1.725,
  "Extremely active (2x/day training)": 1.9,
};

const GOALS = {
  "Lose fat": -500,
  "Aggressive cut": -750,
  "Slow cut / recomp": -250,
  "Maintain": 0,
  "Lean bulk": 250,
  "Bulk": 500,
};

const PROTEIN_TARGETS = {
  fat_loss: 1.0,    // g per lb bodyweight
  maintenance: 0.8,
  muscle_gain: 0.9,
};

const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Macro Calculator for Strength Athletes",
    "url": "https://axiomtraining.io/tools/macro-calculator",
    "description": "Free macro calculator for strength athletes and powerlifters. Get personalized calorie and macronutrient targets (protein, carbs, fat) based on your bodyweight, height, activity level, and goal.",
    "applicationCategory": "HealthApplication",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "How much protein do I need to build muscle?",
        "acceptedAnswer": { "@type": "Answer", "text": "Current evidence suggests 0.7–1.0g of protein per pound of bodyweight (1.6–2.2g/kg) is sufficient for most strength athletes. During a caloric deficit, higher protein intake (up to 1.2g/lb) helps preserve muscle mass. Going above this provides no additional muscle-building benefit." }
      },
      {
        "@type": "Question",
        "name": "What is TDEE and how is it calculated?",
        "acceptedAnswer": { "@type": "Answer", "text": "TDEE (Total Daily Energy Expenditure) is the total number of calories you burn per day, including exercise. It is calculated by multiplying your BMR (Basal Metabolic Rate) by an activity multiplier — typically 1.2 for sedentary lifestyles up to 1.9 for very active individuals who train twice per day." }
      },
      {
        "@type": "Question",
        "name": "How many calories should I eat to bulk?",
        "acceptedAnswer": { "@type": "Answer", "text": "A lean bulk typically adds 200–300 calories above your TDEE per day, which supports muscle growth while minimizing fat gain. An aggressive bulk adds 400–500+ calories above TDEE. Most strength athletes do best with a lean bulk to keep body composition in check over multi-month training phases." }
      },
      {
        "@type": "Question",
        "name": "Why are carbohydrates important for powerlifters?",
        "acceptedAnswer": { "@type": "Answer", "text": "Carbohydrates are the primary fuel source for high-intensity compound lifts like squats, deadlifts, and bench press. Inadequate carbohydrate intake can cause training performance to drop before any other nutrient deficiency becomes apparent. Aim to consume the majority of your daily carbs 2–3 hours before and immediately after your training session." }
      }
    ]
  }
];

export default function MacroCalculatorPage() {
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [unit, setUnit] = useState<'imperial' | 'metric'>('imperial');
  const [activity, setActivity] = useState(Object.keys(ACTIVITY_MULTIPLIERS)[2]);
  const [goal, setGoal] = useState('Maintain');

  const ageNum = parseInt(age, 10);
  const weightNum = parseFloat(weight);
  const heightNum = parseFloat(height);

  // Convert to metric for Mifflin-St Jeor
  const weightKg = unit === 'imperial' ? weightNum * 0.453592 : weightNum;
  const heightCm = unit === 'imperial' ? heightNum * 2.54 : heightNum;

  const valid = ageNum > 0 && weightKg > 20 && heightCm > 100;

  // Mifflin-St Jeor BMR
  const bmr = valid
    ? gender === 'male'
      ? 10 * weightKg + 6.25 * heightCm - 5 * ageNum + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * ageNum - 161
    : 0;

  const tdee = valid ? Math.round(bmr * ACTIVITY_MULTIPLIERS[activity as keyof typeof ACTIVITY_MULTIPLIERS]) : 0;
  const adjustment = GOALS[goal as keyof typeof GOALS] ?? 0;
  const targetCals = tdee + adjustment;

  const weightLbs = unit === 'imperial' ? weightNum : weightNum * 2.2046;
  const isDeficit = adjustment < 0;
  const proteinMultiplier = isDeficit ? PROTEIN_TARGETS.fat_loss : adjustment > 0 ? PROTEIN_TARGETS.muscle_gain : PROTEIN_TARGETS.maintenance;
  const proteinG = valid ? Math.round(weightLbs * proteinMultiplier) : 0;
  const fatG = valid ? Math.round(targetCals * 0.25 / 9) : 0;
  const carbsG = valid ? Math.round((targetCals - proteinG * 4 - fatG * 9) / 4) : 0;

  const barWidth = (g: number, cal: number) => `${Math.round((g * cal / targetCals) * 100)}%`;

  return (
    <>
      <SEO
        title="Macro Calculator for Strength Athletes — Protein, Carbs & Fat"
        description="Free macro calculator for powerlifters and strength athletes. Get your exact daily calorie target plus protein, carbs, and fat macros based on your body stats, activity level, and goal."
        canonical="/tools/macro-calculator"
        jsonLd={JSON_LD}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <Utensils size={12} /> FREE TOOL
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
              Macro Calculator
            </h1>
            <p className="text-muted-foreground text-base max-w-xl mx-auto">
              Get your daily calorie target and exact macro split — optimized for strength athletes and powerlifters.
            </p>
          </div>

          <Card className="p-6 mb-6">
            {/* Gender + unit */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">GENDER</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(['male', 'female'] as const).map((g) => (
                    <button key={g} onClick={() => setGender(g)}
                      className={`flex-1 py-2 text-sm font-semibold capitalize transition-colors ${gender === g ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">UNITS</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(['imperial', 'metric'] as const).map((u) => (
                    <button key={u} onClick={() => setUnit(u)}
                      className={`flex-1 py-2 text-sm font-semibold capitalize transition-colors ${unit === u ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'}`}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">AGE</label>
                <input type="number" min={10} max={100} placeholder="25" value={age} onChange={(e) => setAge(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  WEIGHT ({unit === 'imperial' ? 'lbs' : 'kg'})
                </label>
                <input type="number" min={50} placeholder={unit === 'imperial' ? '185' : '84'} value={weight} onChange={(e) => setWeight(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  HEIGHT ({unit === 'imperial' ? 'in' : 'cm'})
                </label>
                <input type="number" min={48} placeholder={unit === 'imperial' ? '70' : '178'} value={height} onChange={(e) => setHeight(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20" />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">ACTIVITY LEVEL</label>
              <select value={activity} onChange={(e) => setActivity(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20">
                {Object.keys(ACTIVITY_MULTIPLIERS).map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">GOAL</label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(GOALS).map((g) => (
                  <button key={g} onClick={() => setGoal(g)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${goal === g ? 'bg-foreground text-background' : 'border border-border bg-background text-foreground hover:bg-muted'}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {valid && (
            <>
              {/* Big calorie number */}
              <div className="text-center mb-6">
                <p className="text-xs font-semibold text-muted-foreground mb-1">DAILY CALORIES</p>
                <p className="text-5xl font-extrabold text-foreground">{targetCals.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">TDEE: {tdee.toLocaleString()} kcal {adjustment !== 0 && `(${adjustment > 0 ? '+' : ''}${adjustment} kcal ${goal.toLowerCase()})`}</p>
              </div>

              {/* Macro breakdown */}
              <Card className="p-5 mb-6">
                <h2 className="text-sm font-semibold text-foreground mb-4">Macro Targets</h2>
                {[
                  { label: 'Protein', g: proteinG, cal: 4, color: 'bg-blue-500' },
                  { label: 'Carbohydrates', g: carbsG, cal: 4, color: 'bg-green-500' },
                  { label: 'Fat', g: fatG, cal: 9, color: 'bg-yellow-500' },
                ].map(({ label, g, cal, color }) => (
                  <div key={label} className="mb-4 last:mb-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-semibold text-foreground">{label}</span>
                      <span className="text-sm text-muted-foreground">{g}g · {g * cal} kcal</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(g * cal / targetCals * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </Card>

              <Card className="p-4 mb-8">
                <h2 className="text-sm font-semibold text-foreground mb-2">How these numbers were calculated</h2>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p>BMR (Mifflin-St Jeor): <span className="font-semibold text-foreground">{Math.round(bmr)} kcal</span></p>
                  <p>Activity multiplier: <span className="font-semibold text-foreground">{ACTIVITY_MULTIPLIERS[activity as keyof typeof ACTIVITY_MULTIPLIERS]}×</span></p>
                  <p>TDEE: <span className="font-semibold text-foreground">{tdee} kcal</span></p>
                  <p>Goal adjustment: <span className="font-semibold text-foreground">{adjustment > 0 ? '+' : ''}{adjustment} kcal</span></p>
                  <p>Protein: <span className="font-semibold text-foreground">{proteinMultiplier}g per lb bodyweight</span> (higher during deficit to preserve muscle)</p>
                </div>
              </Card>
            </>
          )}

          <div className="rounded-2xl bg-foreground text-background p-6 text-center mb-12">
            <h2 className="text-lg font-bold mb-2">Fueled up but still not progressing?</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Nutrition is only half the equation. Axiom diagnoses the training-side bottleneck keeping your lifts from moving.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">Get my free lift diagnostic <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>

          <div className="prose prose-sm max-w-none">
            <h2 className="text-xl font-bold text-foreground mb-4">Macros for strength athletes</h2>
            <p className="text-muted-foreground mb-4">
              Strength athletes need more protein and carbohydrates than the general population. Protein preserves and builds muscle tissue; carbohydrates fuel high-intensity training sessions. Fat supports hormonal health and joint function.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">How much protein do powerlifters need?</h3>
            <p className="text-muted-foreground mb-4">
              Current evidence suggests 0.7–1.0g of protein per pound of bodyweight (1.6–2.2g/kg) is sufficient for most strength athletes. Higher protein (up to 1.2g/lb) may be beneficial during a caloric deficit to prevent muscle loss. Going above this provides no additional benefit and simply displaces carbohydrates.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">Carbs for training performance</h3>
            <p className="text-muted-foreground">
              Carbohydrates are the primary fuel source for heavy compound lifts. Inadequate carb intake is one of the most common reasons strength athletes plateau — not necessarily a training problem. Aim for the majority of your daily carbs around your training session (2–3 hours before and immediately after).
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
