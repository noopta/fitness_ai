import { VsPage, VsPageConfig } from "./VsPageTemplate";

const config: VsPageConfig = {
  slug: "stronglifts-5x5",
  competitorName: "StrongLifts 5×5",
  competitorSubtitle: "The popular beginner barbell program",
  title: "Axiom vs. StrongLifts 5×5: Which Is Better?",
  metaDescription: "Axiom vs StrongLifts 5×5 — which is better for strength? StrongLifts is a great beginner program. Axiom diagnoses why it stopped working and what to do next.",
  intro: "StrongLifts 5×5 is one of the most popular beginner strength programs ever created. Axiom isn't a competitor — it's what you use when StrongLifts stops working and you don't know why.",
  verdict: "StrongLifts 5×5 is excellent for beginners — simple, effective, and progressive. Once linear progression stops working (typically 3–6 months in), Axiom diagnoses the specific reason your squat, bench, or deadlift has stalled and prescribes the targeted accessories to break through. Think of Axiom as the next step after StrongLifts.",
  rows: [
    { feature: "Beginner linear progression", axiom: 'no', competitor: 'yes', note: "StrongLifts is purpose-built for novice gains" },
    { feature: "Plateau diagnosis", axiom: 'yes', competitor: 'no', note: "Axiom identifies WHY progress stopped" },
    { feature: "Targeted accessory prescription", axiom: 'yes', competitor: 'no', note: "StrongLifts uses minimal accessories by design" },
    { feature: "Works for intermediate/advanced lifters", axiom: 'yes', competitor: 'no' },
    { feature: "AI coaching chat", axiom: 'yes', competitor: 'no' },
    { feature: "Nutrition tracking", axiom: 'yes', competitor: 'no' },
    { feature: "e1RM and strength ratio analysis", axiom: 'yes', competitor: 'no' },
    { feature: "Simple 3-day structure", axiom: 'partial', competitor: 'yes' },
    { feature: "Free to use", axiom: 'yes', competitor: 'yes' },
    { feature: "App available", axiom: 'yes', competitor: 'yes' },
  ],
  axiomPros: [
    "Diagnoses exactly why your StrongLifts progress stopped",
    "Quantitative strength-ratio analysis for all major lifts",
    "Prescribes specific accessories for your weak point",
    "Works for intermediate and advanced lifters",
    "AI coach chat and nutrition tracking included",
  ],
  competitorPros: [
    "Extremely simple — two workouts, alternate daily",
    "No decisions required — perfect for beginners",
    "Built-in deload structure (reduce weight by 10% on failure)",
    "Proven for beginner novice gains over 3–6 months",
    "Massive community and free resources",
  ],
  whenToChooseAxiom: [
    "StrongLifts has stopped working and you've reset 2+ times",
    "You want to understand WHY your bench or squat is stuck",
    "You're past beginner stage and need a diagnostic, not a template",
    "You want personalized accessories rather than a one-size program",
  ],
  whenToChooseCompetitor: [
    "You're brand new to barbell training (under 6 months)",
    "You want simplicity above all — no thinking required",
    "You're still making linear progress session to session",
    "You prefer community and app features over diagnostics",
  ],
  faq: [
    { q: "When should I switch from StrongLifts to Axiom?", a: "When linear progression stops — typically when you've reset 2–3 times on the same lift without breaking through. At that point, you're no longer a beginner and need a diagnostic tool, not another linear template." },
    { q: "Can I run StrongLifts and use Axiom at the same time?", a: "Yes — use Axiom to diagnose why you're stuck, then add the prescribed accessories to your StrongLifts sessions. Many lifters do this successfully in the late-novice phase." },
    { q: "Is StrongLifts or Axiom better for building muscle?", a: "Both build muscle in beginners. For intermediate lifters who've outgrown novice programming, Axiom's targeted approach produces better hypertrophy by addressing muscle imbalances that generic templates miss." },
  ],
};

export default function Page() { return <VsPage config={config} />; }
