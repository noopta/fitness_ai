import { VsPage, VsPageConfig } from "./VsPageTemplate";

const config: VsPageConfig = {
  slug: "personal-trainer",
  competitorName: "Personal Trainer",
  competitorSubtitle: "In-person or online coaching",
  title: "Axiom vs. Personal Trainer: Which Is Better for Strength?",
  metaDescription: "Axiom vs. a personal trainer — which is better for diagnosing lift weaknesses and building strength? Compare cost, depth of analysis, and who each is right for.",
  intro: "Personal trainers offer real-time feedback and accountability. Axiom offers a diagnostic depth that most trainers can't provide — a data-driven analysis of your specific strength ratios — at zero cost. Here's how to choose.",
  verdict: "For most intermediate strength athletes stuck on a specific lift, Axiom provides a more targeted diagnostic than a typical personal trainer, at no cost. For beginners who need form coaching and accountability, a good personal trainer remains irreplaceable. The two aren't mutually exclusive — many coaches use Axiom as a diagnostic tool.",
  rows: [
    { feature: "Lift diagnostic (weakness identification)", axiom: 'yes', competitor: 'partial', note: "Most trainers assess visually; Axiom uses quantitative strength ratios" },
    { feature: "Personalized program generation", axiom: 'yes', competitor: 'yes' },
    { feature: "Real-time form correction", axiom: 'no', competitor: 'yes' },
    { feature: "Accountability and check-ins", axiom: 'no', competitor: 'yes' },
    { feature: "Cost", axiom: 'yes', competitor: 'no', note: "Axiom is free; trainers average $60–150/session" },
    { feature: "AI coaching chat (24/7)", axiom: 'yes', competitor: 'partial', note: "Trainers available only during sessions" },
    { feature: "Nutrition tracking and logging", axiom: 'yes', competitor: 'partial' },
    { feature: "Quantitative e1RM tracking", axiom: 'yes', competitor: 'partial' },
    { feature: "Beginner form coaching", axiom: 'no', competitor: 'yes' },
    { feature: "Works with any schedule", axiom: 'yes', competitor: 'no' },
  ],
  axiomPros: [
    "Free diagnostic and program generation — no ongoing cost",
    "Quantitative strength-ratio analysis most trainers don't perform",
    "Available 24/7 — diagnose and adjust at any time",
    "No geographic limitation — works anywhere",
    "AI coach chat for between-session questions",
  ],
  competitorPros: [
    "Real-time visual form correction under load",
    "Accountability and motivation from a human",
    "Can spot you on maximal attempts",
    "Holistic assessment beyond just strength numbers",
    "Better for complete beginners learning technique",
  ],
  whenToChooseAxiom: [
    "You're an intermediate or advanced lifter who knows how to move",
    "You want to know specifically WHY your lift is stuck",
    "You can't afford $200–600/month for a trainer",
    "You prefer self-directed training with data-driven guidance",
    "You want a tool that gives your coach better data to work with",
  ],
  whenToChooseCompetitor: [
    "You're a complete beginner and don't know how to perform compound lifts",
    "You have a history of injury that requires expert movement assessment",
    "You need human accountability to stay consistent",
    "You benefit most from in-person social support and motivation",
  ],
  faq: [
    { q: "Can I use Axiom and a personal trainer together?", a: "Yes — and it works very well. Axiom's diagnostic data gives your trainer concrete numbers to work with, rather than relying purely on observation. Many coaches use it as a programming tool." },
    { q: "Is Axiom better than an online coach?", a: "Axiom is specifically better at quantitative lift diagnostics — identifying the exact muscle limitation from your working weights. Online coaches often provide better accountability and can handle nuanced situations. For pure diagnosis of a stalled lift, Axiom is hard to beat at any price." },
  ],
};

export default function Page() { return <VsPage config={config} />; }
