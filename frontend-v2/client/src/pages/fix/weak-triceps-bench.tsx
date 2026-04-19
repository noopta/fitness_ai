import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "weak-triceps-bench",
  title: "Weak Triceps for Bench Press: The Fix",
  h1: "Weak Triceps Holding Back Your Bench Press",
  metaDescription: "If your bench press fails at lockout, weak triceps are the culprit. Here are the best triceps exercises specifically for bench press strength — not bodybuilding pump work.",
  intro: "Bench press strength requires chest strength to get the bar moving and triceps strength to finish the rep. Most lifters do plenty of chest work but under-develop the triceps. If you fail at or near lockout, this is your problem.",
  causes: [
    { heading: "Pec-dominant training leaves triceps underdeveloped", body: "Most chest programs emphasize flat and incline pressing variations. These train the triceps to some degree, but not with the specificity or volume required to develop maximal lockout strength." },
    { heading: "The triceps are trained with isolation volume, not strength", body: "Cable pushdowns and kickbacks are fine for hypertrophy, but don't develop the specific neurological strength needed for heavy pressing. You need compound movements with heavy loads." },
    { heading: "Tricep long head is undertrained", body: "The long head of the triceps crosses the shoulder joint and is only fully recruited in overhead or stretched positions. It contributes significantly to bench press lockout and is often the weakest head." },
  ],
  fixes: [
    { heading: "Close-grip bench press as primary strength builder", body: "The most specific triceps builder for bench press strength. Set your grip 1–2 finger widths inside shoulder-width. Train it as a main movement: 4×4–6 at 70–75% of full-bench weight.", exercises: ["Close-Grip Bench Press", "Board Press (2-3 board)"] },
    { heading: "Weighted dips for full range triceps overload", body: "Dips work the triceps through the full range — stretched to lockout. Add weight with a dip belt: 3×6–8. This is the single best triceps exercise for building pressing strength.", exercises: ["Weighted Dips", "Ring Dips"] },
    { heading: "JM Press for lockout-specific strength", body: "The JM Press is a hybrid between close-grip bench and skull crusher. It overloads the mid to top range where triceps are most critical. 3×6–8 at moderate weight.", exercises: ["JM Press", "Skull Crushers (heavy, barbell)", "French Press"] },
    { heading: "Overhead tricep extension for long head", body: "The long head is only maximally recruited when the arm is overhead. Overhead extensions (dumbbell or cable) develop this head specifically.", exercises: ["Overhead Tricep Extension (cable)", "Overhead Tricep Extension (dumbbell)", "Cable Pushdown (straight bar)"] },
  ],
  faq: [
    { q: "How much should my close-grip bench be relative to my full bench?", a: "A well-developed close-grip bench should be 80–85% of your full bench press. If it's less than 75%, your triceps are likely the limiting factor in your regular bench." },
    { q: "Do pushdowns and kickbacks help bench press?", a: "High-rep pump work has some hypertrophy benefit but minimal specific carryover to bench press strength. Prioritize compound pressing variations (close-grip, weighted dips) for strength, then add isolation work for volume." },
  ],
  relatedPages: [
    { href: "/fix/bench-press-stuck", label: "Why is my bench press stuck?" },
    { href: "/fix/bench-press-lockout", label: "Bench press lockout weakness" },
    { href: "/fix/bench-press-plateau", label: "Bench press plateau" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
