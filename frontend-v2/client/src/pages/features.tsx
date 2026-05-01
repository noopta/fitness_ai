import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  Brain, Dumbbell, Utensils, Heart, MessageCircle, Sparkles,
  TrendingUp, Users, Zap, Activity, Calendar, Camera,
  BarChart3, Target, ShieldCheck, ArrowRight, Check, X,
  ChevronRight, FlaskConical, Moon, Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { WebAnalytics, trackPageTime } from "@/lib/analytics";
import { SEO } from "@/components/SEO";

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
            <div className="text-[9px] mt-0.5 leading-tight opacity-80 hidden sm:block">
              {d.rest ? "Rest" : d.name.split(" ")[0]}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {exercises.map((ex, i) => (
          <motion.div
            key={ex.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5"
          >
            <div className="h-2 w-2 rounded-full bg-foreground shrink-0" />
            <span className="text-sm font-medium flex-1 truncate">{ex.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{ex.sets}×{ex.reps}</span>
            <span className="text-xs font-medium shrink-0 hidden sm:block">{ex.intensity}</span>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full bg-foreground rounded-full"
            initial={{ width: 0 }}
            animate={{ width: "38%" }}
            transition={{ duration: 1, delay: 0.3 }}
          />
        </div>
        <span className="text-xs text-muted-foreground">Week 3 of 8</span>
      </div>
    </div>
  );
}

function NutritionMock() {
  const macros = [
    { label: "Protein", current: 142, target: 175, color: "#3b82f6", unit: "g" },
    { label: "Carbs", current: 198, target: 240, color: "#f59e0b", unit: "g" },
    { label: "Fat", current: 52, target: 68, color: "#10b981", unit: "g" },
  ];
  const meals = [
    { name: "Greek Yogurt Bowl", cal: 420, time: "8:12 AM", type: "Breakfast" },
    { name: "Chicken Rice Bowl", cal: 680, time: "12:45 PM", type: "Lunch" },
    { name: "Protein Shake", cal: 290, time: "4:00 PM", type: "Snack" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold">1,790</div>
          <div className="text-xs text-muted-foreground">of 2,340 kcal</div>
        </div>
        <div className="text-xs text-right text-muted-foreground">
          <div className="font-semibold text-foreground">550 kcal remaining</div>
          <div>Goal: Strength surplus</div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full bg-foreground rounded-full"
          initial={{ width: 0 }}
          animate={{ width: "76%" }}
          transition={{ duration: 1, delay: 0.2 }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {macros.map((m) => (
          <div key={m.label} className="rounded-xl bg-muted/60 p-2.5">
            <div className="text-[10px] text-muted-foreground mb-1">{m.label}</div>
            <div className="text-sm font-bold">{m.current}{m.unit}</div>
            <div className="text-[10px] text-muted-foreground">of {m.target}{m.unit}</div>
            <div className="h-1 rounded-full bg-muted mt-1.5 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: m.color }}
                initial={{ width: 0 }}
                animate={{ width: `${(m.current / m.target) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.4 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        {meals.map((meal, i) => (
          <motion.div
            key={meal.name}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.08 }}
            className="flex items-center gap-3 rounded-lg px-3 py-2 bg-muted/40"
          >
            <div className="text-[10px] text-muted-foreground w-14 shrink-0">{meal.time}</div>
            <span className="text-sm flex-1 truncate">{meal.name}</span>
            <span className="text-xs font-medium shrink-0">{meal.cal} kcal</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function LifeHappenedMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-muted/40 p-3">
        <div className="text-xs text-muted-foreground mb-1">You told Anakin:</div>
        <div className="text-sm font-medium">"I was sick with a fever for 3 days and missed all my sessions"</div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-900">Illness — Fever</span>
          <span className="text-xs font-bold text-amber-600 uppercase tracking-wide">Moderate</span>
        </div>
        <p className="text-xs text-amber-800 leading-relaxed">
          "Fever triggers protein catabolism and suppresses testosterone. Training intensity should be reduced for 4–5 days post-recovery."
        </p>
      </motion.div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: "🧬", text: "Elevated cortisol depletes muscle glycogen" },
          { icon: "💧", text: "Rehydrate aggressively — 500ml extra/day" },
          { icon: "📅", text: "Shift program back 2 days" },
          { icon: "🥩", text: "High protein today — 1.8g/kg minimum" },
        ].map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + i * 0.07 }}
            className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-snug flex items-start gap-1.5"
          >
            <span>{item.icon}</span>
            <span className="text-muted-foreground">{item.text}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="flex gap-2"
      >
        <button className="flex-1 rounded-lg border py-2 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
          Keep original
        </button>
        <button className="flex-1 rounded-lg bg-foreground text-background py-2 text-xs font-semibold hover:opacity-90 transition-opacity">
          Apply +2 day shift
        </button>
      </motion.div>
    </div>
  );
}

function ChatMock() {
  const messages = [
    { role: "user", text: "My shoulder clicks on the way down during bench. Should I be worried?" },
    {
      role: "ai",
      text: "Based on your last diagnosis — triceps lockout limitation with slight shoulder index deficit — this is likely subscapularis tension during horizontal abduction, not impingement. Try widening your grip 1 finger and actively pulling the bar apart on descent. If it persists past 2 sessions, flag it and we'll adjust.",
    },
    { role: "user", text: "That makes sense. Anything to add before Thursday's session?" },
    {
      role: "ai",
      text: "You logged 5.5h sleep and energy 3/5 today. Dial intensity to ~82% 1RM on your top sets — quality reps over grinding. Prioritize the face pulls as your first accessory, not last.",
    },
  ];
  return (
    <div className="space-y-2.5 max-h-72 overflow-hidden">
      {messages.map((msg, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.12 }}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {msg.role === "ai" && (
            <div className="h-6 w-6 rounded-full bg-foreground flex items-center justify-center shrink-0 mr-2 mt-0.5">
              <Brain className="h-3 w-3 text-background" />
            </div>
          )}
          <div
            className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === "user"
                ? "bg-foreground text-background rounded-br-sm"
                : "bg-muted text-foreground rounded-bl-sm"
            }`}
          >
            {msg.text}
          </div>
        </motion.div>
      ))}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2"
      >
        <span className="text-xs text-muted-foreground flex-1">Ask Anakin anything…</span>
        <div className="h-6 w-6 rounded-lg bg-foreground flex items-center justify-center">
          <ArrowRight className="h-3 w-3 text-background" />
        </div>
      </motion.div>
    </div>
  );
}

function SmartSuggestionsMock() {
  const tips = [
    {
      icon: "😴",
      label: "Sleep Signal",
      text: "5.5h logged — drop bench top set to 82% 1RM and add 90s extra rest between sets.",
    },
    {
      icon: "💪",
      label: "Today's Focus",
      text: "Triceps are your identified limiter. Cue elbow tuck on every rep. Film set 3.",
    },
    {
      icon: "🥗",
      label: "Pre-Workout",
      text: "You're 40g protein behind target at 4PM. Have 200g Greek yogurt before your session.",
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Anakin's tips for today · Upper Power
        </span>
      </div>
      {tips.map((tip, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.12 }}
          className="rounded-xl border bg-muted/40 p-3 flex gap-3"
        >
          <span className="text-xl shrink-0">{tip.icon}</span>
          <div>
            <div className="text-xs font-semibold mb-0.5">{tip.label}</div>
            <div className="text-xs text-muted-foreground leading-snug">{tip.text}</div>
          </div>
        </motion.div>
      ))}
      <div className="rounded-xl border border-dashed bg-muted/20 p-3 space-y-2">
        <div className="text-xs font-semibold">Strength Insight</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full bg-blue-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: "68%" }}
              transition={{ delay: 0.5, duration: 0.8 }}
            />
          </div>
          <span className="shrink-0">Triceps Index: 68 → improving</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Up 6 points since Week 1 — overhead extension volume is working.
        </div>
      </div>
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
const PENTA_ANGLES = [-90, -18, 54, 126, 198]; // pentagon pointing up
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

        {/* Stage selector */}
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
            {/* Left: radar + e1RM */}
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

              {/* SVG Radar */}
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
                    <line
                      key={i}
                      x1={SVG_CX} y1={SVG_CY}
                      x2={SVG_CX + SVG_R * Math.cos(rad)}
                      y2={SVG_CY + SVG_R * Math.sin(rad)}
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
                    <motion.circle
                      key={i} r={3.5} fill="currentColor"
                      animate={{ cx: SVG_CX + r * Math.cos(rad), cy: SVG_CY + r * Math.sin(rad) }}
                      transition={{ duration: 0.7, ease: "easeInOut" }}
                    />
                  );
                })}
                {RADAR_LABELS.map((label, i) => {
                  const rad = (PENTA_ANGLES[i] * Math.PI) / 180;
                  return (
                    <text
                      key={i}
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

            {/* Right: index bars + insights */}
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
  {
    label: "Goals & Motivation",
    tags: ["Short & long-term goals", "Why it matters to you", "Past attempts & what worked", "Commitment level"],
    delay: 0,
  },
  {
    label: "Health & Medical History",
    tags: ["PAR-Q safety screen", "Chronic conditions & medications", "Injuries & joint issues", "Hormonal factors"],
    delay: 0.08,
  },
  {
    label: "Training Background",
    tags: ["Training age", "Current routine & volume", "Working weights on main lifts", "Training style preference"],
    delay: 0.16,
  },
  {
    label: "Nutrition Baseline",
    tags: ["Dietary restrictions", "Current nutrition quality", "Approximate daily protein"],
    delay: 0.24,
  },
  {
    label: "Lifestyle & Recovery",
    tags: ["Sleep quality & quantity", "Daily stress & energy", "Activity level outside gym", "Recovery practices"],
    delay: 0.32,
  },
  {
    label: "Preferences & Logistics",
    tags: ["Days per week available", "Equipment access", "Accountability style"],
    delay: 0.40,
  },
  {
    label: "Body Composition",
    tags: ["Height, weight, body fat %", "Aesthetic priorities", "Weekly food budget"],
    delay: 0.48,
  },
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
          {/* Left: 7 intake sections */}
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

          {/* Right: what gets generated */}
          <div ref={rightRef} className="space-y-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-5">
              What Anakin builds from it
            </div>

            {/* Training program */}
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

            {/* Nutrition plan */}
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

function summarizeOtherApps(values: Array<boolean | string>): string {
  const others = values.slice(1);
  const supportedCount = others.filter((v) => v === true).length;
  const partials = others.filter((v) => typeof v === "string").map((v) => String(v));
  if (supportedCount === 0 && partials.length === 0) return "Not available in competitors";
  if (supportedCount > 0 && partials.length === 0) {
    return `Available in ${supportedCount}/${others.length} competitor apps`;
  }
  if (supportedCount === 0 && partials.length > 0) {
    return `Only partial support elsewhere (${partials.join(", ")})`;
  }
  return `Mixed support: ${supportedCount}/${others.length} apps + partial options`;
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
          {/* Mobile: stacked rows for clean readability */}
          <div className="md:hidden space-y-3">
            {COMPARISON_ROWS.map((row, ri) => (
              <motion.div
                key={row.feature}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-20px" }}
                transition={{ delay: ri * 0.03 }}
                className="rounded-2xl border bg-background p-4 space-y-3"
              >
                <div className="text-sm font-medium">{row.feature}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-foreground/[0.04] px-3 py-2">
                    <div className="font-semibold text-foreground mb-1">Axiom</div>
                    <CompCell value={row.values[0]} isAxiom />
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2">
                    <div className="font-semibold text-muted-foreground mb-1">Other apps</div>
                    <div className="text-muted-foreground leading-snug">
                      {summarizeOtherApps(row.values)}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Tablet/Desktop: full comparison matrix */}
          <div className="hidden md:block overflow-x-auto -mx-4 sm:mx-0">
          <div className="min-w-[680px] px-4 sm:px-0">
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
            <Button size="lg" variant="secondary" className="rounded-xl text-base font-semibold px-8" asChild onClick={() => WebAnalytics.ctaClicked(user ? 'Start a Diagnostic' : 'Get Started Free', 'cta_section')}>
              <Link href={user ? "/snapshot" : "/register"}>
                {user ? "Start a Diagnostic" : "Get Started Free"}
                <ArrowRight className="ml-2 h-4.5 w-4.5" />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" className="rounded-xl text-base text-background/80 hover:text-background hover:bg-background/10 px-8" asChild onClick={() => WebAnalytics.pricingViewed()}>
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
            <Button size="lg" className="rounded-xl text-base font-semibold px-8" asChild onClick={() => WebAnalytics.ctaClicked(user ? 'Start a Diagnostic' : 'Try It Free', 'hero')}>
              <Link href={user ? "/snapshot" : "/register"}>
                {user ? "Start a Diagnostic" : "Try It Free"}
                <ChevronRight className="ml-1 h-4.5 w-4.5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="rounded-xl text-base px-8" asChild onClick={() => WebAnalytics.pricingViewed()}>
              <Link href="/pricing">See Pricing</Link>
            </Button>
          </motion.div>
        </div>

        {/* Stats bar — 2-col grid on mobile, 5-col on sm+ */}
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

const LANDING_JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Axiom",
    "url": "https://axiomtraining.io",
    "logo": "https://axiomtraining.io/axiom-logo.png",
    "sameAs": ["https://axiomtraining.io"],
    "description": "AI-powered strength training platform that diagnoses why your lifts are stuck and builds targeted programs to fix them.",
    "contactPoint": { "@type": "ContactPoint", "contactType": "customer support", "email": "team@airthreads.ai" }
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Axiom",
    "applicationCategory": "HealthApplication",
    "operatingSystem": "Web, iOS, Android",
    "description": "AI-powered strength training diagnostic tool that identifies exactly why your bench press, squat, or deadlift is stuck and builds a targeted program.",
    "url": "https://axiomtraining.io",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Free lift diagnostic — no credit card required"
    },
    "featureList": ["Lift diagnostic", "AI coaching", "Nutrition planning", "Strength tracking", "Workout logging"]
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Why is my bench press stuck?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "The most common reasons a bench press stalls are: weak triceps at lockout, poor leg drive, insufficient chest strength off the bottom, or programming errors like too much volume. Axiom's diagnostic tool collects your working weights and RPE, then pinpoints the exact weak link in your press."
        }
      },
      {
        "@type": "Question",
        "name": "How does Axiom's lift diagnostic work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "You enter your working weights and rep counts for your main lift and key accessories. Axiom's engine computes strength-ratio indexes (quad index, posterior index, triceps index, etc.) and compares them against optimal ratios, then surfaces the specific muscle group or movement phase that is limiting your progress."
        }
      },
      {
        "@type": "Question",
        "name": "Is Axiom free to use?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. The full lift diagnostic — including weakness identification and a targeted accessory program — is free with no credit card required. A Pro tier unlocks unlimited diagnostics, AI coaching chat, and advanced analytics."
        }
      },
      {
        "@type": "Question",
        "name": "What lifts does Axiom support?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Axiom currently supports Flat Bench Press, Incline Bench Press, Barbell Back Squat, Barbell Front Squat, Deadlift, Clean & Jerk, Snatch, Power Clean, and Hang Clean."
        }
      }
    ]
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": "How to diagnose why your lift is stuck",
    "description": "Use Axiom to find your exact weakness and fix your stalled lift in 5 minutes.",
    "step": [
      {
        "@type": "HowToStep",
        "name": "Enter your main lift",
        "text": "Select your lift (bench press, squat, deadlift, etc.) and enter your current working weight, sets, and reps."
      },
      {
        "@type": "HowToStep",
        "name": "Log your accessory lifts",
        "text": "Enter weights for key accessories like close-grip bench, Romanian deadlift, front squat, and others as prompted."
      },
      {
        "@type": "HowToStep",
        "name": "Answer the diagnostic interview",
        "text": "Axiom's AI coach asks targeted questions about where you fail reps, how long you've been stuck, and your training history."
      },
      {
        "@type": "HowToStep",
        "name": "Get your targeted program",
        "text": "Axiom generates a personalized accessory program that attacks your specific weakness with the right exercises, sets, reps, and intensity."
      }
    ]
  }
];

export default function FeaturesPage() {
  useEffect(() => {
    // Store affiliate referral code from URL for use at registration
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem('axiom_referral', ref.toUpperCase().trim());
    return trackPageTime('features');
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <SEO
        canonical="/"
        description="Axiom diagnoses exactly why your bench press, squat, or deadlift is stuck — using your working weights and training data. Free lift diagnostic. No credit card required."
        jsonLd={LANDING_JSON_LD}
      />
      <Navbar />
      <HeroSection />
      <AnakinSection />
      <DiagnosticSection />
      <ProgramFlowSection />
      <StrengthProfileSection />
      <FeatureGrid />
      <ComparisonSection />
      <CTASection />
    </div>
  );
}
