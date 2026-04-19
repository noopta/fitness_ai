import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "weak-hamstrings-deadlift",
  title: "Weak Hamstrings in the Deadlift: How to Fix It",
  h1: "How to Fix Weak Hamstrings in the Deadlift",
  metaDescription: "Failing at the knee on the deadlift or struggling with mid-pull? Weak hamstrings are usually the culprit. Here are the best hamstring exercises for deadlift strength.",
  intro: "The hamstrings are the primary driver of the mid-range in the conventional deadlift — from the floor to the knee. A hamstring limitation shows up as the bar slowing or stopping around knee height, or the hips shooting up as you transition through this zone.",
  causes: [
    { heading: "Hamstrings undertrained relative to quads", body: "Most strength programs emphasize quad-dominant movements (squats, leg press). Hamstrings receive far less direct training volume than they need for a strong deadlift." },
    { heading: "Hip-hinge pattern weakness", body: "Hamstrings produce force in a hip-hinge movement through knee flexion and hip extension. If you rarely practice hip hinges at high intensity, the hamstrings never develop sufficient pulling strength." },
    { heading: "Poor hamstring length-tension relationship", body: "Chronically short hamstrings (common in desk workers) are weak in the lengthened position — which is exactly where they need to be strong in the deadlift." },
  ],
  fixes: [
    { heading: "Romanian deadlifts — the most specific fix", body: "RDLs are the single best hamstring exercise for deadlift strength. They train the hamstring in its lengthened position with a hip-hinge movement pattern. 3×6–8 with a 3-second eccentric, 2× per week.", exercises: ["Romanian Deadlift", "Stiff-Leg Deadlift", "Single-Leg Romanian Deadlift"] },
    { heading: "Glute ham raise for eccentric hamstring strength", body: "The GHR is one of the most demanding hamstring exercises. It trains both knee flexion and hip extension simultaneously and has strong carryover to the deadlift.", exercises: ["Glute Ham Raise", "Nordic Hamstring Curl", "Lying Leg Curl (heavy)"] },
    { heading: "Good mornings for hip-hinge strength", body: "Good mornings build the ability to maintain position under load with a hip hinge — directly applicable to the deadlift mid-range.", exercises: ["Good Morning (barbell)", "Seated Good Morning", "Cable Pull-Through"] },
    { heading: "Kettlebell swings for rate of force development", body: "Swings train explosive hip extension through the range the hamstrings are most critical. 4×15 as a power development exercise.", exercises: ["Kettlebell Swing", "Band Pull-Through", "Clean Pull"] },
  ],
  faq: [
    { q: "How do I know if it's my hamstrings or my lower back limiting my deadlift?", a: "Lower back limitation usually shows up as rounding or pain under load. Hamstring limitation shows up as the hips shooting up through the mid-range as the hamstrings can't maintain tension. If your back is fine but the bar slows at the knee, it's hamstrings." },
    { q: "How many sets of hamstring work per week for deadlift?", a: "Most stuck deadlifters need 10–16 sets of direct hamstring work per week — significantly more than they're currently doing. Split across 2–3 sessions, focusing on RDLs, GHRs, and leg curls." },
  ],
  relatedPages: [
    { href: "/fix/deadlift-stuck", label: "Why is my deadlift stuck?" },
    { href: "/fix/deadlift-plateau", label: "Deadlift plateau" },
    { href: "/fix/deadlift-off-floor", label: "Weak deadlift off the floor" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
