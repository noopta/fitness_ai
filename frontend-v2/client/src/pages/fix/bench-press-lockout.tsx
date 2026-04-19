import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "bench-press-lockout",
  title: "Weak Bench Press Lockout: Causes and Fixes",
  h1: "Fixing a Weak Bench Press Lockout",
  metaDescription: "Failing bench press in the top third — can't lock out? This is a triceps strength issue. Here are the exact exercises and programming approach to fix your bench press lockout.",
  intro: "Failing in the top 30% of your bench press — the lockout — is almost always a triceps strength problem. Your pecs do the heavy work off the chest; your triceps must take over and complete the press. If they can't, the rep dies before lockout.",
  causes: [
    { heading: "Triceps are the limiting factor", body: "The pectoralis major contributes maximally in the first two-thirds of the press. At around 90° of elbow flexion, the triceps become the primary mover. If your triceps aren't strong enough relative to your chest, lockout will always be your sticking point." },
    { heading: "Bar path is too vertical (not back toward face)", body: "An optimal bar path traces a slight arc — starting over the chest and ending over the upper chest/chin at lockout. A completely vertical path increases the mechanical disadvantage for the triceps at the top." },
    { heading: "Wrist position breaks down under load", body: "If your wrists are excessively extended (cocked back) during the press, you lose mechanical advantage for the triceps. Wrists should be stacked over elbows at lockout." },
  ],
  fixes: [
    { heading: "Close-grip bench press as primary triceps builder", body: "Move your grip 1–2 finger widths inside shoulder-width. This shifts maximal loading onto the triceps throughout the full range. Program as a main movement: 4×4–6 at 70–75% of your regular bench.", exercises: ["Close-Grip Bench Press", "Board Press (2-board)", "Partial Rep Bench (top half)"] },
    { heading: "Weighted dips for full-range triceps overload", body: "Dips work the triceps through a larger range of motion than bench variants. Add weight with a dip belt once bodyweight dips become easy. 3×6–8 twice per week.", exercises: ["Weighted Dips", "Tricep Pushdown (heavy)", "Overhead Tricep Extension"] },
    { heading: "JM Press for direct lockout strength", body: "The JM press is a hybrid between a skull crusher and a close-grip bench that specifically targets the lockout zone. 3×6–8 at moderate weight.", exercises: ["JM Press", "Skull Crushers", "French Press"] },
    { heading: "Board press and top-range partials", body: "Pressing from a 2–3 board (or pins at top range) overloads only the lockout portion. Use 100–105% of your full bench max for these partial reps to practice locking out heavier weight.", exercises: ["2-Board Press", "Pin Press (top position)", "Slingshot Bench Press"] },
  ],
  faq: [
    { q: "Should I arch more to shorten the range and make lockout easier?", a: "More arch reduces range of motion and can help in a pinch, but it doesn't fix the underlying triceps weakness. Addressing the root cause is more sustainable. That said, learning proper arch and leg drive technique is valuable regardless." },
    { q: "How long to fix a weak lockout?", a: "With focused triceps work programmed 2× per week, most lifters see measurable lockout improvement in 4–6 weeks. A full triceps development block takes 8–12 weeks to manifest in a 1RM test." },
  ],
  relatedPages: [
    { href: "/fix/bench-press-stuck", label: "Why is my bench press stuck?" },
    { href: "/fix/weak-triceps-bench", label: "Weak triceps for bench press" },
    { href: "/fix/bench-press-plateau", label: "Bench press plateau" },
    { href: "/tools/e1rm-calculator", label: "e1RM calculator" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
