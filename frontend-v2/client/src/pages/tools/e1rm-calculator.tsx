import { useState } from "react";
import { Link } from "wouter";
import { Calculator, ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

const FORMULAS = {
  Epley:     (w: number, r: number) => w * (1 + r / 30),
  Brzycki:   (w: number, r: number) => w * (36 / (37 - r)),
  Mayhew:    (w: number, r: number) => (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * r)),
  Lombardi:  (w: number, r: number) => w * Math.pow(r, 0.10),
  "O'Conner":(w: number, r: number) => w * (1 + 0.025 * r),
};

const STRENGTH_LEVELS = {
  "Flat Bench Press": { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.25, elite: 1.5 },
  "Barbell Squat":    { beginner: 0.5, novice: 0.75, intermediate: 1.25, advanced: 1.5, elite: 1.75 },
  "Deadlift":         { beginner: 0.75, novice: 1.0, intermediate: 1.5, advanced: 1.75, elite: 2.0 },
  "Overhead Press":   { beginner: 0.25, novice: 0.5, intermediate: 0.65, advanced: 0.8, elite: 1.0 },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "One Rep Max (e1RM) Calculator",
  "url": "https://axiomtraining.io/tools/e1rm-calculator",
  "description": "Free one rep max calculator. Enter any weight and rep count — get instant e1RM estimates across 5 formulas (Epley, Brzycki, Mayhew, Lombardi, O'Conner) plus strength level benchmarks.",
  "applicationCategory": "HealthApplication",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
};

function epley(w: number, r: number) { return Math.round(w * (1 + r / 30)); }

export default function E1RMCalculatorPage() {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs');
  const [bodyweight, setBodyweight] = useState('');
  const [lift, setLift] = useState('Flat Bench Press');

  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  const bw = parseFloat(bodyweight);

  const valid = w > 0 && r >= 1 && r <= 30;

  const results = valid
    ? Object.entries(FORMULAS).map(([name, fn]) => ({
        name,
        e1rm: Math.round(fn(w, r)),
      }))
    : [];

  const avgE1RM = valid
    ? Math.round(results.reduce((s, x) => s + x.e1rm, 0) / results.length)
    : 0;

  const bwRatio = valid && bw > 0 ? (avgE1RM / bw).toFixed(2) : null;

  const levels = STRENGTH_LEVELS[lift as keyof typeof STRENGTH_LEVELS];
  const levelLabel = valid && bw > 0 && levels
    ? (() => {
        const ratio = avgE1RM / bw;
        if (ratio >= levels.elite) return { label: 'Elite', color: 'text-yellow-600' };
        if (ratio >= levels.advanced) return { label: 'Advanced', color: 'text-purple-600' };
        if (ratio >= levels.intermediate) return { label: 'Intermediate', color: 'text-blue-600' };
        if (ratio >= levels.novice) return { label: 'Novice', color: 'text-green-600' };
        return { label: 'Beginner', color: 'text-foreground' };
      })()
    : null;

  const percentage_table = valid
    ? [100, 95, 90, 85, 80, 75, 70, 65, 60].map((pct) => ({
        pct,
        weight: Math.round((avgE1RM * pct) / 100),
        approxReps: Math.round(30 / (pct / 100 * 30 / (avgE1RM / w - 1) || 10)),
      }))
    : [];

  return (
    <>
      <SEO
        title="One Rep Max Calculator (e1RM) — Free Strength Tool"
        description="Calculate your one rep max instantly. Enter any weight and reps — get e1RM across Epley, Brzycki, Mayhew and 2 more formulas. Plus strength level benchmarks vs your bodyweight."
        canonical="/tools/e1rm-calculator"
        jsonLd={JSON_LD}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
          {/* Header */}
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <Calculator size={12} /> FREE TOOL
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
              One Rep Max Calculator
            </h1>
            <p className="text-muted-foreground text-base max-w-xl mx-auto">
              Enter any weight × rep combination and instantly estimate your 1RM using 5 validated formulas. Includes a percentage table for programming.
            </p>
          </div>

          {/* Input card */}
          <Card className="p-6 mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">WEIGHT</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="135"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
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
                <label className="block text-xs font-semibold text-muted-foreground mb-1">REPS</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  placeholder="5"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">BODYWEIGHT (optional)</label>
                <input
                  type="number"
                  min={1}
                  placeholder="185"
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">LIFT</label>
                <div className="relative">
                  <select
                    value={lift}
                    onChange={(e) => setLift(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  >
                    {Object.keys(STRENGTH_LEVELS).map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            {!valid && (
              <p className="text-xs text-muted-foreground">
                Enter a weight and reps (1–30) to see your estimated 1RM.
              </p>
            )}
          </Card>

          {/* Results */}
          {valid && (
            <>
              {/* Big result */}
              <div className="text-center mb-6">
                <p className="text-xs font-semibold text-muted-foreground mb-1">ESTIMATED 1RM (avg)</p>
                <p className="text-5xl font-extrabold text-foreground">
                  {avgE1RM} <span className="text-2xl font-semibold text-muted-foreground">{unit}</span>
                </p>
                {bwRatio && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {bwRatio}× bodyweight
                    {levelLabel && (
                      <span className={`ml-2 font-semibold ${levelLabel.color}`}>
                        — {levelLabel.label}
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Formula breakdown */}
              <Card className="p-5 mb-6">
                <h2 className="text-sm font-semibold text-foreground mb-3">Formula Breakdown</h2>
                <div className="space-y-2">
                  {results.map((r) => (
                    <div key={r.name} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{r.name}</span>
                      <span className="font-semibold text-foreground">{r.e1rm} {unit}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Percentage table */}
              <Card className="p-5 mb-8">
                <h2 className="text-sm font-semibold text-foreground mb-3">Training Percentage Table</h2>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-xs font-semibold text-muted-foreground">% of 1RM</div>
                  <div className="text-xs font-semibold text-muted-foreground">Weight ({unit})</div>
                  <div className="text-xs font-semibold text-muted-foreground">~Reps</div>
                  {[100, 95, 90, 85, 80, 75, 70, 65, 60].map((pct) => {
                    const wt = Math.round((avgE1RM * pct) / 100);
                    const approxReps = pct >= 100 ? 1 : pct >= 95 ? 2 : pct >= 90 ? 3 : pct >= 85 ? 5 : pct >= 80 ? 6 : pct >= 75 ? 8 : pct >= 70 ? 10 : pct >= 65 ? 12 : 15;
                    return (
                      <>
                        <div key={`pct-${pct}`} className="text-sm text-foreground">{pct}%</div>
                        <div key={`wt-${pct}`} className="text-sm font-semibold text-foreground">{wt}</div>
                        <div key={`rp-${pct}`} className="text-sm text-muted-foreground">{approxReps}</div>
                      </>
                    );
                  })}
                </div>
              </Card>
            </>
          )}

          {/* CTA */}
          <div className="rounded-2xl bg-foreground text-background p-6 text-center">
            <h2 className="text-lg font-bold mb-2">Want to know why your 1RM is stuck?</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Axiom pinpoints the exact weak link in your lift and gives you a targeted program to fix it — free.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">
                Get my free lift diagnostic <ArrowRight size={14} className="ml-1" />
              </Link>
            </Button>
          </div>

          {/* Educational content */}
          <div className="mt-12 prose prose-sm max-w-none">
            <h2 className="text-xl font-bold text-foreground mb-4">What is a One Rep Max (1RM)?</h2>
            <p className="text-muted-foreground mb-4">
              Your one rep max (1RM) is the maximum weight you can lift for a single repetition with good form. It's the gold standard for measuring absolute strength and is used to prescribe training loads as percentages.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">Which formula is most accurate?</h3>
            <p className="text-muted-foreground mb-4">
              For sets of <strong>1–5 reps</strong>, all formulas are very close. The <strong>Epley formula</strong> (1 + reps/30) is the most widely used and performs well across most rep ranges. The <strong>Brzycki formula</strong> is more conservative at higher reps. We recommend using the average of all formulas as your working estimate.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">Why keep reps under 10?</h3>
            <p className="text-muted-foreground mb-4">
              e1RM accuracy drops significantly above 10 reps because other factors (muscular endurance, glycolytic capacity) start contributing more to performance than pure strength. For the most accurate e1RM estimate, use a 3–6 rep set at a challenging but submaximal weight.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">How to use training percentages</h3>
            <p className="text-muted-foreground">
              Most strength programs prescribe loads as percentages of your 1RM. Working at 80–85% of 1RM (roughly 6–8 reps) is the classic hypertrophy range. Strength-focused work sits at 85–95% (1–5 reps). Technique and volume work is typically 65–75% (10–15 reps).
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
