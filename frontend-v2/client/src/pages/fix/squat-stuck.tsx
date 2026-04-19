import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "squat-stuck",
  title: "Why Is My Squat Stuck? (How to Break a Squat Plateau)",
  h1: "Why Is My Squat Stuck?",
  metaDescription: "Squat not progressing? Here are the most common reasons your squat has plateaued — and the exact fixes, accessories, and programming changes that will get it moving again.",
  intro: "A stalled squat is usually not a 'legs are weak' problem — it's a specific weak link in your squat pattern. The fix depends on where you fail (out of the hole vs. mid-rep) and which muscle group is limiting you (quads, glutes/hips, or upper back).",
  causes: [
    { heading: "Quad weakness out of the hole", body: "Failing in the bottom third (out of the hole) is almost always a quad dominance issue. Your quads drive the initial extension out of the bottom position. If they're weak relative to your posterior chain, you'll get stuck there every time." },
    { heading: "Hip/glute weakness in the mid-range", body: "Failing in the middle third of the squat — when the torso is most forward — indicates glute and hip extensors aren't contributing enough. The glutes are the primary engine mid-rep and at the top." },
    { heading: "Upper back collapse", body: "If your chest caves forward during heavy reps, your upper back can't maintain the rigid torso needed to transfer force efficiently. This is a thoracic extension and lat strength issue, not a leg strength issue." },
    { heading: "Poor bracing and intra-abdominal pressure", body: "Losing your brace under heavy weight dumps force out of the kinetic chain. The squat requires near-maximal bracing before you descend. Most lifters under-brace significantly." },
    { heading: "Lack of specificity in accessories", body: "Doing isolation leg work (leg press, leg extensions) doesn't transfer well to the squat. The squat requires integrated leg and hip drive — accessories need to target the specific weak link in that pattern." },
  ],
  fixes: [
    { heading: "Fix quad weakness with front squats and paused squats", body: "Front squats force an upright torso and maximum quad recruitment. Paused squats (3-second pause in the hole) eliminate the stretch reflex and force your quads to generate strength from scratch.", exercises: ["Front Squat", "Paused Back Squat", "Heel-Elevated Goblet Squat", "Step-Ups", "Bulgarian Split Squat"] },
    { heading: "Build glute strength for mid-range power", body: "Romanian deadlifts and hip thrusts target the glutes at the specific range of motion where they're most needed in the squat. 3×8–10 of each 2× per week will address a glute-limited squat.", exercises: ["Romanian Deadlift", "Barbell Hip Thrust", "Good Mornings", "45-Degree Hyperextensions", "Box Squat"] },
    { heading: "Strengthen your upper back", body: "Barbell rows, pull-ups, and face pulls build the thoracic extensors and lats you need to stay upright under heavy squats. Program 3×8 rows for every pressing set you do.", exercises: ["Barbell Row", "Chest-Supported Row", "Pull-Up", "Face Pull", "Seal Row"] },
    { heading: "Practice bracing with belt work and deliberate cues", body: "Before each heavy set: take a 360° breath into your belly, brace like you're about to get punched, then descend. If you have a belt, use it only for top sets (85%+) — not as a crutch for lighter work." },
  ],
  faq: [
    { q: "Why does my squat go forward when I get heavy?", a: "Forward lean under load is almost always a combination of ankle mobility restriction and/or quad weakness causing the hip to shoot back first. Elevate your heels temporarily and add front squats to diagnose whether it's mobility or strength." },
    { q: "Should I high bar or low bar squat if I'm stuck?", a: "It depends on where you fail. Low bar emphasizes the posterior chain (glutes/hamstrings) and is mechanically advantageous for pure weight on the bar. High bar emphasizes quads and builds more transfer to athletic movements. If you're weak out of the hole, try low bar. If you're strong out of the hole but fail mid-rep, try high bar with more glute work." },
    { q: "How often should I squat to break a plateau?", a: "Most intermediate lifters benefit from squatting 2–3× per week. One heavy day (5s and 3s), one moderate day (8s), and optionally one lighter technique/volume day. More frequency provides more practice reps and more weekly volume." },
  ],
  relatedPages: [
    { href: "/fix/squat-plateau", label: "Breaking a squat plateau" },
    { href: "/fix/squat-depth", label: "Improving squat depth" },
    { href: "/fix/squat-knee-cave", label: "Fixing squat knee cave" },
    { href: "/fix/weak-quads-squat", label: "Weak quads in the squat" },
    { href: "/tools/strength-standards", label: "Strength standards calculator" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
