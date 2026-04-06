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
            <div className="rounded-2xl border border-background/15 bg-background/[0.07] backdrop-blur p-5">
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

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <AnakinSection />
      <DiagnosticSection />
      <FeatureGrid />
      <ComparisonSection />
      <CTASection />
    </div>
  );
}
