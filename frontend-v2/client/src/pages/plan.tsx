import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Clipboard, Dumbbell, Shield, Sparkles, Loader2, Target, Eye, TrendingUp, Activity, BarChart2, Zap, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { liftCoachApi, WorkoutPlan } from "@/lib/api";
import { Navbar } from "@/components/Navbar";
import { StrengthRadar } from "@/components/StrengthRadar";
import { PhaseBreakdown } from "@/components/PhaseBreakdown";
import { HypothesisRankings } from "@/components/HypothesisRankings";
import { EfficiencyGauge } from "@/components/EfficiencyGauge";
import { ResultsChat } from "@/components/ResultsChat";
import { ShareAnalysis } from "@/components/ShareAnalysis";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { AccessoryVideoCard } from "@/components/AccessoryVideoCard";
import { useAuth } from "@/context/AuthContext";


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white/60 p-4 shadow-xs backdrop-blur dark:bg-white/5">
      <div className="text-xs font-semibold text-muted-foreground" data-testid={`text-stat-label-${label.replace(/\s+/g, "-").toLowerCase()}`}>
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold" data-testid={`text-stat-value-${label.replace(/\s+/g, "-").toLowerCase()}`}>
        {value}
      </div>
    </div>
  );
}

function formatLiftName(id: string): string {
  return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export default function Plan() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const selectedLift = localStorage.getItem("liftoff_selected_lift") || "";
  const sessionId = localStorage.getItem("liftoff_session_id") || "";

  const selectedLiftLabel = (() => {
    switch (selectedLift) {
      case "flat_bench_press": return "Flat Bench Press";
      case "incline_bench_press": return "Incline Bench Press";
      case "deadlift": return "Deadlift";
      case "barbell_back_squat":
      case "back_squat": return "Barbell Back Squat";
      case "barbell_front_squat":
      case "front_squat": return "Barbell Front Squat";
      default: return "Selected Lift";
    }
  })();

  useEffect(() => {
    loadPlan();
  }, []);

  async function loadPlan() {
    const sessionId = localStorage.getItem("liftoff_session_id");
    if (!sessionId) {
      setError("No session found. Please start from the beginning.");
      toast.error("No session found");
      setLocation("/onboarding");
      return;
    }

    // Check localStorage cache first
    const cacheKey = `liftoff_plan_${sessionId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setPlan(JSON.parse(cached));
        setLoading(false);
        return;
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }

    setLoading(true);
    try {
      // Try to load already-generated plan first (no API cost, no rate limit)
      try {
        const cached = await liftCoachApi.getCachedPlan(sessionId);
        setPlan(cached.plan);
        localStorage.setItem(cacheKey, JSON.stringify(cached.plan));
        return;
      } catch {
        // No cached plan — generate a new one
      }
      const response = await liftCoachApi.generatePlan(sessionId);
      setPlan(response.plan);
      localStorage.setItem(cacheKey, JSON.stringify(response.plan));
    } catch (err: any) {
      console.error("Failed to generate plan:", err);
      if (err.status === 429) {
        setRateLimited(true);
      } else {
        setError("Failed to generate plan. Please try again.");
        toast.error("Failed to generate plan");
      }
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!plan) return;

    const primary = plan.bench_day_plan.primary_lift;
    const diag = plan.diagnosis[0];

    const text = [
      `LiftOff - ${selectedLiftLabel} Plan`,
      "",
      `Diagnosis: ${diag?.limiterName || "Unknown"}`,
      ...(diag?.evidence || []).map(e => `  • ${e}`),
      "",
      `Primary Lift: ${primary.exercise_name}`,
      `  ${primary.sets} x ${primary.reps} @ ${primary.intensity} (Rest: ${primary.rest_minutes} min)`,
      "",
      "Accessories:",
      ...plan.bench_day_plan.accessories.map(a =>
        `  • ${a.exercise_name}: ${a.sets} x ${a.reps} [${a.category}]\n    ${a.why}`
      ),
      "",
      "Progression Rules:",
      ...plan.progression_rules.map(r => `  • ${r}`),
      "",
      "Track Next Time:",
      ...plan.track_next_time.map(t => `  • ${t}`),
    ].join("\n");

    navigator.clipboard.writeText(text).then(() => {
      toast.success("Plan copied to clipboard");
    });
  }

  function startNewSession() {
    localStorage.removeItem("liftoff_session_id");
    localStorage.removeItem("liftoff_selected_lift");
    localStorage.removeItem("liftoff_target_lift_weight");
    localStorage.removeItem("liftoff_target_lift_sets");
    localStorage.removeItem("liftoff_target_lift_reps");
    setLocation("/mvp");
    toast.success("Starting new session");
  }

  if (loading) {
    return (
      <div className="min-h-screen grid-fade">
        <Navbar variant="step" title="Your lift-day plan" subtitle="Diagnosis, prescription, and what to track" stepLabel="Step 4 of 4" />
        <main className="mx-auto max-w-6xl px-4 py-10">
          <Card className="glass p-12">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border bg-primary/10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Generating Your Personalized Plan</h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-md">
                  Our AI is analyzing your lift mechanics, working weights, and diagnostic responses to identify your weak points and prescribe targeted accessories...
                </p>
              </div>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  if (rateLimited) {
    return (
      <div className="min-h-screen grid-fade">
        <Navbar variant="step" title="Your lift-day plan" subtitle="Diagnosis, prescription, and what to track" stepLabel="Step 4 of 4" />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <UpgradePrompt userId={user?.id} />
        </main>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="min-h-screen grid-fade">
        <Navbar variant="step" title="Your lift-day plan" subtitle="Diagnosis, prescription, and what to track" stepLabel="Step 4 of 4" />
        <main className="mx-auto max-w-6xl px-4 py-10">
          <Card className="glass p-12">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border bg-destructive/10">
                <Shield className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Failed to Generate Plan</h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-md">
                  {error || "Something went wrong. Please try again."}
                </p>
              </div>
              <div className="mt-4 flex gap-3">
                <Button onClick={loadPlan}>Try Again</Button>
                <Button variant="secondary" onClick={startNewSession}>Start Over</Button>
              </div>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const primaryDiagnosis = plan.diagnosis[0];
  const primary = plan.bench_day_plan.primary_lift;
  const accessories = plan.bench_day_plan.accessories;

  return (
    <div className="min-h-screen grid-fade">
      <Header />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <ResultsChat
          plan={plan}
          resultsContent={
            <>
        <Card className="glass mb-4 p-6 border-primary/20 bg-primary/5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-primary mb-2">AI Analysis Complete</h3>
              <div className="space-y-2 text-sm">
                <p className="leading-relaxed">
                  <strong className="text-foreground">Limiting factor:</strong>{' '}
                  <strong className="text-foreground">{primaryDiagnosis?.limiterName || "Unknown"}</strong>
                  {primaryDiagnosis?.confidence && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {Math.round(primaryDiagnosis.confidence * 100)}% confidence
                    </Badge>
                  )}
                </p>
                <p className="leading-relaxed text-muted-foreground">
                  {primaryDiagnosis?.evidence?.[0] || "Analysis based on your lift data and diagnostic responses."}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"
        >
          <Card className="glass relative overflow-hidden p-6">
            <div className="pointer-events-none absolute inset-0 noise" />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                    <Dumbbell className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground" data-testid="text-selected-lift-label">
                      Selected lift
                    </div>
                    <div className="mt-1 font-serif text-2xl" data-testid="text-selected-lift">
                      {selectedLiftLabel}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <ShareAnalysis sessionId={sessionId} />
                  <Link href="/history">
                    <Button variant="outline" size="sm" className="shadow-xs">
                      <History className="mr-2 h-4 w-4" />
                      History
                    </Button>
                  </Link>
                  <Button
                    variant="secondary"
                    className="shadow-xs"
                    onClick={copy}
                    data-testid="button-copy-plan"
                  >
                    <Clipboard className="mr-2 h-4 w-4" />
                    Copy plan
                  </Button>
                  <Button
                    className="shadow-sm"
                    onClick={startNewSession}
                    data-testid="button-new-session"
                  >
                    New session
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Stat label="Limiter" value={primaryDiagnosis?.limiterName || "Unknown"} />
                <Stat label="Confidence" value={primaryDiagnosis ? `${Math.round(primaryDiagnosis.confidence * 100)}%` : "N/A"} />
                <Stat label="Accessories" value={`${accessories.length}`} />
              </div>

              <Separator className="my-6" />

              <div className="grid gap-4">
                <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold" data-testid="text-diagnosis-title">
                        Diagnosis
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground" data-testid="text-diagnosis-subtitle">
                        Identified weak points based on your data and responses
                      </div>
                    </div>
                    <Badge variant="secondary" data-testid="badge-explainable">
                      Data-Driven
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    {plan.diagnosis.map((d, idx) => (
                      <div key={idx} className="rounded-2xl border bg-white/60 p-4 shadow-xs backdrop-blur dark:bg-white/5" data-testid={`card-diagnosis-${idx}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-base font-semibold" data-testid={`text-limiter-${idx}`}>
                            {d.limiterName}
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {Math.round(d.confidence * 100)}%
                          </Badge>
                        </div>
                        <ul className="space-y-2">
                          {d.evidence.map((e, eIdx) => (
                            <li key={eIdx} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" strokeWidth={1.8} />
                              <span>{e}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* ── Diagnostic Visualizations ── */}
                {plan.diagnostic_signals && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Strength Profile Radar */}
                    {Object.keys(plan.diagnostic_signals.indices).length > 0 && (
                      <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="grid h-8 w-8 place-items-center rounded-lg border bg-white/70 shadow-xs dark:bg-white/5">
                            <Activity className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Strength Profile</div>
                            <div className="text-xs text-muted-foreground">Muscle group indices (0–100)</div>
                          </div>
                        </div>
                        <StrengthRadar
                          signals={plan.diagnostic_signals}
                          liftId={plan.selected_lift}
                        />
                      </Card>
                    )}

                    {/* Phase Breakdown */}
                    <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="grid h-8 w-8 place-items-center rounded-lg border bg-white/70 shadow-xs dark:bg-white/5">
                          <BarChart2 className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">Lift Phase Breakdown</div>
                          <div className="text-xs text-muted-foreground">Where the signal is strongest</div>
                        </div>
                      </div>
                      <PhaseBreakdown
                        phaseScores={plan.diagnostic_signals.phase_scores}
                        primaryPhase={plan.diagnostic_signals.primary_phase}
                        primaryPhaseConfidence={plan.diagnostic_signals.primary_phase_confidence}
                        liftId={plan.selected_lift}
                      />
                    </Card>
                  </div>
                )}

                {/* Hypothesis Rankings */}
                {plan.diagnostic_signals && plan.diagnostic_signals.hypothesis_scores.length > 0 && (
                  <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="grid h-8 w-8 place-items-center rounded-lg border bg-white/70 shadow-xs dark:bg-white/5">
                        <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">Weakness Hypotheses</div>
                        <div className="text-xs text-muted-foreground">Ranked by diagnostic confidence</div>
                      </div>
                    </div>
                    <HypothesisRankings hypotheses={plan.diagnostic_signals.hypothesis_scores} />
                  </Card>
                )}

                <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                      <Target className="h-4 w-4 text-primary" strokeWidth={1.8} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" data-testid="text-primary-lift-title">
                        Primary Lift
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Your main movement for the session
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border bg-white/60 p-4 shadow-xs backdrop-blur dark:bg-white/5">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="text-base font-semibold">{primary.exercise_name}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {primary.sets} x {primary.reps}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {primary.intensity}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Rest {primary.rest_minutes} min
                        </Badge>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                      <Shield className="h-4 w-4 text-primary" strokeWidth={1.8} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" data-testid="text-prescription-title">
                        Accessories
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground" data-testid="text-prescription-subtitle">
                        Ranked by impact — prioritize the top ones if short on time
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {[...accessories]
                      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
                      .map((a, idx) => {
                        const isTopPick = a.priority === 1;
                        const impactColor =
                          a.impact === 'high'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                            : a.impact === 'medium'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                            : 'bg-muted text-muted-foreground';

                        return (
                          <div
                            key={a.exercise_id || idx}
                            className={`rounded-2xl border p-4 shadow-xs backdrop-blur ${
                              isTopPick
                                ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                                : 'bg-white/60 dark:bg-white/5'
                            }`}
                            data-testid={`card-accessory-${idx}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                {isTopPick ? (
                                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                                    ★
                                  </span>
                                ) : (
                                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                    {idx + 1}
                                  </span>
                                )}
                                <div className="text-base font-semibold" data-testid={`text-accessory-exercise-${idx}`}>
                                  {a.exercise_name}
                                </div>
                                {isTopPick && (
                                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                    Most Impactful
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {a.impact && (
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${impactColor}`}>
                                    {a.impact} impact
                                  </span>
                                )}
                                <Badge variant="secondary" className="text-xs" data-testid={`text-accessory-volume-${idx}`}>
                                  {a.sets} x {a.reps}
                                </Badge>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {a.category}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm" data-testid={`text-accessory-why-${idx}`}>
                              <div className="grid h-5 w-5 mt-0.5 flex-shrink-0 place-items-center rounded-full bg-primary/10">
                                <span className="text-xs font-bold text-primary">→</span>
                              </div>
                              <div className="leading-relaxed">
                                <span className="text-muted-foreground">{a.why}</span>
                              </div>
                            </div>
                            {a.exercise_id && (
                              <AccessoryVideoCard
                                exerciseId={a.exercise_id}
                                exerciseName={a.exercise_name}
                              />
                            )}
                          </div>
                        );
                      })}
                  </div>
                </Card>
              </div>
            </div>
          </Card>

          <div className="grid gap-4">
            <Card className="glass p-6">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                  <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">
                    Progression
                  </div>
                  <div className="mt-1 font-serif text-2xl">
                    Progression Rules
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm text-muted-foreground">
                {plan.progression_rules.map((rule, idx) => (
                  <div className="flex items-start gap-3" key={idx}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" strokeWidth={1.8} />
                    <p>{rule}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="glass p-6">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                  <Eye className="h-4 w-4 text-primary" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">
                    What to Watch
                  </div>
                  <div className="mt-1 font-serif text-2xl">
                    Track Next Time
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm text-muted-foreground">
                {plan.track_next_time.map((item, idx) => (
                  <div className="flex items-start gap-3" key={idx}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" strokeWidth={1.8} />
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </Card>

            {plan.dominance_archetype && (
              <Card className="glass p-6">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                    <Activity className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground">
                      Strength Profile
                    </div>
                    <div className="mt-1 font-serif text-xl">
                      {plan.dominance_archetype.label}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                  {plan.dominance_archetype.rationale}
                </p>
              </Card>
            )}

            {plan.diagnostic_signals?.efficiency_score && (
              <Card className="glass p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                    <TrendingUp className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground">
                      Strength Balance
                    </div>
                    <div className="font-serif text-xl">
                      Balance Score
                    </div>
                  </div>
                </div>
                <EfficiencyGauge
                  score={plan.diagnostic_signals.efficiency_score.score}
                  explanation={plan.diagnostic_signals.efficiency_score.explanation}
                  deductions={plan.diagnostic_signals.efficiency_score.deductions}
                />
              </Card>
            )}

            {plan.validation_test && (
              <Card className="glass p-6">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                    <Target className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground">
                      Validation Test
                    </div>
                    <div className="mt-1 font-serif text-xl">
                      {plan.validation_test.description}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How to run</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {plan.validation_test.how_to_run}
                  </p>
                  <Badge variant="secondary" className="text-xs mt-2">
                    Tests: {plan.validation_test.hypothesis_tested}
                  </Badge>
                </div>
              </Card>
            )}

            <div className="flex justify-center">
              <Button
                size="lg"
                className="shadow-sm w-full"
                onClick={startNewSession}
                data-testid="button-new-session-bottom"
              >
                Start New Session
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.div>
            </>
          }
        />
      </main>
    </div>
  );
}
