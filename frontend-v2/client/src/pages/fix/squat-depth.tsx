import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "squat-depth",
  title: "How to Improve Squat Depth (Fix Squat Depth Problems)",
  h1: "How to Improve Squat Depth",
  metaDescription: "Can't hit depth in the squat? Here's how to diagnose whether it's an ankle mobility, hip mobility, or strength issue — and the exact drills and exercises to fix squat depth.",
  intro: "Failing to hit depth in the squat (thighs parallel to the floor or below) is almost always a mobility issue — either ankle dorsiflexion or hip mobility. The good news: both are fixable with consistent work.",
  causes: [
    { heading: "Ankle dorsiflexion restriction", body: "Limited ankle mobility causes the heel to rise or the torso to pitch excessively forward as you descend. This is the #1 cause of depth problems in lifters who wear modern shoes and sit for long periods." },
    { heading: "Hip impingement or hip flexor tightness", body: "If you feel a 'pinching' sensation in the front of the hip at depth, you have hip impingement (bone-on-bone) or hip flexor tightness. These are different problems with different solutions." },
    { heading: "Thoracic stiffness causing forward lean", body: "Poor thoracic extension forces the lumbar spine to compensate, making it harder to maintain an upright position at depth." },
    { heading: "Weak core — butt wink at depth", body: "'Butt wink' (posterior pelvic tilt at the bottom) is often a flexibility issue but can also indicate insufficient core/glute strength to maintain position under load." },
  ],
  fixes: [
    { heading: "Ankle mobility work — daily", body: "Banded ankle distractions: 2 minutes per side daily. Wall ankle mobility stretch: 3×10 each. Elevate heels temporarily while you build range to continue training the squat pattern.", exercises: ["Banded Ankle Distraction", "Wall Ankle Stretch", "Heel-Elevated Goblet Squat", "Calf Stretch (bent + straight knee)"] },
    { heading: "Hip mobility protocol", body: "90/90 hip stretches, pigeon pose, and deep squat holds (supported) for 5–10 minutes before each squat session. Consistency is more important than intensity.", exercises: ["90/90 Hip Stretch", "Pigeon Pose", "Deep Squat Hold (supported)", "Hip Flexor Couch Stretch"] },
    { heading: "Heel elevation as training tool", body: "Small heel elevation (1–2 inch plates or squat shoes) compensates for ankle restriction and allows you to practice the squat pattern at full depth while building mobility separately. Don't use this as a permanent crutch." },
    { heading: "Box squats to depth to practice the position", body: "Squatting to a box at parallel or below allows you to practice the exact range while giving your hip a moment to relax at depth. Use a controlled descent.", exercises: ["Box Squat (to depth)", "Goblet Squat", "Bodyweight Squat Hold at Bottom"] },
  ],
  faq: [
    { q: "How long to improve squat depth?", a: "With consistent daily ankle and hip mobility work, most people see noticeable improvement in 3–6 weeks. Significant improvement (enough to remove heel elevation) typically takes 2–4 months." },
    { q: "Is it bad to squat with some forward lean?", a: "Moderate forward lean is normal in the back squat — more so in low-bar, less so in front squat. Excessive forward lean that causes the chest to face the floor is a problem for safety and performance. Aim for the chest facing 45° or less toward the floor." },
  ],
  relatedPages: [
    { href: "/fix/squat-stuck", label: "Why is my squat stuck?" },
    { href: "/fix/squat-knee-cave", label: "Squat knee cave" },
    { href: "/fix/weak-quads-squat", label: "Weak quads in squat" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
