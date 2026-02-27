import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowRight,
  Brain,
  Check,
  ChevronRight,
  Clock,
  Dumbbell,
  LineChart,
  MessageCircle,
  NotebookPen,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import bodyMapFront from "@/assets/images/body-map-front.png";
import bodyMapBack from "@/assets/images/body-map-back.png";
import snapshotTarget from "@assets/snapshot_target_1771266514838.png";
import snapshotRelevantLifts from "@assets/snapshot_relevant_lifts_1771266523066.png";
import snapshotChat from "@assets/snapshot_chat_1771264391949.png";
import snapshotAiSummary from "@assets/snapshot_ai_summary_1771264391948.png";
import snapshotAnalysis from "@assets/snapshot_analysis_1771264391949.png";
import snapshotAccessories from "@assets/snapshot_accesories_1771264391948.png";
import { BrandLogo } from "@/components/BrandLogo";
import { Navbar } from "@/components/Navbar";

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

const previewSteps = [
  {
    step: 1,
    title: "Select Your Lift",
    description: "Pick the compound movement you want to diagnose — bench, squat, or deadlift. Enter your working weight, sets, and reps along with optional body proportions so the AI has the full picture.",
    image: snapshotTarget,
  },
  {
    step: 2,
    title: "Your Relevant Lifts",
    description: "Log the related exercises you currently perform — rows, presses, squats, hip thrusts, and more. Your working weights and rep ranges give the AI the strength ratios it needs to find imbalances.",
    image: snapshotRelevantLifts,
  },
  {
    step: 3,
    title: "Diagnostic Chat",
    description: "Our AI asks targeted questions based on your working weights and strength ratios. It analyzes your lift mechanics, sticking points, and muscle balance — just like a coach would in person.",
    image: snapshotChat,
  },
  {
    step: 4,
    title: "AI Summary",
    description: "Get an instant summary identifying your limiting factor with a confidence score. The AI cross-references your strength data with biomechanical benchmarks to pinpoint exactly what's holding you back.",
    image: snapshotAiSummary,
  },
  {
    step: 5,
    title: "Detailed Analysis",
    description: "See the full evidence-based breakdown — every data point the AI used to reach its conclusion. From strength ratios to your self-reported sticking points, nothing is a black box.",
    image: snapshotAnalysis,
  },
  {
    step: 6,
    title: "Your Prescription",
    description: "Receive a targeted list of accessory exercises designed to address your specific weak points. Each movement includes sets, reps, and a clear explanation of why it was chosen.",
    image: snapshotAccessories,
  },
];

function PreviewSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const current = previewSteps[activeStep];

  const navigate = (next: number) => {
    setDirection(next > activeStep ? 1 : -1);
    setActiveStep(next);
  };

  const slideVariants = {
    enter: (dir: number) => ({
      opacity: 0,
      x: dir * 40,
      filter: "blur(4px)",
    }),
    center: {
      opacity: 1,
      x: 0,
      filter: "blur(0px)",
    },
    exit: (dir: number) => ({
      opacity: 0,
      x: dir * -40,
      filter: "blur(4px)",
    }),
  };

  const imageVariants = {
    enter: (dir: number) => ({
      opacity: 0,
      scale: 0.92,
      y: dir * 20,
    }),
    center: {
      opacity: 1,
      scale: 1,
      y: 0,
    },
    exit: (dir: number) => ({
      opacity: 0,
      scale: 0.92,
      y: dir * -20,
    }),
  };

  const spring = { type: "spring", stiffness: 300, damping: 30 };
  const easeFade = { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] };

  return (
    <section className="pb-16 sm:pb-24" data-testid="section-preview">
      <div className="max-w-3xl">
        <div className="text-xs font-semibold text-muted-foreground" data-testid="text-preview-eyebrow">
          See it in action
        </div>
        <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight" data-testid="text-preview-title">
          What your diagnostic session looks like
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground" data-testid="text-preview-subtitle">
          Walk through the full experience — from answering targeted questions about your lifts, to receiving a data-driven diagnosis and personalized accessory plan.
        </p>
      </div>

      <Card className="mt-8 card-min overflow-hidden rounded-2xl" data-testid="card-preview">
        <div className="flex border-b overflow-hidden">
          {previewSteps.map((item, idx) => (
            <button
              key={item.step}
              onClick={() => navigate(idx)}
              className="relative flex-1 flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium transition-colors -mb-px"
              data-testid={`tab-preview-${item.step}`}
            >
              <motion.span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                animate={{
                  backgroundColor: idx === activeStep ? "var(--color-primary)" : "var(--color-muted)",
                  color: idx === activeStep ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)",
                }}
                transition={spring}
              >
                {item.step}
              </motion.span>
              <span className={`hidden md:inline truncate transition-colors duration-200 ${
                idx === activeStep ? "text-foreground" : "text-muted-foreground"
              }`}>
                {item.title}
              </span>
              {idx === activeStep && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  layoutId="activeTab"
                  transition={spring}
                />
              )}
            </button>
          ))}
        </div>

        <div className="grid gap-0 lg:grid-cols-[0.42fr_0.58fr]" style={{ minHeight: 420 }}>
          <div className="relative flex flex-col justify-between p-6 lg:p-8 overflow-hidden" style={{ minHeight: 320 }}>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeStep}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={easeFade}
                className="flex-1 flex flex-col"
              >
                <div className="flex-1">
                  <motion.div
                    className="flex items-center gap-3 mb-3"
                    initial={{ opacity: 0, y: -12, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0 }}
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {current.step}
                    </span>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Step {current.step} of {previewSteps.length}
                    </div>
                  </motion.div>
                  <motion.h3
                    className="text-xl font-semibold tracking-tight"
                    data-testid="text-preview-active-title"
                    initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.07 }}
                  >
                    {current.title}
                  </motion.h3>
                  <motion.p
                    className="mt-2 text-sm leading-relaxed text-muted-foreground"
                    data-testid="text-preview-active-desc"
                    initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.14 }}
                  >
                    {current.description}
                  </motion.p>
                </div>

                <motion.div
                  className="mt-6 flex items-center gap-2"
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.35 }}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(Math.max(0, activeStep - 1))}
                    disabled={activeStep === 0}
                    className="rounded-xl"
                  >
                    Previous
                  </Button>
                  <Button
                    variant={activeStep === previewSteps.length - 1 ? "outline" : "default"}
                    size="sm"
                    onClick={() => navigate(Math.min(previewSteps.length - 1, activeStep + 1))}
                    disabled={activeStep === previewSteps.length - 1}
                    className="rounded-xl"
                  >
                    Next
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="relative bg-muted/30 p-4 lg:p-6 overflow-hidden">
            <AnimatePresence mode="popLayout">
              <motion.img
                key={activeStep}
                src={current.image}
                alt={current.title}
                className="w-full rounded-xl border shadow-sm"
                initial={{ opacity: 0, x: 30, scale: 0.96, filter: "blur(6px)" }}
                animate={{
                  opacity: 1,
                  x: 0,
                  scale: 1,
                  filter: "blur(0px)",
                  transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.18 },
                }}
                exit={{
                  opacity: 0,
                  scale: 0.98,
                  filter: "blur(4px)",
                  transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1], delay: 0 },
                }}
              />
            </AnimatePresence>
          </div>
        </div>

        <div className="flex justify-center gap-1.5 py-3 border-t">
          {previewSteps.map((_, idx) => (
            <button
              key={idx}
              onClick={() => navigate(idx)}
              className="p-1"
              aria-label={`Go to step ${idx + 1}`}
            >
              <motion.div
                className="rounded-full"
                animate={{
                  width: idx === activeStep ? 24 : 6,
                  height: 6,
                  backgroundColor: idx === activeStep ? "var(--color-primary)" : "var(--color-border)",
                }}
                transition={spring}
              />
            </button>
          ))}
        </div>
      </Card>
    </section>
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

const HERO_VARIANTS = [
  {
    badges: [
      { icon: "Zap", text: "24/7 AI Coach" },
      { icon: "Brain", text: "10 certifications" },
      { icon: "Target", text: "Lift diagnostics" },
    ],
    title: "Smarter than any trainer.",
    titleMuted: " Trained on 10 certifications + 7,000 pages of science.",
    subtitle: "LiftOff combines an elite AI coach with precision lift diagnostics. Get personalized programs, nutrition guidance, and biomechanical analysis — 24/7, judgment-free, never cancels. Plus pinpoint exactly what's limiting your bench, squat, or deadlift.",
  },
  {
    badges: [
      { icon: "MessageCircle", text: "Always-on coach" },
      { icon: "Scale", text: "Strength diagnostics" },
      { icon: "Sparkles", text: "Science-backed" },
    ],
    title: "The coach that never sleeps.",
    titleMuted: " And the diagnostics that never guess.",
    subtitle: "Two products in one: an AI coach trained on every major certification, and lift diagnostics that calculate your exact muscle limiters from your working weights. Programs, nutrition, injury prevention — plus e1RM and strength ratios to break plateaus.",
  },
  {
    badges: [
      { icon: "Brain", text: "Elite knowledge" },
      { icon: "Clock", text: "24/7 availability" },
      { icon: "ShieldCheck", text: "Lift analysis" },
    ],
    title: "More knowledge than any human trainer.",
    titleMuted: " Plus diagnostics that find your exact limiter.",
    subtitle: "No trainer has read every major textbook. LiftOff's AI has — and recalls it instantly. Get personalized coaching, nutrition, and program adaptation. Then run a diagnostic to pinpoint which muscles are holding back your bench, squat, or deadlift.",
  },
  {
    badges: [
      { icon: "RefreshCw", text: "Auto-reschedule" },
      { icon: "NotebookPen", text: "Perfect recall" },
      { icon: "Dumbbell", text: "Lift diagnostics" },
    ],
    title: "AI Coach + Lift Diagnostics.",
    titleMuted: " The full stack for serious lifters.",
    subtitle: "Your AI coach adapts when life happens — sick, travel, fatigue. It remembers every session and goal. And when you're stuck on a lift, our diagnostics use strength ratios and biomechanics to find your exact weak point. One platform. Zero guesswork.",
  },
  {
    badges: [
      { icon: "Sparkles", text: "AI Coach" },
      { icon: "LineChart", text: "Diagnostics" },
      { icon: "Zap", text: "Evidence-based" },
    ],
    title: "Break through your plateau.",
    titleMuted: " Then break through the next.",
    subtitle: "Start with lift diagnostics to find what's limiting you. Then level up with an AI coach trained on 10 certifications — programs, nutrition, wellness check-ins, Life Happened auto-reschedule. The smartest coach and the most precise diagnostics, together.",
  },
] as const;

const BADGE_ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-3.5 w-3.5" />,
  Brain: <Brain className="h-3.5 w-3.5" />,
  Target: <Target className="h-3.5 w-3.5" />,
  MessageCircle: <MessageCircle className="h-3.5 w-3.5" />,
  Scale: <Scale className="h-3.5 w-3.5" />,
  Sparkles: <Sparkles className="h-3.5 w-3.5" />,
  Clock: <Clock className="h-3.5 w-3.5" />,
  ShieldCheck: <ShieldCheck className="h-3.5 w-3.5" />,
  RefreshCw: <RefreshCw className="h-3.5 w-3.5" />,
  NotebookPen: <NotebookPen className="h-3.5 w-3.5" />,
  Dumbbell: <Dumbbell className="h-3.5 w-3.5" />,
  LineChart: <LineChart className="h-3.5 w-3.5" />,
};

export default function Signup() {
  const [selectedArea, setSelectedArea] = useState<BodyAreaKey>("shoulders");
  const { user, refreshUser } = useAuth();
  const hero = HERO_VARIANTS[0];

  // Handle ?auth=success from Google OAuth (in case callback lands here instead of /login)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      window.history.replaceState({}, '', '/');
      refreshUser();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAreaMeta = BODY_AREAS[selectedArea];
  const selectedAreaLabel = selectedAreaMeta.label;

  return (
    <div className="page">
      <Navbar variant="full" />

      <main className="container-tight">
        <section className="py-16 sm:py-24">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex flex-wrap items-center gap-2">
              {hero.badges.map((b, i) => (
                <ValuePill
                  key={i}
                  icon={BADGE_ICONS[b.icon] ?? <Zap className="h-3.5 w-3.5" />}
                  text={b.text}
                  testId={`badge-value-${i}`}
                />
              ))}
            </div>

            <h1
              className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl"
              data-testid="text-signup-hero-title"
            >
              {hero.title}
              <span className="text-muted-foreground">{hero.titleMuted}</span>
            </h1>

            <p
              className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
              data-testid="text-signup-hero-subtitle"
            >
              {hero.subtitle}
            </p>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="card-min rounded-2xl p-6" data-testid="card-email">
                {user ? (
                  <>
                    <div className="text-sm font-semibold" data-testid="text-email-title">
                      Welcome back{user.name ? `, ${user.name}` : ""}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground" data-testid="text-email-subtitle">
                      You're signed in as <span className="font-medium text-foreground">{user.email}</span>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <Button
                        className="rounded-xl shadow-lg hover:shadow-xl bg-gradient-to-r from-primary to-blue-600 font-semibold"
                        data-testid="button-get-started"
                        asChild
                      >
                        <Link href="/onboarding">
                          Try Demo
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="secondary" className="rounded-xl" data-testid="button-history">
                        <Link href="/history">My Analyses</Link>
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold" data-testid="text-email-title">
                      Try the lift diagnostic demo
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground" data-testid="text-email-subtitle">
                      See what's limiting your bench, squat, or deadlift in under 2 minutes. Free, no credit card required.
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <Button
                        className="rounded-xl shadow-lg hover:shadow-xl bg-gradient-to-r from-primary to-blue-600 font-semibold"
                        data-testid="button-get-started"
                        asChild
                      >
                        <Link href="/register">
                          Try Demo
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="secondary"
                        className="rounded-xl"
                        data-testid="button-sign-in"
                      >
                        <Link href="/login">Sign In</Link>
                      </Button>
                    </div>
                  </>
                )}
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

        {/* ── AI Coach Section ─────────────────────────────────────── */}
        <section className="py-16 sm:py-24 px-4" data-testid="section-products">
          <div className="max-w-4xl mx-auto px-4">
            <div className="text-center mb-10">
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground"
                data-testid="text-products-title"
              >
                Why LiftOff AI Coach?
              </h2>
              <p
                className="mt-3 text-base text-muted-foreground"
                data-testid="text-products-subtitle"
              >
                See how an AI Coach compares to traditional personal training.
              </p>
            </div>

          <div className="space-y-4" data-testid="tab-content-coach">
              {/* Cert knowledge section */}
              <Card className="card-min rounded-2xl p-6 bg-background" data-testid="card-cert-strip">
                <div className="mb-5">
                  <div className="text-sm font-semibold">Trained on every major certification</div>
                  <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                    Built on the combined curriculum of the 10 leading CPT certifications — more comprehensive knowledge than any single human trainer.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                    {["10 certifications", "7,000+ pages of training science", "Evidence-based answers only"].map(s => (
                      <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Check className="h-3 w-3 text-foreground flex-shrink-0" strokeWidth={2.5} />
                        {s}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {([
                    { abbr: "NASM", name: "National Academy of Sports Medicine" },
                    { abbr: "ACE", name: "American Council on Exercise" },
                    { abbr: "ISSA", name: "Intl. Sports Sciences Assoc." },
                    { abbr: "NSCA", name: "Natl. Strength & Conditioning" },
                    { abbr: "ACSM", name: "American College of Sports Medicine" },
                    { abbr: "NCSF", name: "Natl. Council on Strength & Fitness" },
                    { abbr: "NFPT", name: "Natl. Federation of Professional Trainers" },
                    { abbr: "NESTA", name: "Natl. Exercise & Sports Trainers Assoc." },
                    { abbr: "NETA", name: "National Exercise Trainers Assoc." },
                    { abbr: "IPTA", name: "Intl. Personal Training Academy" },
                  ] as const).map(({ abbr, name }) => (
                    <div
                      key={abbr}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-background px-3 py-4 text-center"
                    >
                      <span className="text-base font-bold tracking-tight">{abbr}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground">{name}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Feature comparison — exact match to screenshot */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="card-coach-compare">
                {/* Traditional Trainer */}
                <Card className="rounded-2xl p-6 bg-background shadow-sm">
                  <div className="text-xs font-bold text-foreground uppercase tracking-widest">Traditional Trainer</div>
                  <div className="text-sm text-muted-foreground mt-1">$80–150 per session</div>
                  <div className="mt-6 space-y-5">
                    {([
                      ["Cost", "$80–$150 per session — ~$600+/month"],
                      ["Knowledge base", "1–2 certifications studied"],
                      ["Cancellations", "It happens — rescheduling is on you"],
                      ["Life disruptions", '"Just skip the week"'],
                      ["Remembers history", "Only if they take good notes"],
                      ["Strength diagnostics", "Subjective eye test — easy to miss"],
                      ["Nutrition planning", "Generic macros or expensive RD referral"],
                      ["Available", "Their hours only — book ahead"],
                    ] as [string, string][]).map(([label, text]) => (
                      <div key={label}>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</div>
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                            <X className="h-3 w-3 text-red-500" strokeWidth={3} />
                          </span>
                          <span>{text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* LiftOff AI Coach */}
                <Card className="rounded-2xl p-6 bg-background shadow-sm relative">
                  <div className="text-xs font-bold text-foreground uppercase tracking-widest">LiftOff AI Coach</div>
                  <div className="text-sm text-muted-foreground mt-1">Less than 1 session/month</div>
                  <div className="absolute top-6 right-6">
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700 dark:bg-zinc-600 px-2.5 py-1 text-[10px] font-bold text-white uppercase tracking-wide">
                      <Star className="h-2.5 w-2.5" fill="currentColor" /> Recommended
                    </span>
                  </div>
                  <div className="mt-6 space-y-5">
                    {([
                      ["Cost", "<$12/month — free to try"],
                      ["Knowledge base", "10 certifications + 7,000+ pages of science"],
                      ["Cancellations", "Never cancels. Not once."],
                      ["Life disruptions", "Physiological analysis + auto-reschedule in 2 min"],
                      ["Remembers history", "Perfect recall of every session, goal, and note"],
                      ["Strength diagnostics", "e1RM + strength ratios pinpoint your exact muscle limiter"],
                      ["Nutrition planning", "TDEE-based targets + projected weekly weight outcomes"],
                      ["Available", "24/7, instant response, judgment-free, any device"],
                    ] as [string, string][]).map(([label, text]) => (
                      <div key={label}>
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</div>
                        <div className="flex items-start gap-2 text-sm text-foreground">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15">
                            <Check className="h-3 w-3 text-green-600" strokeWidth={3} />
                          </span>
                          <span>{text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Feature cards */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  { icon: <Clock className="h-4 w-4" strokeWidth={1.8} />, title: "24/7 · Judgment-free", desc: "Nutrition question at midnight? Form check before a morning lift? Your coach is always there — no appointments, no awkwardness." },
                  { icon: <RefreshCw className="h-4 w-4" strokeWidth={1.8} />, title: "Life Happened — auto-reschedule", desc: "Drank last night, got sick, or going on vacation? Tell the AI. It analyzes the physiological impact and adjusts your program in under two minutes." },
                  { icon: <Brain className="h-4 w-4" strokeWidth={1.8} />, title: "Deeper than any human trainer", desc: "No trainer has read every major textbook. LiftOff's AI has — and recalls any of it instantly. Biomechanics, periodization, nutrition, injury prevention." },
                  { icon: <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />, title: "Built around your life", desc: "Onboards with a full health screen, nutrition baseline, and barrier assessment. Your program reflects your goals, schedule, and real life." },
                ] as const).map(f => (
                  <Card key={f.title} className="card-min rounded-2xl p-5">
                    <div className="grid h-9 w-9 place-items-center rounded-xl border bg-background">{f.icon}</div>
                    <div className="mt-3 text-sm font-semibold">{f.title}</div>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                  </Card>
                ))}
              </div>

              {/* Cost CTA */}
              <Card className="card-min rounded-2xl p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border bg-background">
                      <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">100× the knowledge. 1/100th of the cost.</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        A personal trainer costs $150/session — ~$600/month. LiftOff gives you elite-level coaching daily for less than a single session.
                      </div>
                    </div>
                  </div>
                  <Button className="rounded-xl bg-gradient-to-r from-primary to-blue-600 font-semibold shadow-sm flex-shrink-0" asChild>
                    <Link href="/register">Meet your coach <ArrowRight className="ml-2 h-4 w-4" /></Link>
                  </Button>
                </div>
              </Card>
          </div>
          </div>
        </section>

        {/* ── Lift Diagnostics Section ──────────────────────────────── */}
        <section className="pb-16 sm:pb-24" data-testid="tab-content-diagnostic">
          <div className="max-w-3xl mb-7">
            <div className="text-xs font-semibold text-muted-foreground">
              Lift Diagnostics
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight">
              Find exactly what's holding your lift back.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Enter your working weights for your target lift and related exercises. Our AI — trained on lift biomechanics, strength ratios, and muscle activation patterns — analyzes your data just like an elite coach would, but with precision and consistency.
            </p>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3">
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

            <PreviewSection />
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
                  Ready to find your weak point?
                </div>
                <div
                  className="mt-2 text-balance text-2xl font-semibold tracking-tight"
                  data-testid="text-cta-title"
                >
                  Try the demo — free.
                </div>
                <div
                  className="mt-3 text-sm leading-relaxed text-muted-foreground"
                  data-testid="text-cta-subtitle"
                >
                  Sign up in seconds. No credit card required. See what's limiting your lifts.
                </div>
              </div>
              <div className="flex flex-wrap gap-3 md:justify-end">
                <Button
                  asChild
                  className="rounded-xl shadow-lg hover:shadow-xl bg-gradient-to-r from-primary to-blue-600 font-semibold"
                  data-testid="button-cta-join"
                >
                  <Link href="/register">
                    Try Demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="secondary"
                  className="rounded-xl"
                  data-testid="button-cta-try"
                >
                  <Link href="/login">Sign In</Link>
                </Button>
              </div>
            </div>
          </Card>
        </section>

        <footer className="border-t py-10">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3" data-testid="text-footer-brand">
              <BrandLogo height={24} className="h-6 w-auto" />
              <span>LiftOff - AI-Powered Lift Diagnostics</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/pricing" className="text-sm hover:text-foreground" data-testid="link-footer-pricing">
                Pricing
              </Link>
              <Link href="/login" className="text-sm hover:text-foreground" data-testid="link-footer-login">
                Sign In
              </Link>
              <Link href="/mvp" className="text-sm hover:text-foreground" data-testid="link-footer-mvp">
                MVP
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
