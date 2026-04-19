import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "deadlift-stuck",
  title: "Why Is My Deadlift Stuck? (The Exact Fixes)",
  h1: "Why Is My Deadlift Stuck?",
  metaDescription: "Deadlift not going up? Here are the specific reasons your deadlift has plateaued and the targeted accessories and programming changes to fix each one. Covers off-the-floor weakness, lockout, and back rounding.",
  intro: "A stalled deadlift is one of the most frustrating plateaus because the deadlift is already the lift where most people are strongest. But 'just pull more' isn't a fix. The specific solution depends on where in the pull you're failing.",
  causes: [
    { heading: "Weak off the floor (quad/hip drive)", body: "Failing to break the floor is a starting strength problem — your quads and hip flexors aren't generating enough initial force. This is often a technical issue (hips too high) as much as a strength issue." },
    { heading: "Sticking point at the knee", body: "The knee region is where the bar transitions from a more vertical path to a more horizontal (hip-hinge) path. Weakness here is usually hamstring or glute weakness mid-range." },
    { heading: "Lockout failure (hip extension/glutes)", body: "Failing in the top third — unable to stand fully erect with the bar — is a glute and hip extension weakness. This is particularly common in conventional pullers with proportionally long torsos." },
    { heading: "Back rounding causing missed lifts", body: "Excessive lower back rounding under load dumps the weight forward and creates a mechanical disadvantage. This is usually a lat/upper back strength issue, not just a technique flaw." },
    { heading: "Grip failure before the lift fails", body: "If your grip gives out before your legs and back, you have an artificial ceiling on your deadlift. This is fixable with targeted grip work and doesn't reflect your actual pulling strength." },
  ],
  fixes: [
    { heading: "Fix off-the-floor weakness with deficit pulls", body: "Pulling from a 1–2 inch deficit increases the range of motion and strengthens the starting position. Use 80–85% of your normal deadlift weight for 3×3.", exercises: ["Deficit Deadlift", "Romanian Deadlift", "Leg Press (for quad drive)", "Good Morning", "Block Pull (just below knee)"] },
    { heading: "Attack the knee sticking point with Romanian deadlifts", body: "RDLs move through exactly the range where you're failing and build the hamstring strength required to pull through the mid-range. 3×6–8 with a 3-second eccentric 2× per week.", exercises: ["Romanian Deadlift", "Stiff-Leg Deadlift", "Barbell Hip Thrust", "Kettlebell Swing", "Trap Bar Deadlift"] },
    { heading: "Build lockout strength with rack pulls and hip thrusts", body: "Rack pulls from just below the knee overload the top third of the pull. Barbell hip thrusts isolate glute extension at the exact joint angle of deadlift lockout.", exercises: ["Rack Pull (knee height)", "Barbell Hip Thrust", "Good Morning", "Glute Ham Raise", "Reverse Hyperextension"] },
    { heading: "Brace harder and use your lats to protect the back", body: "Cue 'protect your armpits' to engage your lats and keep the bar close. Before pulling, take a massive breath, brace your abs 360°, and create as much tension as possible before the bar moves." },
    { heading: "Fix grip with chalk, straps strategy, and direct grip work", body: "Use chalk always. For grip development: use straps for top sets (so you can train at real weight) but use no straps for all warm-up sets. Add fat-grip work and plate pinches.", exercises: ["Farmer's Carries", "Plate Pinch", "Dead Hangs (weighted)", "Fat Gripz Barbell Work"] },
  ],
  faq: [
    { q: "Should I sumo or conventional if my deadlift is stuck?", a: "Don't switch just because you're stuck — diagnose where you're failing first. Sumo is more quad/hip dominant and better for proportionally short torso, long leg lifters. Conventional is more hamstring/back dominant. Switching without addressing the underlying weakness rarely helps long-term." },
    { q: "Why does my back round on heavy deadlifts?", a: "Lower back rounding is usually a lat activation issue — your lats aren't engaging to keep the bar close and your thorax rigid. Upper back rounding is a thoracic extensors issue. Both can also be caused by simply attempting weights too heavy for your current back strength — address the specific accessory first." },
    { q: "Is 2× bodyweight deadlift good?", a: "A 2× bodyweight deadlift is generally considered an advanced level for male lifters and elite for female lifters. It represents a significant strength achievement that takes most dedicated lifters 3–5 years to reach." },
  ],
  relatedPages: [
    { href: "/fix/deadlift-plateau", label: "Breaking a deadlift plateau" },
    { href: "/fix/deadlift-lower-back", label: "Lower back pain in deadlift" },
    { href: "/fix/deadlift-off-floor", label: "Weak deadlift off the floor" },
    { href: "/fix/weak-hamstrings-deadlift", label: "Weak hamstrings in deadlift" },
    { href: "/tools/e1rm-calculator", label: "e1RM calculator" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
