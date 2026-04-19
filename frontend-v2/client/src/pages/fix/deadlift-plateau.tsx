import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "deadlift-plateau",
  title: "How to Break a Deadlift Plateau (Proven Methods)",
  h1: "How to Break a Deadlift Plateau",
  metaDescription: "Deadlift not going up? These are the proven methods to break a deadlift plateau — including variation selection, posterior chain accessories, and programming resets for intermediate lifters.",
  intro: "The deadlift is the lift where most people stall because it's already their strongest. Generic advice ('eat more, sleep more') doesn't move the needle. Breaking a deadlift plateau requires a specific diagnosis and targeted attack.",
  causes: [
    { heading: "Insufficient posterior chain volume", body: "Deadlifting once per week is often insufficient volume for intermediate and advanced lifters. The posterior chain (hamstrings, glutes, erectors) needs targeted stimulus beyond just the main lift." },
    { heading: "No variation in pulls", body: "Pulling conventional from the floor every single week provides no new stimulus once you've adapted to it. Variations (deficit, rack, sumo, Romanian) attack different portions of the pull." },
    { heading: "Never training to near-maximal loads", body: "If you only pull for sets of 5 at 75–80%, your central nervous system never gets practice recruiting maximum motor units. Occasional heavy singles and doubles build neural efficiency." },
    { heading: "Accumulated spinal fatigue", body: "The deadlift is extremely taxing to the CNS and posterior chain. Without deloads, fatigue accumulates and suppresses performance. Many lifters are stronger after a deload than they've been in months." },
  ],
  fixes: [
    { heading: "Romanian deadlifts as primary accessory (2× per week)", body: "3×6–8 with a 3-second eccentric builds the hamstring and glute strength that drives deadlift performance. Most stuck deadlifters are hamstring-limited.", exercises: ["Romanian Deadlift", "Stiff-Leg Deadlift", "Snatch-Grip Deadlift"] },
    { heading: "Add pull variations", body: "Deficit deadlifts (1–2 inch) build off-the-floor strength. Rack pulls (knee height) build lockout strength. Pick the one that matches your weak point.", exercises: ["Deficit Deadlift", "Rack Pull (knee height)", "Sumo Deadlift (if conventionally specialized)"] },
    { heading: "Program a deload and test", body: "Reduce volume to 50% for one week. The following week, attempt a new max. Most lifters testing after a proper deload set PRs." },
    { heading: "Add direct glute work", body: "Barbell hip thrusts and reverse hyperextensions target the glutes at the exact position needed for deadlift lockout. 3×8–10 twice per week.", exercises: ["Barbell Hip Thrust", "Reverse Hyperextension", "45-Degree Hyperextension"] },
  ],
  faq: [
    { q: "How often should I deadlift if I'm stuck?", a: "Most intermediate lifters benefit from deadlifting 1–2× per week plus 1–2 sessions of deadlift accessories (RDLs, rack pulls). 3× per week of heavy deadlifting is too fatiguing for most." },
    { q: "Does sumo or conventional make a bigger deadlift?", a: "Neither is universally stronger — it depends on limb proportions and leverages. Lifters with long torsos and short legs often favor conventional; short torso, long leg lifters often favor sumo. If you've only done conventional, trying sumo may reveal a new PR." },
  ],
  relatedPages: [
    { href: "/fix/deadlift-stuck", label: "Why is my deadlift stuck?" },
    { href: "/fix/deadlift-lower-back", label: "Deadlift lower back pain" },
    { href: "/fix/deadlift-off-floor", label: "Weak deadlift off the floor" },
    { href: "/tools/e1rm-calculator", label: "e1RM calculator" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
