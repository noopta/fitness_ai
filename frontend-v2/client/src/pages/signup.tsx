import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Dumbbell,
  LineChart,
  MessageCircle,
  NotebookPen,
  Scale,
  Sparkles,
  Target,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import bodyMapFront from "@/assets/images/body-map-front.png";
import bodyMapBack from "@/assets/images/body-map-back.png";

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container-tight flex items-center justify-between py-4">
        <Link href="/" className="inline-flex items-center gap-3" data-testid="link-nav-home">
          <span className="grid h-9 w-9 place-items-center rounded-xl border bg-gradient-to-br from-primary to-blue-600 shadow-xs">
            <span className="font-bold text-lg text-white">LO</span>
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold" data-testid="text-nav-brand">
              LiftOff
            </div>
            <div className="text-xs text-muted-foreground" data-testid="text-nav-sub">
              AI-Powered Diagnostics
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/mvp">
            <Button
              asChild
              variant="secondary"
              className="rounded-xl"
              data-testid="button-nav-try-mvp"
            >
              <span>
                Try MVP
                <ChevronRight className="ml-2 h-4 w-4" />
              </span>
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function ValuePill({
  icon,
  text,
  testId,
}: {
  icon: React.ReactNode;
  text: string;
  testId: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground"
      data-testid={testId}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
  testId,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <Card className="card-min card-hover rounded-2xl p-6" data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl border bg-background">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold" data-testid={`${testId}-title`}>
            {title}
          </div>
          <div
            className="mt-1 text-sm leading-relaxed text-muted-foreground"
            data-testid={`${testId}-desc`}
          >
            {description}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ComparisonRow({
  left,
  right,
  testId,
}: {
  left: string;
  right: string;
  testId: string;
}) {
  return (
    <div
      className="grid gap-3 rounded-2xl border bg-background p-4 sm:grid-cols-2"
      data-testid={testId}
    >
      <div className="flex items-start gap-2 text-sm">
        <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border bg-background text-xs font-semibold">
          ✕
        </span>
        <div className="min-w-0">
          <div className="font-medium">Traditional apps</div>
          <div className="mt-0.5 text-muted-foreground">{left}</div>
        </div>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border bg-background text-xs font-semibold">
          ✓
        </span>
        <div className="min-w-0">
          <div className="font-medium">LiftOff</div>
          <div className="mt-0.5 text-muted-foreground">{right}</div>
        </div>
      </div>
    </div>
  );
}

const BODY_AREAS = {
  chest: {
    label: "Chest",
    status: "Strong point",
    tags: ["Pressing", "Upper body"],
    workouts: ["Paused bench press", "DB incline press", "Cable fly (controlled)"],
  },
  shoulders: {
    label: "Shoulders",
    status: "Needs work",
    tags: ["Stability", "Overhead strength"],
    workouts: ["Seated DB press", "Lateral raises (strict)", "Face pulls"],
  },
  quads: {
    label: "Quads",
    status: "Needs work",
    tags: ["Squat carryover", "Knee extension"],
    workouts: ["High-bar squat", "Hack squat", "Leg extensions"],
  },
  core: {
    label: "Core",
    status: "Strong point",
    tags: ["Bracing", "Transfer"],
    workouts: ["Dead bug", "Cable crunch", "Pallof press"],
  },
  lats: {
    label: "Lats",
    status: "Needs work",
    tags: ["Deadlift setup", "Upper back"],
    workouts: ["Lat pulldown (tempo)", "Chest-supported row", "Straight-arm pulldown"],
  },
  "upper-back": {
    label: "Upper back",
    status: "Strong point",
    tags: ["Posture", "Scap control"],
    workouts: ["Seal row", "Rear delt fly", "Band pull-aparts"],
  },
  glutes: {
    label: "Glutes",
    status: "Needs work",
    tags: ["Hip extension", "Lockout"],
    workouts: ["Romanian deadlift", "Hip thrust", "Back extensions"],
  },
  hamstrings: {
    label: "Hamstrings",
    status: "Needs work",
    tags: ["Posterior chain", "Speed"],
    workouts: ["Seated leg curl", "Nordic curl (scaled)", "Good mornings"],
  },
} as const;

type BodyAreaKey = keyof typeof BODY_AREAS;

export default function Signup() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedArea, setSelectedArea] = useState<BodyAreaKey>("shoulders");

  const selectedAreaMeta = BODY_AREAS[selectedArea];
  const selectedAreaLabel = selectedAreaMeta.label;

  const isValidEmail = useMemo(() => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }, [email]);

  async function submit() {
    if (!isValidEmail) {
      toast.error("Please enter a valid email.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (response.ok) {
        toast.success("🎉 You've joined the waitlist! Check your email for confirmation.");
        setEmail("");
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("Waitlist error:", errorData);
        toast.error(errorData.error || "Something went wrong. Please try again.");
      }
    } catch (error) {
      console.error("Waitlist signup error:", error);
      toast.error("Failed to join waitlist. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Nav />

      <main className="container-tight">
        <section className="py-16 sm:py-24">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ValuePill
                icon={<Zap className="h-3.5 w-3.5" />}
                text="Lift phase analysis"
                testId="badge-value-ai"
              />
              <ValuePill
                icon={<Scale className="h-3.5 w-3.5" />}
                text="Strength ratio insights"
                testId="badge-value-prescription"
              />
              <ValuePill
                icon={<Target className="h-3.5 w-3.5" />}
                text="Targeted accessories"
                testId="badge-value-bodymap"
              />
            </div>

            <h1
              className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl"
              data-testid="text-signup-hero-title"
            >
              Break through your plateau.
              <span className="text-muted-foreground"> One lift at a time.</span>
            </h1>

            <p
              className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
              data-testid="text-signup-hero-subtitle"
            >
              Stuck on your bench, squat, or deadlift? Traditional coaches analyze your mechanics in person—expensive and time-consuming. LiftOff brings that expertise to AI: we feed your working weights, strength ratios, and lift biomechanics into advanced analysis to diagnose <span className="font-medium text-foreground">exactly where in the lift you're failing</span>, <span className="font-medium text-foreground">which muscles are limiting you</span>, and <span className="font-medium text-foreground">what accessories to add</span>. Highly detailed. Highly accurate. No guesswork.
            </p>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="card-min rounded-2xl p-6" data-testid="card-email">
                <div className="text-sm font-semibold" data-testid="text-email-title">
                  Get notified at launch
                </div>
                <div className="mt-1 text-sm text-muted-foreground" data-testid="text-email-subtitle">
                  Join the waitlist and be first to know when we launch.
                </div>

                <div className="mt-5 grid gap-2">
                  <Label data-testid="label-email">Email</Label>
                  <Input
                    type="email"
                    placeholder="you@domain.com"
                    className="h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                    data-testid="input-email"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    className={`rounded-xl transition-all ${
                      email.length > 0
                        ? "shadow-lg hover:shadow-xl bg-gradient-to-r from-primary to-blue-600 font-semibold cursor-pointer" 
                        : "shadow-md bg-gradient-to-r from-primary/60 to-blue-600/60 font-normal cursor-pointer"
                    }`}
                    style={{
                      opacity: email.length > 0 ? 1 : 0.6
                    }}
                    onClick={submit}
                    disabled={loading}
                    data-testid="button-join-waitlist"
                  >
                    {loading ? "Joining..." : "Join waitlist"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>

                  <Link href="/mvp">
                    <Button
                      asChild
                      variant="secondary"
                      className="rounded-xl"
                      data-testid="button-try-mvp"
                    >
                      <span>
                        Try the MVP
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </span>
                    </Button>
                  </Link>
                </div>

                <div className="mt-4 text-xs text-muted-foreground" data-testid="text-email-note">
                  You'll receive a confirmation email with early access details.
                </div>
              </Card>

              <Card className="card-min rounded-2xl p-6" data-testid="card-proof">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl border bg-background">
                    <LineChart className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold" data-testid="text-proof-title">
                      Data-driven diagnosis
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground" data-testid="text-proof-subtitle">
                      Your lifts tell the story
                    </div>
                  </div>
                </div>

                <Separator className="my-5" />

                <div className="space-y-3 text-sm text-muted-foreground">
                  {[
                    "Pinpoints where in the lift you're failing (bottom, midpoint, lockout)",
                    "Calculates strength ratios to identify muscle limiters",
                    "Prescribes specific accessories to break through your plateau",
                  ].map((t, idx) => (
                    <div
                      key={t}
                      className="flex items-start gap-3"
                      data-testid={`row-proof-${idx}`}
                    >
                      <Check className="mt-0.5 h-4 w-4 text-foreground" strokeWidth={2} />
                      <p>{t}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </motion.div>
        </section>

        <section className="pb-16 sm:pb-24" data-testid="section-compare">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold text-muted-foreground" data-testid="text-compare-eyebrow">
              How it works
            </div>
            <h2
              className="mt-2 text-balance text-2xl font-semibold tracking-tight"
              data-testid="text-compare-title"
            >
              From your working weights to targeted accessories
            </h2>
            <p
              className="mt-3 text-sm leading-relaxed text-muted-foreground"
              data-testid="text-compare-subtitle"
            >
              Enter your working weights for your target lift and related exercises. Our AI—trained on lift biomechanics, strength ratios, and muscle activation patterns—analyzes your data just like an in-person coach would, but with precision and consistency. The result: a detailed diagnosis of your weak points and a targeted accessory plan to break through.
            </p>
          </div>

          <div className="mt-7 grid gap-3">
            <ComparisonRow
              left="Generic programs assume everyone fails for the same reason."
              right="Analyzes YOUR working weights to see which muscles are lagging behind."
              testId="row-compare-1"
            />
            <ComparisonRow
              left="Apps can't tell if your weak lockout is triceps, technique, or leverage."
              right="Calculates strength ratios (e.g., close-grip vs bench) to identify limiters."
              testId="row-compare-2"
            />
            <ComparisonRow
              left="In-person coaches: $100+/session to diagnose weak points."
              right="AI analyzes lift phases, biomechanics, and prescribes targeted accessories."
              testId="row-compare-3"
            />
          </div>
        </section>

        <section className="pb-16 sm:pb-24" data-testid="section-wearables">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold text-muted-foreground" data-testid="text-wearables-eyebrow">
              Coming soon
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight" data-testid="text-wearables-title">
              Sync your wearables. Understand your metrics.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground" data-testid="text-wearables-subtitle">
              Connect your Fitbit, Apple Watch, Samsung Galaxy Watch, or iPhone Health data. We'll analyze your heart rate variability, sleep quality, recovery metrics, and daily activity—then tell you what they mean, if they're optimal, and how to improve them for better strength gains.
            </p>
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="card-min card-hover rounded-2xl p-6" data-testid="card-wearable-fitbit">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl border bg-gradient-to-br from-[#00B0B9] to-[#00B0B9]/80 shadow-sm flex items-center justify-center">
                  <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.5 1.5c-.9 0-1.6.7-1.6 1.6v.9c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6v-.9c0-.9-.7-1.6-1.6-1.6zm0 6c-.9 0-1.6.7-1.6 1.6v1.8c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6V9.1c0-.9-.7-1.6-1.6-1.6zm0 6c-.9 0-1.6.7-1.6 1.6v1.8c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6v-1.8c0-.9-.7-1.6-1.6-1.6zm0 6c-.9 0-1.6.7-1.6 1.6v.9c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6v-.9c0-.9-.7-1.6-1.6-1.6zM9 4.5c-.9 0-1.6.7-1.6 1.6v1.8c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6V6.1c0-.9-.7-1.6-1.6-1.6zm0 6c-.9 0-1.6.7-1.6 1.6v3c0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6v-3c0-.9-.7-1.6-1.6-1.6z"/>
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold">Fitbit</div>
                  <div className="mt-1 text-xs text-muted-foreground">HR, sleep, activity</div>
                </div>
              </div>
            </Card>

            <Card className="card-min card-hover rounded-2xl p-6" data-testid="card-wearable-apple">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl border bg-gradient-to-br from-[#000000] to-[#333333] shadow-sm flex items-center justify-center">
                  <svg className="h-9 w-9 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold">Apple Watch</div>
                  <div className="mt-1 text-xs text-muted-foreground">HRV, recovery, workouts</div>
                </div>
              </div>
            </Card>

            <Card className="card-min card-hover rounded-2xl p-6" data-testid="card-wearable-samsung">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl border bg-gradient-to-br from-[#1428A0] to-[#1428A0]/80 shadow-sm flex items-center justify-center">
                  <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3.5c-4.7 0-8.5 3.8-8.5 8.5s3.8 8.5 8.5 8.5 8.5-3.8 8.5-8.5-3.8-8.5-8.5-8.5zm0 15.5c-3.9 0-7-3.1-7-7s3.1-7 7-7 7 3.1 7 7-3.1 7-7 7zm.5-11h-1v4.3l3.8 2.2.5-.8-3.3-2V8z"/>
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold">Galaxy Watch</div>
                  <div className="mt-1 text-xs text-muted-foreground">Sleep score, stress, steps</div>
                </div>
              </div>
            </Card>

            <Card className="card-min card-hover rounded-2xl p-6" data-testid="card-wearable-health">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="h-16 w-16 rounded-2xl border bg-gradient-to-br from-[#FF2D55] to-[#FF2D55]/80 shadow-sm flex items-center justify-center">
                  <svg className="h-9 w-9 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold">Apple Health</div>
                  <div className="mt-1 text-xs text-muted-foreground">All iPhone health data</div>
                </div>
              </div>
            </Card>
          </div>

          <div className="mt-7">
            <Card className="card-min rounded-2xl p-6" data-testid="card-wearables-value">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl border bg-background">
                  <Wand2 className="h-4 w-4" strokeWidth={1.8} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold" data-testid="text-wearables-value-title">
                    AI-powered health insights
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground" data-testid="text-wearables-value-subtitle">
                    Stop guessing what your metrics mean
                  </div>
                </div>
              </div>

              <Separator className="my-5" />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3 text-sm">
                  {[
                    "Is your HRV low because you're overtrained or just stressed?",
                    "Are you getting enough deep sleep for muscle recovery?",
                    "Is your resting heart rate optimal for your training load?",
                  ].map((q, idx) => (
                    <div key={q} className="flex items-start gap-3" data-testid={`row-wearables-question-${idx}`}>
                      <span className="mt-0.5 text-muted-foreground">→</span>
                      <p className="text-muted-foreground">{q}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 text-sm">
                  {[
                    "Get plain-English explanations of what each metric means for strength training",
                    "See if your numbers are in healthy ranges for your age and training level",
                    "Receive actionable recommendations: deload this week, prioritize sleep, reduce volume",
                  ].map((a, idx) => (
                    <div key={a} className="flex items-start gap-3" data-testid={`row-wearables-answer-${idx}`}>
                      <Check className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" strokeWidth={2} />
                      <p>{a}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </section>

        <section className="pb-16 sm:pb-24" data-testid="section-bodymap">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold text-muted-foreground" data-testid="text-bodymap-eyebrow">
              Coming soon
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight" data-testid="text-bodymap-title">
              Interactive body map for strengths & weakpoints
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground" data-testid="text-bodymap-subtitle">
              We'll translate your lift data and training metrics into a visual strength map—then let you prioritize weak areas for targeted programming.
            </p>
          </div>

          <div className="mt-7 grid gap-4 lg:grid-cols-[1fr_1fr_0.9fr]">
            <Card className="card-min rounded-2xl p-6" data-testid="card-bodymap-front">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold" data-testid="text-bodymap-front-title">
                  Front
                </div>
                <div className="text-xs text-muted-foreground" data-testid="text-bodymap-front-hint">
                  Select a muscle group
                </div>
              </div>
              <div className="mt-4 grid place-items-center rounded-2xl border bg-background p-4">
                <img
                  src={bodyMapFront}
                  alt="Body map front view"
                  className="h-[360px] w-auto select-none"
                  draggable={false}
                  data-testid="img-bodymap-front"
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {([
                  { id: "chest", label: "Chest" },
                  { id: "shoulders", label: "Shoulders" },
                  { id: "quads", label: "Quads" },
                  { id: "core", label: "Core" },
                ] as const).map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant={selectedArea === id ? "default" : "secondary"}
                    className="rounded-xl justify-start"
                    onClick={() => setSelectedArea(id)}
                    data-testid={`button-area-${id}`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </Card>

            <Card className="card-min rounded-2xl p-6" data-testid="card-bodymap-back">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold" data-testid="text-bodymap-back-title">
                  Back
                </div>
                <div className="text-xs text-muted-foreground" data-testid="text-bodymap-back-hint">
                  Select a muscle group
                </div>
              </div>
              <div className="mt-4 grid place-items-center rounded-2xl border bg-background p-4">
                <img
                  src={bodyMapBack}
                  alt="Body map back view"
                  className="h-[360px] w-auto select-none"
                  draggable={false}
                  data-testid="img-bodymap-back"
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {([
                  { id: "lats", label: "Lats" },
                  { id: "upper-back", label: "Upper back" },
                  { id: "glutes", label: "Glutes" },
                  { id: "hamstrings", label: "Hamstrings" },
                ] as const).map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant={selectedArea === id ? "default" : "secondary"}
                    className="rounded-xl justify-start"
                    onClick={() => setSelectedArea(id)}
                    data-testid={`button-area-${id}`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </Card>

            <Card className="card-min rounded-2xl p-6" data-testid="card-bodymap-panel">
              <div className="text-sm font-semibold" data-testid="text-bodymap-panel-title">
                Focus selector
              </div>
              <div className="mt-1 text-sm text-muted-foreground" data-testid="text-bodymap-panel-subtitle">
                Choose a weakpoint and we'll promote the right work inside your plan.
              </div>

              <Separator className="my-5" />

              <div className="space-y-4">
                <div className="rounded-2xl border bg-background p-4" data-testid="panel-selected-area">
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="text-selected-label">
                    Selected
                  </div>
                  <div className="mt-1 text-base font-semibold" data-testid="text-selected-area">
                    {selectedAreaLabel}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2" data-testid="wrap-strength-tags">
                    {selectedAreaMeta.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                        data-testid={`tag-selected-${t.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border bg-background p-4" data-testid="panel-recommendations">
                  <div className="text-xs font-semibold text-muted-foreground" data-testid="text-reco-label">
                    Example workouts (coming soon)
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedAreaMeta.workouts.map((w, idx) => (
                      <div
                        key={w}
                        className="flex items-start gap-3 rounded-xl border bg-background px-3 py-2"
                        data-testid={`row-workout-${idx}`}
                      >
                        <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border bg-background text-xs font-semibold">
                          +
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium" data-testid={`text-workout-${idx}`}>
                            {w}
                          </div>
                          <div className="text-xs text-muted-foreground" data-testid={`text-workout-note-${idx}`}>
                            Targeted for {selectedAreaLabel.toLowerCase()} development.
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </section>

        <section className="pb-16 sm:pb-24" data-testid="section-roadmap">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold text-muted-foreground" data-testid="text-roadmap-eyebrow">
              Roadmap
            </div>
            <h2
              className="mt-2 text-balance text-2xl font-semibold tracking-tight"
              data-testid="text-roadmap-title"
            >
              The complete fitness stack—built around strength progress.
            </h2>
            <p
              className="mt-3 text-sm leading-relaxed text-muted-foreground"
              data-testid="text-roadmap-subtitle"
            >
              All standard tracking features plus AI diagnostics and data-driven program adjustments.
            </p>
          </div>

          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <FeatureCard
              title="Compound movement tracking"
              description="Visual progress charts for your main lifts with PR tracking and trend analysis."
              icon={<LineChart className="h-4 w-4" strokeWidth={1.8} />}
              testId="card-roadmap-compound"
            />
            <FeatureCard
              title="Exercise library"
              description="Track accessories and variations with proper form cues and progression notes."
              icon={<NotebookPen className="h-4 w-4" strokeWidth={1.8} />}
              testId="card-roadmap-general"
            />
            <FeatureCard
              title="Body composition tracking"
              description="Weight trends with training context to optimize bulk/cut phases."
              icon={<Scale className="h-4 w-4" strokeWidth={1.8} />}
              testId="card-roadmap-weight"
            />
            <FeatureCard
              title="Nutrition calculator"
              description="Science-based calorie and macro targets from your metrics and training load."
              icon={<Target className="h-4 w-4" strokeWidth={1.8} />}
              testId="card-roadmap-nutrition"
            />
            <FeatureCard
              title="Smart programming"
              description="Generate, save, and modify programs with AI-suggested fixes based on diagnostics."
              icon={<Sparkles className="h-4 w-4" strokeWidth={1.8} />}
              testId="card-roadmap-plans"
            />
            <FeatureCard
              title="Training essentials"
              description="Rest timers, RPE/RIR tracking, workout notes, and data export."
              icon={<Dumbbell className="h-4 w-4" strokeWidth={1.8} />}
              testId="card-roadmap-essentials"
            />
          </div>
        </section>

        <section className="pb-16 sm:pb-24" data-testid="section-cta">
          <Card className="card-min rounded-2xl p-7">
            <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr] md:items-center">
              <div>
                <div className="text-xs font-semibold text-muted-foreground" data-testid="text-cta-eyebrow">
                  Early access
                </div>
                <div
                  className="mt-2 text-balance text-2xl font-semibold tracking-tight"
                  data-testid="text-cta-title"
                >
                  Join the waitlist.
                </div>
                <div
                  className="mt-3 text-sm leading-relaxed text-muted-foreground"
                  data-testid="text-cta-subtitle"
                >
                  We'll notify you when LiftOff launches.
                </div>
              </div>
              <div className="flex flex-wrap gap-3 md:justify-end">
                <Button
                  className="rounded-xl shadow-lg hover:shadow-xl bg-gradient-to-r from-primary to-blue-600 font-semibold cursor-pointer transition-all"
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    // Focus on email input after scrolling
                    setTimeout(() => {
                      const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
                      emailInput?.focus();
                    }, 500);
                  }}
                  data-testid="button-cta-join"
                >
                  Join waitlist
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Link href="/mvp">
                  <Button
                    asChild
                    variant="secondary"
                    className="rounded-xl"
                    data-testid="button-cta-try"
                  >
                    <span>
                      Try MVP
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </span>
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </section>

        <footer className="border-t py-10">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div data-testid="text-footer-brand">LiftOff - AI-Powered Lift Diagnostics</div>
            <div className="flex items-center gap-3">
              <Link
                href="/mvp"
                className="text-sm hover:text-foreground"
                data-testid="link-footer-mvp"
              >
                MVP
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
