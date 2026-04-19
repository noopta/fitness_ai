import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "squat-plateau",
  title: "How to Break a Squat Plateau (Proven Methods)",
  h1: "How to Break a Squat Plateau",
  metaDescription: "Stuck on the same squat weight for weeks? These are the exact programming changes, accessory exercises, and technique fixes that break squat plateaus for intermediate and advanced lifters.",
  intro: "A squat plateau means your training isn't providing enough stimulus for continued adaptation. The right fix depends on your training history and where in the lift you're failing.",
  causes: [
    { heading: "Not enough posterior chain volume", body: "Most lifters squat a lot and neglect the hamstrings, glutes, and lower back that make up the posterior chain. These muscles are critical for both safety and performance in the squat." },
    { heading: "Intensity too low — too many sets in the 8–12 range", body: "If you never train with heavy singles, doubles, and triples (85%+), you're under-developing the neurological strength component of your squat. Neural adaptations require heavy loads." },
    { heading: "Accumulated fatigue from high volume work", body: "High-volume squat programs accumulate fatigue rapidly. If you've been running high volume for 10+ weeks, your numbers may be suppressed by fatigue rather than actually being limited." },
    { heading: "Technical breakdown under heavy load", body: "A perfect squat at 80% that falls apart at 90% indicates insufficient practice reps at high percentages, or a technique dependency on submaximal loads." },
  ],
  fixes: [
    { heading: "Add heavy singles and triples to your program", body: "Once per week, work up to a daily max or a challenging triple. This builds the neurological component of strength and gives you data on where you actually stand.", exercises: ["Back Squat (heavy single)", "Paused Back Squat", "Box Squat (heavy)"] },
    { heading: "Romanian deadlifts and hip thrusts for posterior chain", body: "3×6–8 RDLs and 3×8–10 barbell hip thrusts twice per week will build the posterior chain most squat programs neglect.", exercises: ["Romanian Deadlift", "Barbell Hip Thrust", "Good Morning", "Glute Ham Raise"] },
    { heading: "Take a deload week and reset", body: "Drop to 50% of normal volume for one week. Keep some intensity. The following week, attempt a PR — most lifters are surprised to hit one after proper recovery." },
    { heading: "Add front squats as a variation", body: "Front squats force upright posture and quad dominance, addressing one of the most common squat limitations. Use them as a secondary movement at 60–70% of your back squat weight.", exercises: ["Front Squat", "Heel-Elevated Squat", "Goblet Squat"] },
  ],
  faq: [
    { q: "Why do my squat numbers fluctuate so much?", a: "The squat is highly sensitive to sleep, hydration, fatigue, and warm-up quality. Short-term fluctuations of ±5% are normal. What matters is the long-term trend over 4–6 week blocks." },
    { q: "Should I add more squat days to break a plateau?", a: "For most intermediate lifters, the issue isn't frequency but specificity. Adding a third squat day without addressing the weak link just adds fatigue. Fix the weakness first, then consider adding frequency." },
  ],
  relatedPages: [
    { href: "/fix/squat-stuck", label: "Why is my squat stuck?" },
    { href: "/fix/squat-depth", label: "Improving squat depth" },
    { href: "/fix/squat-knee-cave", label: "Squat knee cave fix" },
    { href: "/tools/strength-standards", label: "Strength standards" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
