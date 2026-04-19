import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "bench-press-off-chest",
  title: "Failing Bench Press Off the Chest: How to Fix It",
  h1: "Why You're Failing Bench Press Off the Chest",
  metaDescription: "Failing in the bottom third of the bench press — off the chest — is a chest and anterior delt strength issue. Here are the exact exercises and fixes to build off-the-chest pressing power.",
  intro: "If the bar stalls immediately off your chest — in the bottom third of the press — your pectorals and anterior deltoids aren't generating enough initial force. This is different from a lockout issue and requires different fixes.",
  causes: [
    { heading: "Insufficient chest strength at the stretched position", body: "The pec's force-length curve means it's at a mechanical disadvantage when fully stretched (bar at chest). Building strength specifically in this position requires specific exercises, not just more flat bench." },
    { heading: "Poor motor pattern off the bottom", body: "Many lifters 'wait' a fraction of a second at the bottom of the lift instead of transitioning immediately from eccentric to concentric. This kills momentum and makes the bottom the hardest position." },
    { heading: "Too wide a grip", body: "Excessively wide grips are often taught as 'more chest activation' but can actually reduce force production off the chest by placing the arms in a weaker mechanical position." },
  ],
  fixes: [
    { heading: "Paused bench press — the most direct fix", body: "2–3 second pause at the bottom eliminates the stretch reflex and forces your chest to produce force from a dead stop. Use 80–85% of your regular weight. 3×3–4.", exercises: ["Paused Bench Press", "Spoto Press (1 inch off chest)", "Dead-Stop Floor Press"] },
    { heading: "Low pin press from chest level", body: "Set safety pins at the height of your chest. Set the bar on the pins, fully decompress, then press from a complete dead stop. This eliminates all elastic contribution and is more specific than paused work.", exercises: ["Pin Press (bottom position)", "Floor Press", "Dead Bench"] },
    { heading: "Incline bench press for anterior delt and upper chest", body: "The incline emphasizes the clavicular (upper) pec head and anterior deltoid — both critical contributors to getting the bar moving off the chest. 3×6–8 at 70% of flat bench weight.", exercises: ["Incline Barbell Bench", "Incline Dumbbell Press", "Incline Cable Fly"] },
    { heading: "Build the stretch position with cable flies", body: "Cable flies (low to high) load the pec in its stretched position and build the specific strength you need off the chest. 3×12–15 as a finisher.", exercises: ["Low Cable Fly", "Pec Deck (full stretch emphasis)", "Dumbbell Fly"] },
  ],
  faq: [
    { q: "Does touching the chest matter for off-the-chest strength?", a: "Yes — if you regularly bounce the bar or use a controlled tap without a full stop, you're building strength with elastic contribution from your stretch reflex. Paused and dead-stop work specifically trains the position where most lifters are weakest." },
    { q: "Should I bring the bar lower on the chest?", a: "Most lifters benefit from touching slightly below the nipple line (mid to lower chest). Touching too high (clavicle level) puts the shoulder in an awkward position and reduces mechanical advantage. Find your natural touch point and be consistent." },
  ],
  relatedPages: [
    { href: "/fix/bench-press-stuck", label: "Why is my bench press stuck?" },
    { href: "/fix/bench-press-plateau", label: "Bench press plateau" },
    { href: "/fix/bench-press-lockout", label: "Bench press lockout weakness" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
