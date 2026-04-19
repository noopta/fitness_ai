import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "deadlift-off-floor",
  title: "Weak Deadlift Off the Floor: How to Fix Starting Strength",
  h1: "How to Fix a Weak Deadlift Off the Floor",
  metaDescription: "Can't break the floor on your deadlift? Weak starting strength is a quad and hip drive issue. Here are the exact exercises and setup fixes to make your deadlift break the floor with authority.",
  intro: "If the bar barely moves — or moves very slowly — in the first few inches of a deadlift, you have a starting strength problem. This is about generating maximum force before any momentum can build, and it's highly fixable.",
  causes: [
    { heading: "Insufficient leg drive at the start", body: "The first inch of the deadlift is almost entirely quad and glute drive pushing the floor away. If these muscles are weak relative to your pulling muscles, the bar won't break the floor cleanly." },
    { heading: "Hips too high at setup", body: "Setting up with the hips too high turns the pull into a stiff-leg deadlift, removing most of the leg drive contribution. Your shins should be near-vertical and your hips low enough to create an actual leg press component." },
    { heading: "Bar not over mid-foot", body: "Bar starting over the toes (rather than over mid-foot) puts you in a mechanically inefficient position. Even a 1-inch difference significantly reduces starting strength." },
    { heading: "Weak lats at setup", body: "Your lats need to be engaged before the bar moves — they keep the bar path vertical and prevent it from drifting forward, which increases the mechanical disadvantage." },
  ],
  fixes: [
    { heading: "Deficit deadlifts — the primary fix", body: "Pulling from a 1–2 inch deficit increases range of motion and forces you to develop strength from a deeper starting position. Use 80% of your regular weight for 3×3–4.", exercises: ["Deficit Deadlift (1-2 inch)", "Snatch-Grip Deadlift", "Trap Bar Deadlift (low handles)"] },
    { heading: "Fix your setup: bar over mid-foot, hips down", body: "Stand with bar touching your shins, over mid-foot. Hinge down and grip without moving the bar. Push your hips back, engage your lats ('protect your armpits'), and take a massive breath before any tension. The bar path should be perfectly vertical." },
    { heading: "Leg press and front squats for starting quad strength", body: "The leg press specifically targets the quad-dominant push component. Front squats build quads in a hip-hinged position. 3×6–8 of each 2× per week.", exercises: ["Leg Press (heavy)", "Front Squat", "Paused Squat", "Bulgarian Split Squat"] },
    { heading: "Speed pulls at 50–60% for rate of force development", body: "Speed deadlifts with a focus on exploding through the floor as fast as possible build rate of force development (RFD) — the ability to produce force quickly, which is exactly what you need off the floor.", exercises: ["Speed Deadlift (50-60% 1RM)", "Kettlebell Swing", "Clean Pull"] },
  ],
  faq: [
    { q: "Should I use a sumo stance if I'm weak off the floor?", a: "Sumo deadlift is generally stronger off the floor for lifters with good hip mobility because it's a shorter range of motion and more leg-dominant. It may help, but fixing the conventional setup and building quad strength is a more sustainable solution." },
    { q: "How do I know if I'm weak off the floor vs. at lockout?", a: "If the bar barely breaks the floor but once it's moving you can lock it out fine, you're floor-weak. If the bar comes up easily but you can't stand it up, you're lockout-weak. Most fixes are specific to each problem." },
  ],
  relatedPages: [
    { href: "/fix/deadlift-stuck", label: "Why is my deadlift stuck?" },
    { href: "/fix/deadlift-plateau", label: "Deadlift plateau" },
    { href: "/fix/weak-hamstrings-deadlift", label: "Weak hamstrings in deadlift" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
