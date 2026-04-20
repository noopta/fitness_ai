import { useState } from "react";
import { Link } from "wouter";
import { BarChart3, ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

const STANDARDS: Record<string, Record<string, { beginner: number; novice: number; intermediate: number; advanced: number; elite: number }>> = {
  male: {
    "Flat Bench Press":   { beginner: 0.5,  novice: 0.75, intermediate: 1.0,  advanced: 1.25, elite: 1.5  },
    "Barbell Squat":      { beginner: 0.5,  novice: 0.75, intermediate: 1.25, advanced: 1.5,  elite: 1.75 },
    "Deadlift":           { beginner: 0.75, novice: 1.0,  intermediate: 1.5,  advanced: 1.75, elite: 2.0  },
    "Overhead Press":     { beginner: 0.25, novice: 0.5,  intermediate: 0.65, advanced: 0.8,  elite: 1.0  },
    "Barbell Row":        { beginner: 0.4,  novice: 0.65, intermediate: 0.9,  advanced: 1.1,  elite: 1.3  },
    "Incline Bench Press":{ beginner: 0.4,  novice: 0.6,  intermediate: 0.8,  advanced: 1.0,  elite: 1.2  },
    "Romanian Deadlift":  { beginner: 0.6,  novice: 0.85, intermediate: 1.1,  advanced: 1.35, elite: 1.6  },
    "Front Squat":        { beginner: 0.4,  novice: 0.6,  intermediate: 0.9,  advanced: 1.1,  elite: 1.35 },
  },
  female: {
    "Flat Bench Press":   { beginner: 0.25, novice: 0.45, intermediate: 0.65, advanced: 0.85, elite: 1.0  },
    "Barbell Squat":      { beginner: 0.35, novice: 0.55, intermediate: 0.85, advanced: 1.1,  elite: 1.4  },
    "Deadlift":           { beginner: 0.5,  novice: 0.75, intermediate: 1.1,  advanced: 1.4,  elite: 1.7  },
    "Overhead Press":     { beginner: 0.15, novice: 0.3,  intermediate: 0.45, advanced: 0.6,  elite: 0.75 },
    "Barbell Row":        { beginner: 0.25, novice: 0.45, intermediate: 0.65, advanced: 0.85, elite: 1.0  },
    "Incline Bench Press":{ beginner: 0.2,  novice: 0.35, intermediate: 0.5,  advanced: 0.65, elite: 0.8  },
    "Romanian Deadlift":  { beginner: 0.4,  novice: 0.6,  intermediate: 0.85, advanced: 1.1,  elite: 1.35 },
    "Front Squat":        { beginner: 0.25, novice: 0.45, intermediate: 0.65, advanced: 0.85, elite: 1.1  },
  },
};

const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'] as const;
type Level = typeof LEVELS[number];

const LEVEL_COLORS: Record<Level, string> = {
  beginner: 'bg-gray-200 text-gray-700',
  novice: 'bg-green-100 text-green-700',
  intermediate: 'bg-blue-100 text-blue-700',
  advanced: 'bg-purple-100 text-purple-700',
  elite: 'bg-yellow-100 text-yellow-700',
};

const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Strength Standards Calculator",
    "url": "https://axiomtraining.io/tools/strength-standards",
    "description": "Free strength standards calculator. See how your bench press, squat, deadlift, and overhead press compare to beginner, novice, intermediate, advanced, and elite levels based on bodyweight ratios.",
    "applicationCategory": "HealthApplication",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "How strong should an intermediate lifter be?",
        "acceptedAnswer": { "@type": "Answer", "text": "An intermediate male lifter should be able to bench press 1× bodyweight, squat 1.25× bodyweight, and deadlift 1.5× bodyweight. Female intermediate standards are approximately 0.65×, 0.85×, and 1.1× bodyweight respectively. These ratios represent 1–3 years of consistent structured training." }
      },
      {
        "@type": "Question",
        "name": "Why are squat and deadlift standards higher than bench press?",
        "acceptedAnswer": { "@type": "Answer", "text": "The squat and deadlift engage more total muscle mass — legs, glutes, back, and core — while the bench press primarily loads the chest, shoulders, and triceps. More muscles means more total force production potential. Most lifters can squat about 25% more than they bench and deadlift about 50% more." }
      },
      {
        "@type": "Question",
        "name": "What bodyweight ratio is considered advanced for bench press?",
        "acceptedAnswer": { "@type": "Answer", "text": "An advanced bench press for men is approximately 1.25× bodyweight (e.g., 230 lbs for a 185 lb lifter). For women, an advanced bench is around 0.85× bodyweight. Reaching this level typically requires 3–5+ years of structured training with periodized programming." }
      },
      {
        "@type": "Question",
        "name": "How long does it take to reach an intermediate strength level?",
        "acceptedAnswer": { "@type": "Answer", "text": "Most lifters reach intermediate strength standards after 1–2 years of consistent, structured training. The transition from novice to intermediate is marked by the end of linear progression — when weekly or session-to-session progress slows and more complex programming is needed." }
      }
    ]
  }
];

export default function StrengthStandardsPage() {
  const [bodyweight, setBodyweight] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs');
  const [maxes, setMaxes] = useState<Record<string, string>>({});

  const bw = parseFloat(bodyweight);
  const standards = STANDARDS[gender];

  const setMax = (lift: string, val: string) => {
    setMaxes((prev) => ({ ...prev, [lift]: val }));
  };

  const getLevel = (lift: string): Level | null => {
    const val = parseFloat(maxes[lift]);
    if (!val || !bw) return null;
    const ratio = val / bw;
    const s = standards[lift];
    if (ratio >= s.elite) return 'elite';
    if (ratio >= s.advanced) return 'advanced';
    if (ratio >= s.intermediate) return 'intermediate';
    if (ratio >= s.novice) return 'novice';
    return 'beginner';
  };

  return (
    <>
      <SEO
        title="Strength Standards Calculator — How Strong Should You Be?"
        description="Find out exactly how your bench press, squat, and deadlift compare to strength standards. Enter your bodyweight and 1RMs — see if you're beginner, novice, intermediate, advanced, or elite."
        canonical="/tools/strength-standards"
        jsonLd={JSON_LD}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
          {/* Header */}
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <BarChart3 size={12} /> FREE TOOL
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
              Strength Standards Calculator
            </h1>
            <p className="text-muted-foreground text-base max-w-xl mx-auto">
              How strong should you be? Enter your bodyweight and 1RMs to instantly see your strength level across all major lifts.
            </p>
          </div>

          {/* Input */}
          <Card className="p-6 mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">BODYWEIGHT</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="185"
                    value={bodyweight}
                    onChange={(e) => setBodyweight(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                  <button
                    onClick={() => setUnit(unit === 'lbs' ? 'kg' : 'lbs')}
                    className="border border-border rounded-lg px-3 py-2 text-xs font-semibold bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    {unit}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">GENDER</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(['male', 'female'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      className={`flex-1 py-2 text-sm font-semibold transition-colors capitalize ${gender === g ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Standards table */}
          <div className="overflow-x-auto mb-8">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-4 py-3 font-semibold text-foreground rounded-tl-lg">Lift</th>
                  <th className="text-center px-3 py-3 font-semibold text-foreground">Your 1RM</th>
                  {LEVELS.map((l) => (
                    <th key={l} className={`text-center px-3 py-3 font-semibold capitalize rounded-t-sm`}>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${LEVEL_COLORS[l]}`}>{l}</span>
                    </th>
                  ))}
                  <th className="px-4 py-3 rounded-tr-lg">Level</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(standards).map(([lift, s], idx) => {
                  const level = getLevel(lift);
                  return (
                    <tr key={lift} className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                      <td className="px-4 py-3 font-medium text-foreground">{lift}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          placeholder="—"
                          value={maxes[lift] ?? ''}
                          onChange={(e) => setMax(lift, e.target.value)}
                          className="w-20 border border-border rounded-md px-2 py-1 text-sm bg-background text-foreground text-center focus:outline-none focus:ring-2 focus:ring-foreground/20"
                        />
                      </td>
                      {LEVELS.map((l) => (
                        <td key={l} className="px-3 py-3 text-center text-muted-foreground text-xs">
                          {bw > 0 ? `${Math.round(s[l] * bw)}` : `${s[l]}×`}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        {level && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${LEVEL_COLORS[level]}`}>
                            {level}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2 px-1">Standards are bodyweight multipliers. Enter your bodyweight above to see absolute weights.</p>
          </div>

          {/* Legend */}
          <Card className="p-4 mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-3">Strength Level Definitions</h2>
            <div className="space-y-2 text-sm">
              <div className="flex gap-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_COLORS.beginner}`}>Beginner</span><span className="text-muted-foreground">Less than 6 months of consistent training</span></div>
              <div className="flex gap-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_COLORS.novice}`}>Novice</span><span className="text-muted-foreground">6–18 months of training, linear progression</span></div>
              <div className="flex gap-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_COLORS.intermediate}`}>Intermediate</span><span className="text-muted-foreground">1–3 years of structured training</span></div>
              <div className="flex gap-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_COLORS.advanced}`}>Advanced</span><span className="text-muted-foreground">3–5+ years, periodized programming required</span></div>
              <div className="flex gap-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_COLORS.elite}`}>Elite</span><span className="text-muted-foreground">Competitive powerlifter or nationally ranked athlete</span></div>
            </div>
          </Card>

          {/* CTA */}
          <div className="rounded-2xl bg-foreground text-background p-6 text-center mb-12">
            <h2 className="text-lg font-bold mb-2">Stuck at intermediate? Let Axiom diagnose why.</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Most lifters plateau at intermediate because of a specific weak link — not just "needing to train harder." Axiom finds it.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">
                Get my free lift diagnostic <ArrowRight size={14} className="ml-1" />
              </Link>
            </Button>
          </div>

          {/* Educational content */}
          <div className="prose prose-sm max-w-none">
            <h2 className="text-xl font-bold text-foreground mb-4">How strong should you be by bodyweight?</h2>
            <p className="text-muted-foreground mb-4">
              Strength standards based on bodyweight ratios are the most practical way to compare lifters across different weight classes. A 1× bodyweight bench press is considered intermediate for men; a 1.5× bench is advanced. These ratios are derived from large datasets of competitive and recreational lifters.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">Why are squat and deadlift standards higher than bench?</h3>
            <p className="text-muted-foreground mb-4">
              The squat and deadlift involve more total muscle mass and are more neurally demanding movements. Most people can squat ~25% more than they bench and deadlift ~50% more than they bench. If your squat and deadlift are disproportionately lower than your bench, it suggests a posterior chain weakness.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">The plateau problem</h3>
            <p className="text-muted-foreground">
              The most common reason intermediate lifters stall is not lack of effort — it's a specific weak link. Your bench may plateau because of weak triceps at lockout, not because your chest needs more work. Axiom's diagnostic engine calculates strength-ratio indexes across your accessory lifts to identify this exact bottleneck.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
