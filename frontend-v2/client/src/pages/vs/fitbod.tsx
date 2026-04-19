import { VsPage, VsPageConfig } from "./VsPageTemplate";

const config: VsPageConfig = {
  slug: "fitbod",
  competitorName: "Fitbod",
  competitorSubtitle: "AI workout generator",
  title: "Axiom vs. Fitbod: Which AI Training App Is Better?",
  metaDescription: "Axiom vs Fitbod — which AI training app is better for strength? Fitbod generates workout variety; Axiom diagnoses why your lifts are stuck and builds programs to fix the problem.",
  intro: "Fitbod and Axiom both use AI for training, but they solve different problems. Fitbod generates varied workout plans to prevent boredom. Axiom diagnoses the specific reason your strength isn't progressing and builds a targeted fix.",
  verdict: "Fitbod is great for recreational lifters who want workout variety and a simple interface. Axiom is purpose-built for competitive and serious strength athletes who want to understand and fix specific lift limitations. If your goal is maximizing strength in the squat, bench, and deadlift, Axiom's diagnostic depth is in a different category.",
  rows: [
    { feature: "Lift plateau diagnosis", axiom: 'yes', competitor: 'no', note: "Fitbod adjusts volume; it doesn't diagnose weakness" },
    { feature: "Strength-ratio analysis", axiom: 'yes', competitor: 'no' },
    { feature: "Workout variety generation", axiom: 'partial', competitor: 'yes' },
    { feature: "Exercise history and volume tracking", axiom: 'yes', competitor: 'yes' },
    { feature: "e1RM tracking", axiom: 'yes', competitor: 'partial' },
    { feature: "AI coaching chat", axiom: 'yes', competitor: 'no' },
    { feature: "Nutrition tracking", axiom: 'yes', competitor: 'no' },
    { feature: "Wellness check-ins", axiom: 'yes', competitor: 'no' },
    { feature: "Free tier", axiom: 'yes', competitor: 'partial', note: "Fitbod free tier is very limited" },
    { feature: "Powerlifting / strength sport focus", axiom: 'yes', competitor: 'no' },
  ],
  axiomPros: [
    "Diagnostic engine identifies the specific muscle limiting each lift",
    "Programs are built around fixing a specific weakness — not random variety",
    "AI coach chat for questions between sessions",
    "Nutrition tracking and wellness logging integrated",
    "Free diagnostic — no credit card required",
  ],
  competitorPros: [
    "Large exercise library with alternatives",
    "Automatic volume/muscle recovery tracking",
    "Good for general fitness and workout variety",
    "Clean, polished interface",
    "Works well for gym-goers who don't specialize in powerlifting",
  ],
  whenToChooseAxiom: [
    "You're a strength athlete focused on squat, bench, or deadlift",
    "You want to understand the specific reason your lift is stuck",
    "You need a targeted program, not just varied workouts",
    "You want nutrition and wellness integrated with your training",
  ],
  whenToChooseCompetitor: [
    "You train for general fitness and want workout variety",
    "You want an app that auto-adjusts based on muscle soreness",
    "You have a large library of exercises you rotate through",
    "You're not focused on powerlifting or specific lift PRs",
  ],
  faq: [
    { q: "Does Fitbod help with strength training?", a: "Fitbod does track volume and adjusts based on recovery, which helps with consistency. But it doesn't perform the kind of quantitative strength-ratio analysis that identifies why a specific lift has plateaued. For casual strength training it works; for serious strength athletes, the diagnostic depth isn't there." },
    { q: "How is Axiom's AI different from Fitbod's AI?", a: "Fitbod's AI primarily optimizes workout variety and muscle recovery balance. Axiom's AI uses a deterministic diagnostic engine that computes strength-ratio indexes across your working weights and accessory lifts to identify the specific bottleneck — then generates a program targeting that weakness specifically." },
  ],
};

export default function Page() { return <VsPage config={config} />; }
