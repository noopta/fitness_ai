import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "weak-quads-squat",
  title: "Weak Quads in the Squat: How to Build Quad Strength",
  h1: "Weak Quads Holding Back Your Squat",
  metaDescription: "Failing out of the hole in your squat? Weak quads are the most common reason squats stall at intermediate level. Here are the best quad-building exercises for squat strength.",
  intro: "The quads are the primary driver of knee extension — the initial movement out of the bottom of the squat. If you fail in the first third of the squat, out of the hole, quad weakness is almost always the reason.",
  causes: [
    { heading: "Posterior chain dominance", body: "Lifters who do a lot of hip-hinge work (deadlifts, Romanian deadlifts, hip thrusts) often develop strong glutes and hamstrings but relatively undertrained quads. This creates a muscle imbalance that manifests as out-of-the-hole weakness." },
    { heading: "Insufficient quad-specific volume", body: "The squat works the quads, but not as specifically as front squats, leg press, and Bulgarian split squats. If you only squat and deadlift, your quads may be undertrained." },
    { heading: "Stance that de-emphasizes quads", body: "Very wide stances with significant hip external rotation make the squat more glute/hip dominant and reduce quad recruitment. Narrowing stance slightly can make the squat more quad-focused." },
  ],
  fixes: [
    { heading: "Front squats as the primary quad builder", body: "The front squat requires maximum quad strength due to the upright torso — the quads can't offload to the hips. Use front squats as a secondary movement at 60–70% of back squat weight: 3×4–6.", exercises: ["Front Squat", "Paused Front Squat", "Zombie Front Squat"] },
    { heading: "Paused back squats for out-of-hole strength", body: "3-second paused squats in the bottom position eliminate the stretch reflex and force quads to produce strength from scratch — exactly replicating the weakness. Use 80% of working weight.", exercises: ["Paused Back Squat", "Box Squat (below parallel)", "Heel-Elevated Squat"] },
    { heading: "Bulgarian split squats for unilateral quad development", body: "BSS are brutally effective for quad hypertrophy and strength. They eliminate any ability to compensate with the stronger leg. 3×8–10 each side.", exercises: ["Bulgarian Split Squat", "Rear-Foot Elevated Split Squat", "Lunges (walking barbell)"] },
    { heading: "Leg press as volume tool", body: "The leg press allows very high quad-specific volume without the technical demands of barbell squatting. Use it as an accessory: 3–4×10–15 to build quad mass.", exercises: ["Leg Press (high volume)", "Hack Squat Machine", "Leg Extension (for knee extension isolation)"] },
  ],
  faq: [
    { q: "How do I know if my squat failure is quads vs. glutes?", a: "Quad-limited squats fail immediately out of the hole — the first 30% of the ascent. Glute-limited squats fail in the middle, when the torso is most horizontal. If you can stand up slightly and then fail, it's glutes. If you can barely get off the bottom, it's quads." },
    { q: "Will a narrower stance help my quad weakness?", a: "Yes — a slightly narrower stance with feet pointing forward increases quad recruitment and reduces hip dominance. You may need to address ankle mobility to handle the more upright position." },
  ],
  relatedPages: [
    { href: "/fix/squat-stuck", label: "Why is my squat stuck?" },
    { href: "/fix/squat-plateau", label: "Squat plateau" },
    { href: "/fix/squat-depth", label: "Squat depth issues" },
    { href: "/fix/squat-knee-cave", label: "Squat knee cave" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
