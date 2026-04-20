import { useState } from "react";
import { Link } from "wouter";
import { Trophy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

// Wilks coefficients
const WILKS_MALE   = [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8];
const WILKS_FEMALE = [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8];

function wilksCoeff(bw: number, male: boolean): number {
  const c = male ? WILKS_MALE : WILKS_FEMALE;
  const denom = c[0] + c[1]*bw + c[2]*bw**2 + c[3]*bw**3 + c[4]*bw**4 + c[5]*bw**5;
  return 500 / denom;
}

// Dots coefficients (newer formula, also widely used)
const DOTS_MALE   = [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093];
const DOTS_FEMALE = [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706];

function dotsCoeff(bw: number, male: boolean): number {
  const c = male ? DOTS_MALE : DOTS_FEMALE;
  const denom = c[0] + c[1]*bw + c[2]*bw**2 + c[3]*bw**3 + c[4]*bw**4;
  return 500 / denom;
}

const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Wilks Score Calculator",
    "url": "https://axiomtraining.io/tools/wilks-calculator",
    "description": "Free Wilks and Dots score calculator for powerlifters. Compare your total across weight classes. Enter bodyweight, squat, bench, and deadlift to see your Wilks and Dots coefficients.",
    "applicationCategory": "HealthApplication",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What is a good Wilks score?",
        "acceptedAnswer": { "@type": "Answer", "text": "A Wilks score under 200 is recreational, 200–300 is novice competitor level, 300–380 is intermediate competitive, 380–450 is advanced or national-level, and 450+ is considered elite or world-class. Most recreational lifters score between 150 and 300." }
      },
      {
        "@type": "Question",
        "name": "What is the difference between Wilks and Dots?",
        "acceptedAnswer": { "@type": "Answer", "text": "Both Wilks and Dots are bodyweight-adjusted strength scores for powerlifters, but Dots uses a newer dataset and is considered more accurate at very light and very heavy bodyweights. The IPF (International Powerlifting Federation) adopted Dots as its official scoring system in 2020, replacing Wilks." }
      },
      {
        "@type": "Question",
        "name": "Which formula does the IPF use?",
        "acceptedAnswer": { "@type": "Answer", "text": "The IPF switched from Wilks to the Dots formula in 2020 for both equipped and classic (raw) powerlifting competitions. Dots is now the standard for IPF-affiliated meets worldwide, though many non-IPF federations still use Wilks." }
      },
      {
        "@type": "Question",
        "name": "How do I compare my powerlifting total across weight classes?",
        "acceptedAnswer": { "@type": "Answer", "text": "Use the Wilks or Dots score, which normalizes your total (squat + bench + deadlift) for your bodyweight. A higher score means relatively stronger pound-for-pound. This allows fair comparison between a 60kg lifter and a 100kg lifter regardless of absolute weight on the bar." }
      }
    ]
  }
];

export default function WilksCalculatorPage() {
  const [bw, setBw] = useState('');
  const [squat, setSquat] = useState('');
  const [bench, setBench] = useState('');
  const [deadlift, setDeadlift] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs');

  const toLbs = (v: number) => unit === 'kg' ? v * 2.2046 : v;
  const toKg  = (v: number) => unit === 'lbs' ? v / 2.2046 : v;

  const bwNum = parseFloat(bw);
  const totalNum = (parseFloat(squat) || 0) + (parseFloat(bench) || 0) + (parseFloat(deadlift) || 0);
  const bwKg = toKg(bwNum);
  const totalKg = toKg(totalNum);

  const valid = bwKg > 20 && totalKg > 0;

  const wilks = valid ? Math.round(wilksCoeff(bwKg, gender === 'male') * totalKg * 10) / 10 : 0;
  const dots  = valid ? Math.round(dotsCoeff(bwKg, gender === 'male') * totalKg * 10) / 10 : 0;

  const wilksRating = wilks >= 450 ? { label: 'Elite', color: 'text-yellow-600' }
    : wilks >= 380 ? { label: 'Advanced', color: 'text-purple-600' }
    : wilks >= 300 ? { label: 'Intermediate', color: 'text-blue-600' }
    : wilks >= 200 ? { label: 'Novice', color: 'text-green-600' }
    : wilks > 0    ? { label: 'Beginner', color: 'text-foreground' }
    : null;

  return (
    <>
      <SEO
        title="Wilks Score Calculator — Powerlifting Strength Comparison"
        description="Calculate your Wilks and Dots score instantly. Compare your powerlifting total across all weight classes. Free bodyweight-adjusted strength calculator for squat, bench, and deadlift totals."
        canonical="/tools/wilks-calculator"
        jsonLd={JSON_LD}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <Trophy size={12} /> FREE TOOL
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
              Wilks Score Calculator
            </h1>
            <p className="text-muted-foreground text-base max-w-xl mx-auto">
              Calculate your Wilks and Dots coefficients to compare your powerlifting total across weight classes and genders.
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
                <label className="block text-xs font-semibold text-muted-foreground mb-1">UNIT</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(['lbs', 'kg'] as const).map((u) => (
                    <button key={u} onClick={() => setUnit(u)}
                      className={`flex-1 py-2 text-sm font-semibold transition-colors ${unit === u ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'}`}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'BODYWEIGHT', value: bw, set: setBw },
                { label: 'SQUAT (1RM)', value: squat, set: setSquat },
                { label: 'BENCH PRESS (1RM)', value: bench, set: setBench },
                { label: 'DEADLIFT (1RM)', value: deadlift, set: setDeadlift },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">{label} ({unit})</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="0"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </div>
              ))}
            </div>
          </Card>

          {valid && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <Card className="p-5 text-center">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">WILKS SCORE</p>
                  <p className="text-4xl font-extrabold text-foreground">{wilks}</p>
                  {wilksRating && <p className={`text-sm font-semibold mt-1 ${wilksRating.color}`}>{wilksRating.label}</p>}
                </Card>
                <Card className="p-5 text-center">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">DOTS SCORE</p>
                  <p className="text-4xl font-extrabold text-foreground">{dots}</p>
                  <p className="text-xs text-muted-foreground mt-1">IPF standard (2020+)</p>
                </Card>
              </div>

              <Card className="p-4 mb-6">
                <p className="text-xs font-semibold text-muted-foreground mb-2">TOTAL</p>
                <p className="text-2xl font-bold text-foreground">{Math.round(totalNum)} {unit} <span className="text-sm font-normal text-muted-foreground">({Math.round(totalKg)} kg)</span></p>
              </Card>

              <Card className="p-4 mb-8">
                <h2 className="text-sm font-semibold text-foreground mb-3">Wilks Score Benchmarks</h2>
                {[
                  { label: 'Recreational', range: '< 200', color: 'text-foreground' },
                  { label: 'Novice competitor', range: '200–300', color: 'text-green-600' },
                  { label: 'Intermediate competitor', range: '300–380', color: 'text-blue-600' },
                  { label: 'Advanced / national-level', range: '380–450', color: 'text-purple-600' },
                  { label: 'Elite / world-class', range: '450+', color: 'text-yellow-600' },
                ].map(({ label, range, color }) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-border last:border-0 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-semibold ${color}`}>{range}</span>
                  </div>
                ))}
              </Card>
            </>
          )}

          <div className="rounded-2xl bg-foreground text-background p-6 text-center mb-12">
            <h2 className="text-lg font-bold mb-2">Want a bigger total?</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Axiom diagnoses the exact weak link limiting each of your lifts and builds a targeted program to address it.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">Get my free lift diagnostic <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>

          <div className="prose prose-sm max-w-none">
            <h2 className="text-xl font-bold text-foreground mb-4">What is the Wilks score?</h2>
            <p className="text-muted-foreground mb-4">
              The Wilks score is a formula developed by Robert Wilks that adjusts a powerlifter's total for bodyweight, allowing comparison across weight classes. A Wilks of 300 for a 60kg lifter represents the same relative strength as 300 for a 120kg lifter.
            </p>
            <h3 className="text-base font-semibold text-foreground mb-2">Wilks vs Dots</h3>
            <p className="text-muted-foreground">
              The Dots formula was adopted by the IPF (International Powerlifting Federation) in 2020 to replace Wilks. Dots uses an updated dataset and is considered slightly more accurate at very light and very heavy bodyweights. Both are widely used, but Dots is now the official IPF standard for equipped and classic powerlifting.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
