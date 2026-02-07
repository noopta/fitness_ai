import { useMemo, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Clipboard, Dumbbell, Shield, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { liftCoachApi, WorkoutPlan } from "@/lib/api";

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/">
          <a className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            <span className="grid h-9 w-9 place-items-center rounded-xl border bg-gradient-to-br from-primary to-blue-600 shadow-xs">
              <span className="font-bold text-lg text-white">LO</span>
            </span>
            <div>
              <div className="text-sm font-semibold" data-testid="text-plan-title">
                Your lift-day plan
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-plan-subtitle">
                Diagnosis, prescription, and what to track
              </div>
            </div>
          </a>
        </Link>

        <div className="hidden text-xs text-muted-foreground sm:block" data-testid="text-step">
          Step 4 of 4
        </div>
      </div>
    </header>
  );
}

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

export default function Plan() {
  const [, setLocation] = useLocation();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    setLoading(true);
    try {
      console.log("Generating AI plan for session:", sessionId);
      const response = await liftCoachApi.generatePlan(sessionId);
      setPlan(response.plan);
      console.log("AI Plan generated:", response.plan);
    } catch (err) {
      console.error("Failed to generate plan:", err);
      setError("Failed to generate plan. Please try again.");
      toast.error("Failed to generate plan");
    } finally {
      setLoading(false);
    }
  }

  const selectedLiftLabel = useMemo(() => {
    if (!plan) return "Selected Lift";
    
    switch (plan.selected_lift) {
      case "flat_bench_press":
        return "Flat Bench Press";
      case "incline_bench_press":
        return "Incline Bench Press";
      case "deadlift":
        return "Deadlift";
      case "barbell_back_squat":
      case "back_squat":
        return "Barbell Back Squat";
      case "barbell_front_squat":
      case "front_squat":
        return "Barbell Front Squat";
      default:
        return "Selected lift";
    }
  }, [plan]);

  function copy() {
    if (!plan) return;
    
    const text = `LiftOff — Plan\n\nSelected lift: ${selectedLiftLabel}\n\nDiagnosis:\n${plan.diagnosis
      .map(
        (d) => `- ${d.limiterName} (${Math.round(d.confidence * 100)}%)\n  Evidence: ${d.evidence.join(", ")}`,
      )
      .join("\n")}\n\nPrimary lift:\n- ${plan.bench_day_plan.primary_lift.exercise_name}: ${plan.bench_day_plan.primary_lift.sets}x${plan.bench_day_plan.primary_lift.reps} @ ${plan.bench_day_plan.primary_lift.intensity}\n\nAccessories:\n${plan.bench_day_plan.accessories
      .map((a) => `- ${a.exercise_name}: ${a.sets}x${a.reps} — ${a.why}`)
      .join("\n")}\n\nProgression:\n${plan.progression_rules
      .map((r) => `- ${r}`)
      .join("\n")}\n\nTrack next time:\n${plan.track_next_time
      .map((t) => `- ${t}`)
      .join("\n")}`;

    navigator.clipboard.writeText(text).then(() => {
      toast.success("Plan copied to clipboard");
    });
  }

  function startNewSession() {
    // Clear all session data
    localStorage.removeItem("liftoff_session_id");
    localStorage.removeItem("liftoff_selected_lift");
    localStorage.removeItem("liftoff_target_lift_weight");
    localStorage.removeItem("liftoff_target_lift_sets");
    localStorage.removeItem("liftoff_target_lift_reps");
    
    // Navigate to onboarding to start fresh
    setLocation("/mvp");
    
    toast.success("Starting new session");
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen grid-fade">
        <Header />
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

  // Error state
  if (error || !plan) {
    return (
      <div className="min-h-screen grid-fade">
        <Header />
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

  return (
    <div className="min-h-screen grid-fade">
      <Header />

      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* AI Summary Banner */}
        <Card className="glass mb-4 p-6 border-primary/20 bg-primary/5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-primary mb-2">AI Analysis Complete</h3>
              <div className="space-y-2 text-sm">
                <p className="leading-relaxed">
                  <strong className="text-foreground">Your limiting factor{plan.diagnosis.length > 1 ? 's' : ''}:</strong>{' '}
                  {plan.diagnosis.map((d, i) => (
                    <span key={i}>
                      <strong className="text-foreground">{d.limiterName || d.limiter}</strong>
                      {i < plan.diagnosis.length - 1 && (plan.diagnosis.length > 2 ? ', ' : ' and ')}
                    </span>
                  ))}
                </p>
                <p className="leading-relaxed">
                  <strong className="text-foreground">Prescribed accessories:</strong>{' '}
                  {plan.bench_day_plan.accessories.map((a, i) => (
                    <span key={i}>
                      {a.exercise_name}
                      {i < plan.bench_day_plan.accessories.length - 1 && (plan.bench_day_plan.accessories.length > 2 ? ', ' : ' and ')}
                    </span>
                  ))}
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  These exercises target your weak points to improve your {selectedLiftLabel} performance.
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

                <div className="flex items-center gap-2">
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
                <Stat label="Limiters" value={`${plan.diagnosis.length}`} />
                <Stat label="Accessories" value={`${plan.bench_day_plan.accessories.length}`} />
                <Stat label="Intensity" value={plan.bench_day_plan.primary_lift.intensity} />
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

                  <div className="mt-4 grid gap-3">
                    {plan.diagnosis.map((d, idx) => (
                      <div
                        key={d.limiter || idx}
                        className="rounded-2xl border bg-white/60 p-4 shadow-xs backdrop-blur dark:bg-white/5"
                        data-testid={`card-diagnosis-${idx}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="text-base font-semibold" data-testid={`text-limiter-${idx}`}>
                            {d.limiterName || d.limiter?.replace(/_/g, " ")}
                          </div>
                          <span className="inline-flex items-center gap-2 rounded-full border bg-white/50 px-3 py-1 text-xs text-muted-foreground dark:bg-white/5" data-testid={`badge-confidence-${idx}`}>
                            <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
                            {Math.round(d.confidence * 100)}% confidence
                          </span>
                        </div>
                        <div className="space-y-2" data-testid={`text-evidence-${idx}`}>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evidence:</div>
                          {d.evidence.map((e, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" strokeWidth={2} />
                              <span className="leading-relaxed">{e}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="border-border/70 bg-white/60 p-5 shadow-xs backdrop-blur dark:bg-white/5">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                      <Shield className="h-4 w-4 text-primary" strokeWidth={1.8} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" data-testid="text-prescription-title">
                        Add These to Your {selectedLiftLabel} Day
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground" data-testid="text-prescription-subtitle">
                        Targeted accessories to improve your {selectedLiftLabel}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border bg-white/60 p-4 shadow-xs backdrop-blur dark:bg-white/5" data-testid="card-primary-lift">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide" data-testid="text-primary-label">
                        Primary Lift
                      </div>
                      <Badge variant="outline" className="text-xs">Focus Exercise</Badge>
                    </div>
                    <div className="text-base font-semibold mb-3" data-testid="text-primary-exercise">
                      {plan.bench_day_plan.primary_lift.exercise_name}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3 mb-3">
                      <Stat label="Sets" value={`${plan.bench_day_plan.primary_lift.sets}`} />
                      <Stat label="Reps" value={`${plan.bench_day_plan.primary_lift.reps}`} />
                      <Stat label="Rest" value={`${plan.bench_day_plan.primary_lift.rest_minutes} min`} />
                    </div>
                    <div className="text-sm text-muted-foreground" data-testid="text-primary-intensity">
                      <strong>Intensity:</strong> {plan.bench_day_plan.primary_lift.intensity}
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Accessory Exercises
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Perform these after your primary lift to target your weak points
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {plan.bench_day_plan.accessories.map((a, idx) => (
                      <div
                        key={a.exercise_name || idx}
                        className="rounded-2xl border bg-white/60 p-4 shadow-xs backdrop-blur dark:bg-white/5"
                        data-testid={`card-accessory-${idx}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="text-base font-semibold" data-testid={`text-accessory-exercise-${idx}`}>
                            {a.exercise_name}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs" data-testid={`text-accessory-volume-${idx}`}>
                              {a.sets} × {a.reps}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 text-sm" data-testid={`text-accessory-why-${idx}`}>
                          <div className="grid h-5 w-5 mt-0.5 flex-shrink-0 place-items-center rounded-full bg-primary/10">
                            <span className="text-xs font-bold text-primary">→</span>
                          </div>
                          <div className="leading-relaxed">
                            <strong className="text-foreground">Improves:</strong> <span className="text-muted-foreground">{a.why}</span>
                          </div>
                        </div>
                      </div>
                    ))}
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
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="text-progression-eyebrow">
                    Progression
                  </div>
                  <div className="mt-1 font-serif text-2xl" data-testid="text-progression-title">
                    What to do next
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-muted-foreground">
                {plan.progression_rules.map((r, idx) => (
                  <div className="flex items-start gap-3" key={r} data-testid={`row-progression-${idx}`}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" strokeWidth={1.8} />
                    <p>{r}</p>
                  </div>
                ))}
              </div>

              <Separator className="my-6" />

              <div>
                <div className="text-sm font-semibold" data-testid="text-track-title">
                  Track next session
                </div>
                <div className="mt-3 space-y-2">
                  {plan.track_next_time.map((t, idx) => (
                    <div
                      key={t}
                      className="rounded-xl border bg-white/60 px-3 py-2 text-sm text-muted-foreground shadow-xs backdrop-blur dark:bg-white/5"
                      data-testid={`chip-track-${idx}`}
                    >
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
