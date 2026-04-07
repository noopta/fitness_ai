/**
 * /features-v2 — Preview variant of the features page
 * Identical to /features but adds the real-screenshot PreviewSection
 * between the Diagnostic Engine section and the Feature Grid.
 */

import { useState, useRef } from "react";
import { Link } from "wouter";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  Brain, Dumbbell, Utensils, Heart, MessageCircle, Sparkles,
  TrendingUp, Users, Zap, Activity, Calendar, Camera,
  BarChart3, Target, ShieldCheck, ArrowRight, Check, X,
  ChevronRight, FlaskConical, Moon, Flame, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import snapshotTarget from "@assets/snapshot_target_1771266514838.png";
import snapshotRelevantLifts from "@assets/snapshot_relevant_lifts_1771266523066.png";
import snapshotChat from "@assets/snapshot_chat_1771264391949.png";
import snapshotAiSummary from "@assets/snapshot_ai_summary_1771264391948.png";
import snapshotAnalysis from "@assets/snapshot_analysis_1771264391949.png";
import snapshotAccessories from "@assets/snapshot_accesories_1771264391948.png";

// ─── Animation helpers ────────────────────────────────────────────────────────

function FadeUp({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.5, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Stat counter ─────────────────────────────────────────────────────────────

function StatPill({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={inView ? { opacity: 1, scale: 1 } : {}}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`flex flex-col items-center gap-0.5 px-6 py-4 ${className}`}
    >
      <span className="text-3xl font-bold tracking-tight text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground text-center leading-tight max-w-[100px]">{label}</span>
    </motion.div>
  );
}

// ─── Anakin tab mocks ─────────────────────────────────────────────────────────

function ProgramMock() {
  const days = [
    { label: "MON", name: "Upper Power", active: true },
    { label: "TUE", name: "Lower Strength", active: false },
    { label: "WED", name: "Rest", rest: true, active: false },
    { label: "THU", name: "Upper Hypertrophy", active: false },
    { label: "FRI", name: "Lower Power", active: false },
    { label: "SAT", name: "Accessory Day", active: false },
  ];
  const exercises = [
    { name: "Flat Bench Press", sets: "4", reps: "3–5", intensity: "87% 1RM" },
    { name: "Incline DB Press", sets: "3", reps: "8–10", intensity: "RPE 8" },
    { name: "Overhead Tricep Extension", sets: "3", reps: "12–15", intensity: "RPE 7" },
    { name: "Face Pulls", sets: "3", reps: "15–20", intensity: "RPE 6" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Week 3 · Strength Phase</span>
        <span className="ml-auto text-xs bg-foreground text-background px-2 py-0.5 rounded-full font-medium">Active</span>
      </div>
      <div className="grid grid-cols-6 gap-1">
        {days.map((d) => (
          <div
            key={d.label}
            className={`rounded-lg p-1.5 text-center transition-all ${
              d.active
                ? "bg-foreground text-background"
                : d.rest
                ? "bg-muted/50 text-muted-foreground"
                : "bg-muted text-foreground"
            }`}
          >
            <div className="text-[10px] font-bold">{d.label}</div>
            <div className="text-[9px] mt-0.5 leading-tight opacity-80 hidden sm:block">{d.name}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        {exercises.map((ex) => (
          <div key={ex.name} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <div className="flex-1 text-xs font-medium">{ex.name}</div>
            <div className="text-[10px] text-muted-foreground shrink-0">{ex.sets}×{ex.reps}</div>
            <div className="text-[10px] bg-background border rounded px-1.5 py-0.5 font-medium shrink-0">{ex.intensity}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NutritionMock() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Calories", value: "2,340", unit: "/ 2,500", color: "text-orange-500" },
          { label: "Protein", value: "178g", unit: "/ 190g", color: "text-blue-500" },
          { label: "Carbs", value: "242g", unit: "/ 270g", color: "text-green-500" },
          { label: "Fat", value: "68g", unit: "/ 80g", color: "text-purple-500" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl bg-muted/50 p-2.5 text-center">
            <div className={`text-sm font-bold ${m.color}`}>{m.value}</div>
            <div className="text-[10px] text-muted-foreground">{m.unit}</div>
            <div className="text-[10px] font-medium mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-muted/40 p-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Anakin's note</div>
        <p className="text-xs leading-relaxed">Protein is 12g under target — add a Greek yogurt before bed to hit your muscle protein synthesis window. Calories look solid for your surplus goal.</p>
      </div>
      <div className="space-y-1.5">
        {["Oats + protein powder · 420 kcal", "Chicken rice bowl · 680 kcal", "Pre-workout snack · 210 kcal"].map((m) => (
          <div key={m} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">{m}</div>
        ))}
      </div>
    </div>
  );
}

function LifeHappenedMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm italic text-muted-foreground">
        "Didn't sleep well, only got 5 hours. Feel like skipping today's session."
      </div>
      <div className="space-y-2">
        <div className="flex items-start gap-2.5 rounded-xl bg-muted/40 p-3">
          <div className="h-6 w-6 rounded-full bg-foreground text-background grid place-items-center shrink-0 mt-0.5">
            <Brain className="h-3 w-3" />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold">Anakin's assessment</div>
            <p className="text-xs text-muted-foreground leading-relaxed">5 hours of sleep reduces power output by ~8% and elevates cortisol. Skipping is smart — attempting a heavy strength day today would compromise form and increase injury risk.</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["Session rescheduled → Friday", "Volume reduced 15%", "Recovery nutrition sent"].map((t) => (
                <span key={t} className="rounded-full bg-background border text-[10px] px-2 py-0.5 font-medium">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatMock() {
  const messages = [
    { role: "user", text: "Why is my bench stalling even though I'm eating enough?" },
    { role: "ai", text: "Your diagnostic from last week shows your Triceps Index at 58 — that's your primary limiter. Your lockout is the weak point, not your chest or initial drive. The fix isn't more volume, it's specificity: close-grip bench and overhead tricep work at RPE 8." },
    { role: "user", text: "How much close-grip should I add?" },
    { role: "ai", text: "2 sets of 4–6 reps after your main bench, same session. Keep it sub-maximal this week — we're building the pattern, not testing the max." },
  ];
  return (
    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
            m.role === "user"
              ? "bg-foreground text-background rounded-br-sm"
              : "bg-muted/60 text-foreground rounded-bl-sm"
          }`}>
            {m.text}
          </div>
        </div>
      ))}
    </div>
  );
}

function SmartSuggestionsMock() {
  const suggestions = [
    { icon: "💪", title: "Today's Session Tip", body: "Your last 3 bench sessions show RPE creeping up without weight increase — deload 10% today and focus on bar path.", tag: "Strength" },
    { icon: "🥗", title: "Meal Suggestion", body: "You're 45g protein under for the week. Dinner idea: 200g salmon + rice + edamame — hits your remaining macros.", tag: "Nutrition" },
    { icon: "😴", title: "Recovery Insight", body: "Sleep averaged 6.1h this week. Anakin has reduced Saturday volume by 15% automatically.", tag: "Wellness" },
  ];
  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <div key={s.title} className="rounded-xl bg-muted/40 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-base">{s.icon}</span>
            <span className="text-xs font-semibold">{s.title}</span>
            <span className="ml-auto rounded-full bg-background border text-[10px] px-2 py-0.5 font-medium">{s.tag}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pl-6">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Anakin Feature Tabs ──────────────────────────────────────────────────────

const ANAKIN_TABS = [
  {
    id: "program",
    label: "Training Program",
    icon: Calendar,
    headline: "Periodized programs built around your weakest link",
    body: "Anakin doesn't generate templates. Every program is built from your diagnostic signals — your primary weakness determines exercise selection, your training age sets volume, your schedule and equipment shape the structure. Strength, hypertrophy, athletic, or mixed — 2 to 16 weeks, 2 to 6 days.",
    mock: ProgramMock,
  },
  {
    id: "nutrition",
    label: "Nutrition Intelligence",
    icon: Utensils,
    headline: "A 4-layer dietitian stack — not a calorie calculator",
    body: "A deterministic engine computes your TDEE, a rules engine adjusts for your goal (deficit, surplus, or recomp), RAG retrieval pulls peer-reviewed sports science, and an LLM dietitian persona reasons over pre-computed data — never guessing, always citing. Log meals manually, by description, or by photo.",
    mock: NutritionMock,
  },
  {
    id: "life",
    label: "Life Happened",
    icon: Heart,
    headline: "Tell Anakin what happened — he'll handle the rest",
    body: "Missed sessions, illness, alcohol, a bad night's sleep. Describe it in plain English. Anakin classifies the disruption, explains the physiological impact on your body, gives you a recovery nutrition protocol, and automatically reschedules your program — one tap.",
    mock: LifeHappenedMock,
  },
  {
    id: "chat",
    label: "24/7 Chat",
    icon: MessageCircle,
    headline: "A coach with full memory who never clocks out",
    body: "Anakin is trained on NASM, ISSA, ACE, and 7,000+ pages of peer-reviewed sports science — and he knows your complete training history, current program phase, diagnostic results, wellness check-ins, and nutrition logs. Every answer is specific to you, not generic advice from a textbook.",
    mock: ChatMock,
  },
  {
    id: "suggestions",
    label: "Smart Suggestions",
    icon: Sparkles,
    headline: "Anakin learns and speaks up before you ask",
    body: "The more you log, the sharper Anakin gets. Today's coaching tips cross your morning wellness check-in against your program and your diagnosed weakness. Strength insights sharpen after every workout. Meal suggestions reprioritize as your macros shift. Recovery insights fire when your wellness trend dips.",
    mock: SmartSuggestionsMock,
  },
];

function AnakinSection() {
  const [activeTab, setActiveTab] = useState(0);
  const MockComponent = ANAKIN_TABS[activeTab].mock;

  return (
    <section className="py-16 sm:py-24 bg-foreground text-background">
      <div className="container-tight">
        <FadeUp>
          <div className="inline-flex items-center gap-2 rounded-full border border-background/20 bg-background/10 px-4 py-1.5 text-xs font-medium text-background/80 mb-6">
            <Brain className="h-3.5 w-3.5" />
            Meet Anakin
          </div>
        </FadeUp>
        <FadeUp delay={0.05}>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4 leading-tight">
            Your AI coach.<br />Not a chatbot.
          </h2>
        </FadeUp>
        <FadeUp delay={0.1}>
          <p className="text-background/65 max-w-xl text-lg mb-8 sm:mb-12">
            Anakin synthesizes your diagnostics, workouts, nutrition, and wellness into a single coaching intelligence — and acts on it without being asked.
          </p>
        </FadeUp>

        {/* Tab nav */}
        <FadeUp delay={0.15}>
          <div className="flex flex-wrap gap-2 mb-10">
            {ANAKIN_TABS.map((tab, i) => {
              const Icon = tab.icon;
              const active = i === activeTab;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(i)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
                    active
                      ? "bg-background text-foreground"
                      : "bg-background/10 text-background/70 hover:bg-background/20 hover:text-background"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </FadeUp>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="grid lg:grid-cols-2 gap-10 items-start"
          >
            {/* Left: copy */}
            <div className="space-y-4 lg:pt-4">
              <h3 className="text-xl sm:text-2xl font-bold leading-snug">
                {ANAKIN_TABS[activeTab].headline}
              </h3>
              <p className="text-background/65 leading-relaxed text-[15px]">
                {ANAKIN_TABS[activeTab].body}
              </p>
            </div>

            {/* Right: mock UI */}
            <div className="rounded-2xl border border-foreground/10 bg-background text-foreground p-5">
              <MockComponent />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

// ─── Diagnostic Engine section ────────────────────────────────────────────────

function EngineStep({
  number,
  title,
  body,
  delay,
}: {
  number: string;
  title: string;
  body: string;
  delay: number;
}) {
  return (
    <FadeUp delay={delay}>
      <div className="flex gap-5">
        <div className="shrink-0 flex flex-col items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-foreground text-background text-sm font-bold flex items-center justify-center">
            {number}
          </div>
          <div className="flex-1 w-px bg-border" />
        </div>
        <div className="pb-10 pt-1">
          <div className="font-semibold mb-1.5">{title}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        </div>
      </div>
    </FadeUp>
  );
}

function IndexCard({ label, value, color }: { label: string; value: number; color: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="rounded-xl bg-muted/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={inView ? { width: `${value}%` } : {}}
          transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function DiagnosticSection() {
  return (
    <section className="py-16 sm:py-24 border-t">
      <div className="container-tight">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          <div>
            <FadeUp>
              <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground mb-6">
                <FlaskConical className="h-3.5 w-3.5" />
                The Diagnostic Engine
              </div>
            </FadeUp>
            <FadeUp delay={0.05}>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                Deterministic first.<br />AI second.
              </h2>
            </FadeUp>
            <FadeUp delay={0.1}>
              <p className="text-muted-foreground mb-8 sm:mb-10 leading-relaxed">
                Before any AI runs, a pure deterministic engine computes your strength ratios from actual training data — no guessing, no hallucination. The AI then cross-checks these signals against your subjective report to confirm the diagnosis.
              </p>
            </FadeUp>

            <EngineStep
              number="1"
              title="Snapshot your lifts"
              body="Log your working weights, sets, and reps across the primary and supporting exercises for your chosen lift — bench, squat, deadlift, Olympic lifts."
              delay={0.05}
            />
            <EngineStep
              number="2"
              title="Engine computes your ratios"
              body="Epley-estimated 1RMs feed 5 muscle-group indices: Quad, Posterior Chain, Back Tension, Triceps, and Shoulder. These reveal which muscle group is the structural bottleneck — without asking."
              delay={0.1}
            />
            <EngineStep
              number="3"
              title="Phase & hypothesis ranking"
              body="The engine scores every phase of your lift (off the floor, mid-range, lockout) and ranks the top 3–5 weakness hypotheses with confidence scores before the AI interview even begins."
              delay={0.15}
            />
            <EngineStep
              number="4"
              title="AI interview confirms the signal"
              body="Anakin asks targeted questions about your subjective experience — sticking points, bar drift, fatigue pattern. Your answers corroborate or redirect the engine's hypothesis, producing a confident diagnosis."
              delay={0.2}
            />
          </div>

          {/* Right: live-looking index display */}
          <div className="lg:pt-20 space-y-5">
            <FadeUp delay={0.1}>
              <div className="rounded-2xl border bg-card p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">Flat Bench Press</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Efficiency Score · 72/100</div>
                  </div>
                  <div className="h-12 w-12 rounded-full border-4 border-foreground flex items-center justify-center">
                    <span className="text-sm font-bold">72</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Muscle Group Indices</div>
                  <IndexCard label="Triceps Index" value={58} color="#3b82f6" />
                  <IndexCard label="Shoulder Index" value={74} color="#8b5cf6" />
                  <IndexCard label="Back Tension Index" value={81} color="#10b981" />
                  <IndexCard label="Posterior Index" value={88} color="#f59e0b" />
                  <IndexCard label="Quad Index" value={91} color="#ef4444" />
                </div>

                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                  <div className="text-xs font-semibold text-blue-900 mb-1">Primary Weakness Identified</div>
                  <div className="text-sm font-bold text-blue-800">Triceps Lockout Strength</div>
                  <div className="text-xs text-blue-700 mt-0.5">Confidence: High · Phase: Lockout</div>
                </div>
              </div>
            </FadeUp>

            <FadeUp delay={0.2}>
              <div className="rounded-2xl border bg-card p-5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Supported Lifts</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Flat Bench", "Incline Bench", "Deadlift",
                    "Back Squat", "Front Squat",
                    "Clean & Jerk", "Snatch", "Power Clean", "Hang Clean",
                  ].map((lift) => (
                    <span
                      key={lift}
                      className="rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium"
                    >
                      {lift}
                    </span>
                  ))}
                </div>
              </div>
            </FadeUp>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Strength Profile Section ─────────────────────────────────────────────────

const SVG_CX = 110, SVG_CY = 110, SVG_R = 85;
const PENTA_ANGLES = [-90, -18, 54, 126, 198];
const RADAR_LABELS = ["Quad", "Shoulder", "Posterior", "Triceps", "Back Tension"];

function radarPolyPoints(vals: number[]): string {
  return vals
    .map((v, i) => {
      const rad = (PENTA_ANGLES[i] * Math.PI) / 180;
      const r = (v / 100) * SVG_R;
      return `${(SVG_CX + r * Math.cos(rad)).toFixed(2)},${(SVG_CY + r * Math.sin(rad)).toFixed(2)}`;
    })
    .join(" ");
}

const PROFILE_STAGES = [
  {
    label: "Session 1",
    subtitle: "Baseline from first snapshot",
    score: 58,
    vals: [62, 41, 70, 35, 55],
    e1rm: "~102 kg",
    insights: [
      { label: "Triceps", val: 35, note: "Primary limiter identified", color: "#3b82f6" },
      { label: "Shoulder", val: 41, note: "Secondary weakness flagged", color: "#8b5cf6" },
      { label: "Posterior Chain", val: 70, note: "Above average — a strength", color: "#10b981" },
    ],
  },
  {
    label: "Week 4",
    subtitle: "3 targeted sessions completed",
    score: 67,
    vals: [69, 55, 76, 53, 65],
    e1rm: "~109 kg",
    insights: [
      { label: "Triceps", val: 53, note: "+18 pts — close-grip work responding", color: "#3b82f6" },
      { label: "Shoulder", val: 55, note: "+14 pts — overhead volume helping", color: "#8b5cf6" },
      { label: "Posterior Chain", val: 76, note: "Continuing to build", color: "#10b981" },
    ],
  },
  {
    label: "Week 12",
    subtitle: "Profile fully resolved",
    score: 81,
    vals: [82, 73, 88, 77, 83],
    e1rm: "~121 kg",
    insights: [
      { label: "Triceps", val: 77, note: "+42 pts — limiter fully resolved", color: "#3b82f6" },
      { label: "Shoulder", val: 73, note: "+32 pts — now a genuine strength", color: "#8b5cf6" },
      { label: "Posterior Chain", val: 88, note: "Elite range", color: "#10b981" },
    ],
  },
];

function StrengthProfileSection() {
  const [stage, setStage] = useState(0);
  const s = PROFILE_STAGES[stage];
  const rings = [25, 50, 75, 100];

  return (
    <section className="py-16 sm:py-24 border-t">
      <div className="container-tight">
        <FadeUp className="mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground mb-5">
            <BarChart3 className="h-3.5 w-3.5" />
            Strength Profile
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Your profile sharpens with every session
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-[15px]">
            Every workout you log refines Axiom's model of your strength. Muscle-group indices evolve, limiters get resolved, and your efficiency score tracks real progress — not effort.
          </p>
        </FadeUp>

        <FadeUp delay={0.05} className="mb-8">
          <div className="inline-flex rounded-xl border bg-muted/40 p-1 gap-1">
            {PROFILE_STAGES.map((ps, i) => (
              <button
                key={ps.label}
                onClick={() => setStage(i)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  i === stage
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {ps.label}
              </button>
            ))}
          </div>
        </FadeUp>

        <FadeIn delay={0.1}>
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <div className="rounded-2xl border bg-card p-6 flex flex-col items-center gap-5">
              <div className="flex items-center justify-between w-full">
                <div>
                  <div className="font-semibold">Flat Bench Press</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.subtitle}</div>
                </div>
                <div className="text-right">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={s.score}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25 }}
                      className="text-3xl font-bold tabular-nums"
                    >
                      {s.score}
                    </motion.div>
                  </AnimatePresence>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Efficiency</div>
                </div>
              </div>

              <svg viewBox="0 0 220 220" className="w-full max-w-[260px]">
                {rings.map((pct) => (
                  <polygon
                    key={pct}
                    points={radarPolyPoints([pct, pct, pct, pct, pct])}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={pct === 100 ? 0.18 : 0.07}
                    strokeWidth={pct === 100 ? 1 : 0.5}
                  />
                ))}
                {PENTA_ANGLES.map((angle, i) => {
                  const rad = (angle * Math.PI) / 180;
                  return (
                    <line key={i} x1={SVG_CX} y1={SVG_CY}
                      x2={SVG_CX + SVG_R * Math.cos(rad)} y2={SVG_CY + SVG_R * Math.sin(rad)}
                      stroke="currentColor" strokeOpacity={0.1} strokeWidth={0.5}
                    />
                  );
                })}
                <motion.polygon
                  points={radarPolyPoints(s.vals)}
                  fill="currentColor" fillOpacity={0.12}
                  stroke="currentColor" strokeWidth={2} strokeOpacity={0.85}
                  animate={{ points: radarPolyPoints(s.vals) }}
                  transition={{ duration: 0.7, ease: "easeInOut" }}
                />
                {s.vals.map((v, i) => {
                  const rad = (PENTA_ANGLES[i] * Math.PI) / 180;
                  const r = (v / 100) * SVG_R;
                  return (
                    <motion.circle key={i} r={3.5} fill="currentColor"
                      animate={{ cx: SVG_CX + r * Math.cos(rad), cy: SVG_CY + r * Math.sin(rad) }}
                      transition={{ duration: 0.7, ease: "easeInOut" }}
                    />
                  );
                })}
                {RADAR_LABELS.map((label, i) => {
                  const rad = (PENTA_ANGLES[i] * Math.PI) / 180;
                  return (
                    <text key={i}
                      x={SVG_CX + (SVG_R + 17) * Math.cos(rad)}
                      y={SVG_CY + (SVG_R + 17) * Math.sin(rad)}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={8} fill="currentColor" fillOpacity={0.45}
                    >
                      {label}
                    </text>
                  );
                })}
              </svg>

              <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-2.5 w-full">
                <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Epley e1RM estimate</span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={s.e1rm}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-sm font-semibold ml-auto"
                  >
                    {s.e1rm}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border bg-card p-5 space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Muscle Group Indices
                </div>
                {RADAR_LABELS.map((label, i) => (
                  <div key={label} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={`${stage}-${i}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="text-xs font-bold tabular-nums"
                        >
                          {s.vals[i]}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-foreground"
                        animate={{ width: `${s.vals[i]}%` }}
                        transition={{ duration: 0.7, ease: "easeInOut" }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border bg-card p-5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Anakin's reading
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={stage}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-2.5"
                  >
                    {s.insights.map((ins) => (
                      <div key={ins.label} className="flex items-start gap-3">
                        <div className="h-2 w-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: ins.color }} />
                        <div>
                          <span className="text-sm font-medium">{ins.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">{ins.val} · {ins.note}</span>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── Program Generation Flow ───────────────────────────────────────────────────

const INTAKE_SECTIONS = [
  { label: "Goals & Motivation", tags: ["Short & long-term goals", "Why it matters to you", "Past attempts & what worked", "Commitment level"], delay: 0 },
  { label: "Health & Medical History", tags: ["PAR-Q safety screen", "Chronic conditions & medications", "Injuries & joint issues", "Hormonal factors"], delay: 0.08 },
  { label: "Training Background", tags: ["Training age", "Current routine & volume", "Working weights on main lifts", "Training style preference"], delay: 0.16 },
  { label: "Nutrition Baseline", tags: ["Dietary restrictions", "Current nutrition quality", "Approximate daily protein"], delay: 0.24 },
  { label: "Lifestyle & Recovery", tags: ["Sleep quality & quantity", "Daily stress & energy", "Activity level outside gym", "Recovery practices"], delay: 0.32 },
  { label: "Preferences & Logistics", tags: ["Days per week available", "Equipment access", "Accountability style"], delay: 0.40 },
  { label: "Body Composition", tags: ["Height, weight, body fat %", "Aesthetic priorities", "Weekly food budget"], delay: 0.48 },
];

const PROGRAM_PHASES = [
  { num: "1", name: "Strength Foundation", weeks: "Wks 1–4", focus: "Heavy compounds, low rep, progressive overload" },
  { num: "2", name: "Hypertrophy Block", weeks: "Wks 5–10", focus: "Volume accumulation, moderate RPE" },
  { num: "3", name: "Peak & Test", weeks: "Wks 11–12", focus: "Intensity peak, 1RM attempt week" },
];

const MACRO_TARGETS = [
  { label: "Protein", g: 195, pct: 35, color: "#3b82f6" },
  { label: "Carbs", g: 285, pct: 45, color: "#10b981" },
  { label: "Fat", g: 78, pct: 20, color: "#f59e0b" },
];

const _UNUSED_DIAG = [
  {
    role: "ai",
    text: "placeholder",
    delay: 0,
  },
  {
    role: "ai",
    text: "Under a true max attempt, where does the bar stall — off the chest, mid-range, or at the very top?",
    delay: 0.25,
  },
  { role: "user", text: "Always at the top. The last few inches just stop.", delay: 0.55 },
  {
    role: "ai",
    text: "Do your elbows flare outward as you approach that sticking point, or do they stay tucked?",
    delay: 0.85,
  },
  { role: "user", text: "They drift out pretty badly when it gets really heavy.", delay: 1.15 },
  {
    role: "ai",
    text: "When you've done close-grip bench — does it feel dramatically harder on the triceps compared to standard grip?",
    delay: 1.45,
  },
  { role: "user", text: "Yeah, brutal. Way harder than regular bench.", delay: 1.75 },
  {
    role: "ai",
    text: "Confirmed: Triceps Lockout Insufficiency — lateral head deficit. Confidence: High. Generating your program now…",
    delay: 2.05,
    isBuilding: true,
  },
];

function ProgramFlowSection() {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const leftInView = useInView(leftRef, { once: true, margin: "-60px" });
  const rightInView = useInView(rightRef, { once: true, margin: "-60px" });

  return (
    <section className="py-16 sm:py-24 border-t bg-muted/30">
      <div className="container-tight">
        <FadeUp className="mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground mb-5">
            <Calendar className="h-3.5 w-3.5" />
            Pro — AI Coach intake
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            The most thorough fitness intake you've ever done
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-[15px]">
            Pro users complete a 30-question intake across 7 sections — goals, medical history, training background, nutrition, lifestyle, logistics, and body composition. Anakin uses every answer to build a fully periodized program and a matched nutrition plan from scratch.
          </p>
        </FadeUp>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <div ref={leftRef} className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-5">
              What Anakin learns about you
            </div>
            {INTAKE_SECTIONS.map((section, i) => (
              <motion.div
                key={section.label}
                initial={{ opacity: 0, x: -16 }}
                animate={leftInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.38, delay: section.delay, ease: "easeOut" }}
                className="rounded-xl border bg-card p-3.5"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-5 w-5 rounded-full bg-foreground text-background text-[10px] font-bold grid place-items-center shrink-0">
                    {i + 1}
                  </div>
                  <span className="text-sm font-semibold">{section.label}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {section.tags.map((tag) => (
                    <span key={tag} className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

          <div ref={rightRef} className="space-y-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-5">
              What Anakin builds from it
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={rightInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
              className="rounded-2xl border bg-card p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">12-Week Periodized Program</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Strength-Hypertrophy · 4 days/week · Full gym</div>
                </div>
                <span className="shrink-0 text-xs bg-foreground text-background px-2.5 py-1 rounded-full font-medium">Generated</span>
              </div>

              <div className="space-y-2">
                {PROGRAM_PHASES.map((phase) => (
                  <div key={phase.num} className="flex items-start gap-3 rounded-xl bg-muted/50 px-3.5 py-2.5">
                    <div className="h-6 w-6 rounded-full bg-foreground text-background text-[10px] font-bold grid place-items-center shrink-0 mt-0.5">
                      {phase.num}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold flex flex-wrap items-center gap-x-2">
                        {phase.name}
                        <span className="text-muted-foreground font-normal">{phase.weeks}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{phase.focus}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { day: "Mon", name: "Upper Power", active: true },
                  { day: "Tue", name: "Lower Strength", active: false },
                  { day: "Thu", name: "Upper Hypertrophy", active: false },
                  { day: "Fri", name: "Lower Volume", active: false },
                ].map((d) => (
                  <div key={d.day} className={`rounded-lg p-2 text-center ${d.active ? "bg-foreground text-background" : "bg-muted"}`}>
                    <div className="text-[10px] font-bold">{d.day}</div>
                    <div className="text-[9px] mt-0.5 opacity-75 leading-tight">{d.name}</div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={rightInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.45, delay: 0.22, ease: "easeOut" }}
              className="rounded-2xl border bg-card p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">Nutrition Plan</div>
                <span className="text-xs text-muted-foreground">2,740 kcal/day · lean bulk</span>
              </div>
              <div className="space-y-2.5">
                {MACRO_TARGETS.map((m) => (
                  <div key={m.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className="font-semibold tabular-nums">{m.g}g · {m.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: m.color }}
                        initial={{ width: 0 }}
                        animate={rightInView ? { width: `${m.pct * 2.5}%` } : {}}
                        transition={{ duration: 0.8, delay: 0.35, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed border-t pt-3">
                Calibrated to your TDEE, lean bulk goal, 4× weekly training load, and $80/week food budget. Adjusted for your dairy-free restriction.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Real screenshot preview (from signup page) ───────────────────────────────

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
    description: "Anakin asks targeted questions based on your working weights and strength ratios. He analyzes your lift mechanics, sticking points, and muscle balance to narrow in on the real cause.",
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
    description: "See the full evidence-based breakdown — every data point Anakin used to reach his conclusion. From strength ratios to your self-reported sticking points, nothing is a black box.",
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
    enter: (dir: number) => ({ opacity: 0, x: dir * 40, filter: "blur(4px)" }),
    center: { opacity: 1, x: 0, filter: "blur(0px)" },
    exit: (dir: number) => ({ opacity: 0, x: dir * -40, filter: "blur(4px)" }),
  };

  const spring = { type: "spring" as const, stiffness: 300, damping: 30 };
  const easeFade = { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] };

  return (
    <section className="py-16 sm:py-24 border-t bg-muted/20">
      <div className="container-tight">
        <FadeUp className="mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground mb-5">
            <Target className="h-3.5 w-3.5" />
            See it in action
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            What a diagnostic session looks like
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-[15px]">
            Walk through the full experience — from entering your working weights, to receiving a data-driven weakness diagnosis and a personalized accessory prescription.
          </p>
        </FadeUp>

        <FadeIn>
          <Card className="overflow-hidden rounded-2xl border">
            {/* Step tabs */}
            <div className="flex border-b overflow-x-auto overflow-y-hidden min-w-0">
              {previewSteps.map((item, idx) => (
                <button
                  key={item.step}
                  onClick={() => navigate(idx)}
                  className="relative flex-1 min-w-[44px] flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium transition-colors -mb-px shrink-0"
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
                      layoutId="previewActiveTab"
                      transition={spring}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="grid gap-0 lg:grid-cols-[0.42fr_0.58fr] min-h-[320px] sm:min-h-[380px] lg:min-h-[420px]">
              {/* Left: copy */}
              <div className="relative flex flex-col justify-between p-4 sm:p-6 lg:p-8 overflow-hidden min-h-[260px] sm:min-h-[300px] lg:min-h-[320px]">
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
                        initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.07 }}
                      >
                        {current.title}
                      </motion.h3>
                      <motion.p
                        className="mt-2 text-sm leading-relaxed text-muted-foreground"
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

              {/* Right: screenshot */}
              <div className="relative bg-muted/30 p-4 lg:p-6 overflow-hidden">
                <AnimatePresence mode="popLayout">
                  <motion.img
                    key={activeStep}
                    src={current.image}
                    alt={current.title}
                    className="w-full rounded-xl border shadow-sm"
                    initial={{ opacity: 0, x: 30, scale: 0.96, filter: "blur(6px)" }}
                    animate={{
                      opacity: 1, x: 0, scale: 1, filter: "blur(0px)",
                      transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.18 },
                    }}
                    exit={{
                      opacity: 0, scale: 0.98, filter: "blur(4px)",
                      transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] },
                    }}
                  />
                </AnimatePresence>
              </div>
            </div>

            {/* Dot indicator */}
            <div className="flex justify-center gap-1.5 py-3 border-t">
              {previewSteps.map((_, idx) => (
                <button key={idx} onClick={() => navigate(idx)} className="p-1" aria-label={`Step ${idx + 1}`}>
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
        </FadeIn>
      </div>
    </section>
  );
}

// ─── Feature grid ─────────────────────────────────────────────────────────────

const FEATURE_GRID = [
  {
    icon: Dumbbell,
    title: "Workout Logging",
    body: "Log any exercise with sets, reps, weight, RPE, and notes. 80+ exercise autocomplete. Every entry feeds Anakin's strength model.",
  },
  {
    icon: BarChart3,
    title: "Strength Profile & Analytics",
    body: "Radar chart, efficiency score trend, exercise progression per lift, weekly volume, top limiters by frequency — all updating in real time.",
  },
  {
    icon: Camera,
    title: "Food Photo Scanning",
    body: "Snap a photo of your meal. Gemini Vision identifies the food, estimates portions, and pre-fills your macros. No barcodes.",
  },
  {
    icon: Clock,
    title: "Periodized Programming",
    body: "2–16 week programs. Strength, hypertrophy, athletic, or mixed. 2–6 days per week. Built around your schedule, equipment, and diagnosed weakness.",
  },
  {
    icon: Moon,
    title: "Wellness Check-In",
    body: "Daily mood, energy, sleep, and stress logging. Poor sleep automatically reduces Anakin's volume recommendations for that day.",
  },
  {
    icon: Activity,
    title: "Activity Heatmap",
    body: "A 52-week GitHub-style contribution graph tracking every diagnostic, workout, wellness check-in, meal, and coach chat.",
  },
  {
    icon: Users,
    title: "Friends & 1RM Leaderboard",
    body: "Add friends, compare Epley-estimated 1RMs per lift, and see where you rank. Strength earned — not self-reported.",
  },
  {
    icon: MessageCircle,
    title: "Social & Direct Messaging",
    body: "Share your diagnostic results, post to the activity feed, and message friends directly — all within the app.",
  },
  {
    icon: Zap,
    title: "Instant Meal Suggestions",
    body: "Describe what you ate and get macros in seconds. Anakin generates meal ideas matched to your remaining targets, budget, and dietary restrictions.",
  },
  {
    icon: TrendingUp,
    title: "Body Weight Projection",
    body: "Log your weight daily and Anakin projects your trajectory to your goal date based on your caloric trend — not a generic formula.",
  },
];

function FeatureGrid() {
  return (
    <section className="py-16 sm:py-24 bg-muted/30 border-t">
      <div className="container-tight">
        <FadeUp className="mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground mb-5">
            <Zap className="h-3.5 w-3.5" />
            Every feature, in one app
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            The full coaching stack
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-[15px]">
            No separate nutrition app, no separate workout tracker, no separate messaging platform. Everything Anakin needs to coach you — in one place.
          </p>
        </FadeUp>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURE_GRID.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <FadeUp key={feat.title} delay={i * 0.05}>
                <Card className="h-full rounded-2xl p-5 hover:shadow-md transition-shadow duration-200">
                  <div className="h-9 w-9 rounded-xl border bg-background grid place-items-center mb-4">
                    <Icon className="h-4.5 w-4.5 text-foreground" />
                  </div>
                  <div className="font-semibold mb-1.5 text-[15px]">{feat.title}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feat.body}</p>
                </Card>
              </FadeUp>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Comparison table ─────────────────────────────────────────────────────────

const COMPETITORS = ["Axiom", "MyFitnessPal", "Fitbod", "Juggernaut AI", "Cal AI"];
const COMPARISON_ROWS = [
  { feature: "Diagnostic engine (biomechanical ratios)", values: [true, false, false, false, false] },
  { feature: "Phase & sticking-point identification", values: [true, false, false, false, false] },
  { feature: "Weakness hypothesis ranking", values: [true, false, false, false, false] },
  { feature: "Goal-aligned nutrition (all goal types)", values: [true, "Basic", false, false, "Calories only"] },
  { feature: "RAG-backed peer-reviewed nutrition science", values: [true, false, false, false, false] },
  { feature: "Food photo scanning", values: [true, true, false, false, true] },
  { feature: "Persistent AI coach with full context", values: [true, false, false, false, false] },
  { feature: "Life Happened program adjustment", values: [true, false, false, false, false] },
  { feature: "Smart proactive suggestions", values: [true, false, false, "Partial", false] },
  { feature: "Friends 1RM leaderboard", values: [true, false, false, false, false] },
  { feature: "Wellness → volume feedback loop", values: [true, false, false, "Partial", false] },
  { feature: "Institution / team mode", values: [true, false, false, "Partial", false] },
];

function CompCell({ value, isAxiom }: { value: boolean | string; isAxiom: boolean }) {
  if (value === true) {
    return (
      <div className={`flex justify-center ${isAxiom ? "text-foreground" : "text-green-600"}`}>
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </div>
    );
  }
  if (value === false) {
    return (
      <div className="flex justify-center text-muted-foreground/40">
        <X className="h-4 w-4" strokeWidth={2} />
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <span className="text-xs text-muted-foreground font-medium text-center leading-tight">{value}</span>
    </div>
  );
}

function ComparisonSection() {
  return (
    <section className="py-16 sm:py-24 border-t">
      <div className="container-tight">
        <FadeUp className="mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground mb-5">
            <ShieldCheck className="h-3.5 w-3.5" />
            How we compare
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Built differently by design
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-[15px]">
            Every other app in this space tracks what you do. Axiom tells you why it's not working and fixes it.
          </p>
        </FadeUp>

        <FadeIn>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="min-w-[600px] px-4 sm:px-0">
          <div className="rounded-2xl border overflow-hidden">
            {/* Header */}
            <div className="grid bg-muted/50 border-b" style={{ gridTemplateColumns: "1fr repeat(5, 100px)" }}>
              <div className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Feature</div>
              {COMPETITORS.map((c, i) => (
                <div
                  key={c}
                  className={`px-2 py-3.5 text-center text-xs font-bold ${
                    i === 0 ? "text-foreground bg-foreground/5" : "text-muted-foreground"
                  }`}
                >
                  {c}
                </div>
              ))}
            </div>

            {/* Rows */}
            {COMPARISON_ROWS.map((row, ri) => (
              <motion.div
                key={row.feature}
                className="grid border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                style={{ gridTemplateColumns: "1fr repeat(5, 100px)" }}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: "-20px" }}
                transition={{ delay: ri * 0.03 }}
              >
                <div className="px-5 py-3.5 text-sm">{row.feature}</div>
                {row.values.map((v, ci) => (
                  <div key={ci} className={`px-2 py-3.5 flex items-center justify-center ${ci === 0 ? "bg-foreground/[0.03]" : ""}`}>
                    <CompCell value={v} isAxiom={ci === 0} />
                  </div>
                ))}
              </motion.div>
            ))}
          </div>
          </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── CTA ─────────────────────────────────────────────────────────────────────

function CTASection() {
  const { user } = useAuth();
  return (
    <section className="py-16 sm:py-24 bg-foreground text-background">
      <div className="container-tight text-center">
        <FadeUp>
          <div className="inline-flex items-center gap-2 rounded-full border border-background/20 bg-background/10 px-4 py-1.5 text-xs font-medium text-background/80 mb-6">
            <Flame className="h-3.5 w-3.5" />
            Free to start
          </div>
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4 sm:mb-5">
            Train with a purpose.<br />Know exactly why.
          </h2>
          <p className="text-background/65 max-w-xl mx-auto text-base sm:text-lg mb-8 sm:mb-10">
            Run your first diagnostic free — no credit card, no commitment. See your weakness identified in minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" variant="secondary" className="rounded-xl text-base font-semibold px-8" asChild>
              <Link href={user ? "/snapshot" : "/register"}>
                {user ? "Start a Diagnostic" : "Get Started Free"}
                <ArrowRight className="ml-2 h-4.5 w-4.5" />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" className="rounded-xl text-base text-background/80 hover:text-background hover:bg-background/10 px-8" asChild>
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  const { user } = useAuth();
  return (
    <section className="pt-14 pb-16 sm:pt-20 sm:pb-24 overflow-hidden">
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground mb-6">
              <Target className="h-3.5 w-3.5" />
              Every feature, explained
            </div>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5 leading-tight"
          >
            Stop guessing.<br />Start training with precision.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-muted-foreground text-lg mb-8 sm:mb-10 leading-relaxed"
          >
            Axiom is the only fitness platform that identifies exactly why your lifts are stalling — then builds your program, nutrition, and coaching around that answer. Backed by NASM, ISSA, ACE, and 7,000+ pages of peer-reviewed sports science.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.15 }}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button size="lg" className="rounded-xl text-base font-semibold px-8" asChild>
              <Link href={user ? "/snapshot" : "/register"}>
                {user ? "Start a Diagnostic" : "Try It Free"}
                <ChevronRight className="ml-1 h-4.5 w-4.5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="rounded-xl text-base px-8" asChild>
              <Link href="/pricing">See Pricing</Link>
            </Button>
          </motion.div>
        </div>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-12 sm:mt-16 rounded-2xl border bg-card overflow-hidden grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x"
        >
          <StatPill value="9" label="Supported lifts including Olympic" />
          <StatPill value="5" label="Muscle-group indices per session" />
          <StatPill value="7,000+" label="Pages of research — NASM, ISSA, ACE + more" />
          <StatPill value="4-layer" label="AI nutrition pipeline" />
          <StatPill value="24/7" label="Coaching with full memory" className="col-span-2 sm:col-span-1 border-t sm:border-t-0" />
        </motion.div>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeaturesV2Page() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <AnakinSection />
      <DiagnosticSection />
      <ProgramFlowSection />
      <StrengthProfileSection />
      <PreviewSection />
      <FeatureGrid />
      <ComparisonSection />
      <CTASection />
    </div>
  );
}
