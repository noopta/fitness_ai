import { VsPage, VsPageConfig } from "./VsPageTemplate";

const config: VsPageConfig = {
  slug: "dr-muscle",
  competitorName: "Dr. Muscle",
  competitorSubtitle: "Science-based AI workout app",
  title: "Axiom vs. Dr. Muscle: Which Science-Based Training App Wins?",
  metaDescription: "Axiom vs Dr. Muscle — which AI training app builds more strength? Both use science-based programming. Here's how they differ and which is right for you.",
  intro: "Dr. Muscle and Axiom are both science-based AI training apps. Dr. Muscle focuses on periodized hypertrophy programming. Axiom focuses on diagnosing and fixing lift-specific plateaus. Here's how they differ.",
  verdict: "Dr. Muscle is a solid science-based app for lifters who want periodized programming with minimal setup. Axiom is purpose-built for strength athletes who want to diagnose WHY a specific lift is stuck and get targeted accessory prescriptions. If your primary goal is maximizing competition lifts, Axiom's diagnostic depth is unmatched.",
  rows: [
    { feature: "Lift plateau diagnosis", axiom: 'yes', competitor: 'partial', note: "Dr. Muscle adjusts programming; doesn't identify specific weakness" },
    { feature: "Strength-ratio analysis", axiom: 'yes', competitor: 'no' },
    { feature: "Science-based periodization", axiom: 'yes', competitor: 'yes' },
    { feature: "Auto-regulation (RPE-based)", axiom: 'yes', competitor: 'yes' },
    { feature: "AI coaching chat", axiom: 'yes', competitor: 'partial' },
    { feature: "Nutrition tracking", axiom: 'yes', competitor: 'no' },
    { feature: "Powerlifting / competition focus", axiom: 'yes', competitor: 'partial' },
    { feature: "Social features / friends", axiom: 'yes', competitor: 'no' },
    { feature: "Free tier with full diagnostic", axiom: 'yes', competitor: 'no', note: "Dr. Muscle requires subscription for full features" },
    { feature: "Accessible to beginners", axiom: 'partial', competitor: 'yes' },
  ],
  axiomPros: [
    "Diagnostic engine identifies the exact muscle limiting each lift",
    "Strength-ratio indexes provide quantitative data on muscle imbalances",
    "Free full diagnostic — no credit card needed",
    "Nutrition tracking, wellness check-ins, and social features",
    "AI chat available 24/7 for programming questions",
  ],
  competitorPros: [
    "Designed from the ground up for hypertrophy science",
    "Auto-adjusting periodization based on performance",
    "Works well for general strength and muscle building",
    "Good for lifters who want minimal input and maximum structure",
    "Accessible to beginners and intermediate lifters",
  ],
  whenToChooseAxiom: [
    "You're a competitive powerlifter or serious strength athlete",
    "You want to know specifically which muscle is limiting your lift",
    "You need nutrition and wellness tracking in the same platform",
    "You want a free diagnostic before committing to any program",
  ],
  whenToChooseCompetitor: [
    "You want a fully automated program with minimal input",
    "Your primary goal is hypertrophy rather than powerlifting",
    "You're a beginner who wants a science-backed starting point",
    "You prefer the app to make all programming decisions for you",
  ],
  faq: [
    { q: "Is Dr. Muscle better than Axiom for building muscle?", a: "Dr. Muscle is specifically optimized for hypertrophy periodization, which makes it effective for general muscle building. Axiom's programs target specific weaknesses, which produces better strength gains and — as a byproduct — muscle growth in the specific areas limiting your lifts." },
    { q: "Does Axiom use science-based programming?", a: "Yes — Axiom's diagnostic engine uses validated strength-ratio benchmarks and evidence-based accessory prescriptions. The program templates are built on periodized intensity progressions. The difference is that Axiom's prescription is specific to your diagnostic results rather than a generic template." },
  ],
};

export default function Page() { return <VsPage config={config} />; }
