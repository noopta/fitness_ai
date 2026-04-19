import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "deadlift-lower-back",
  title: "Lower Back Pain in Deadlift: Causes and Fixes",
  h1: "Lower Back Pain in Deadlift: How to Fix It",
  metaDescription: "Lower back pain after deadlifts is usually a form breakdown issue — not a reason to stop deadlifting. Here's how to identify the cause and fix it without injuring yourself further.",
  intro: "Lower back pain after deadlifting is extremely common but often misattributed. Most cases are due to technique breakdown under load — specifically losing lumbar bracing — not 'deadlifts are dangerous.' This can be fixed.",
  causes: [
    { heading: "Loss of lumbar position under load", body: "When you can't maintain a neutral lower back through the full rep, the lumbar spine flexes under load. This compresses the posterior intervertebral disc and stresses the ligaments of the lower back." },
    { heading: "Hips rising faster than the bar", body: "If your hips shoot up at the start of the pull, your lower back transitions from a supported, braced position to a compromised flexed position. This is a setup problem." },
    { heading: "Weight too heavy for current back strength", body: "Attempting weights that exceed your lower back's current capacity is the simplest explanation. The fix is building back to it with better technique." },
    { heading: "Not bracing hard enough", body: "Insufficient intra-abdominal pressure before and during the lift reduces spinal stability dramatically. This is the single most important technical factor in deadlift safety." },
  ],
  fixes: [
    { heading: "Reduce weight and rebuild technique with perfect bracing", body: "Drop to 70% of your current max. Focus exclusively on: full breath → 360° brace → lats engaged → hips to bar before pulling. Do not increase weight until this is automatic.", exercises: ["Deadlift (technique work)", "Block Pull (reduced range)"] },
    { heading: "Strengthen your brace with anti-rotation and anti-extension work", body: "Planks, ab wheel rollouts, and Pallof presses strengthen the core's ability to maintain position under load. 3×sets before your deadlift session.", exercises: ["Ab Wheel Rollout", "Plank (weighted)", "Pallof Press", "Dead Bug", "Bird Dog"] },
    { heading: "Romanian deadlifts for controlled loading", body: "RDLs allow you to practice the hip-hinge pattern under load with a more controlled movement. The eccentric is slow and deliberate — ideal for building back strength and patterning.", exercises: ["Romanian Deadlift", "Good Morning", "45-Degree Hyperextension"] },
    { heading: "Use a belt for top sets only", body: "A weightlifting belt enhances intra-abdominal pressure and can protect the lower back during maximal efforts. Use it only for sets above 85%. Train without it otherwise." },
  ],
  faq: [
    { q: "Should I stop deadlifting if my lower back hurts?", a: "Brief lower back soreness after heavy deadlifts (DOMS-like) is normal. Sharp, acute pain or pain that persists more than 3–4 days is a signal to reduce load, fix technique, and consider seeing a sports medicine professional. Do not deadlift through sharp pain." },
    { q: "Is the deadlift bad for the lower back?", a: "No — the evidence consistently shows that heavy, controlled deadlifts reduce lower back injury risk in athletic populations. The issue is almost always technique (rounding under load) or excessive loading, not the movement itself." },
  ],
  relatedPages: [
    { href: "/fix/deadlift-stuck", label: "Why is my deadlift stuck?" },
    { href: "/fix/deadlift-plateau", label: "Breaking a deadlift plateau" },
    { href: "/fix/deadlift-off-floor", label: "Weak deadlift off the floor" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
