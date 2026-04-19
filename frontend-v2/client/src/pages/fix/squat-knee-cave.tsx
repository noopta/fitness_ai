import { FixPage, FixPageConfig } from "./FixPageTemplate";

const config: FixPageConfig = {
  slug: "squat-knee-cave",
  title: "How to Fix Squat Knee Cave (Valgus Collapse)",
  h1: "How to Fix Squat Knee Cave",
  metaDescription: "Knees caving in during squats (knee valgus)? This is a hip abductor and glute medius weakness issue. Here are the exact exercises and cues to fix knee cave permanently.",
  intro: "Knee cave (valgus collapse) during squats — where the knees track inward as you ascend — is typically a hip abductor weakness, particularly the gluteus medius and hip external rotators. It's also sometimes a foot/arch issue.",
  causes: [
    { heading: "Weak glute medius and hip abductors", body: "The glute medius stabilizes the knee by externally rotating and abducting the hip. When it's weak, the femur internally rotates and the knee collapses inward, especially under load." },
    { heading: "Overactive adductors and tight hip flexors", body: "Tight adductors can pull the femur into internal rotation. Hip flexor tightness alters pelvic position and indirectly affects knee tracking." },
    { heading: "Foot pronation", body: "Flat arches cause the foot to collapse inward, which drives the knee medially. Orthotics or squat shoes with a rigid sole can help while you address the root cause." },
    { heading: "Weight too heavy for current motor pattern", body: "At submaximal weights, knee cave may not appear. At near-maximal weights, it emerges because the hip abductors are strong enough to stabilize light loads but not max efforts." },
  ],
  fixes: [
    { heading: "Cue 'knees out' on every single rep", body: "Actively push your knees out over your pinky toes throughout the entire rep — both descent and ascent. Many lifters dramatically reduce knee cave just by adding this cue consistently." },
    { heading: "Banded squats for proprioception and abductor activation", body: "Place a resistance band above the knees. The band provides resistance to push against, activating the hip abductors. Goblet squats and bodyweight squats with a band are excellent warmup exercises.", exercises: ["Banded Goblet Squat", "Banded Bodyweight Squat", "Banded Hip Thrust"] },
    { heading: "Direct glute medius work", body: "Clamshells, side-lying abductions, and lateral band walks directly target the glute medius. 2–3 sets of 15–20 reps 3× per week as accessory work.", exercises: ["Clamshells", "Side-Lying Hip Abduction", "Lateral Band Walk", "Standing Hip Abduction (cable)", "Monster Walk"] },
    { heading: "Reduce load and rebuild the pattern", body: "If knee cave appears at any weight above 60% of your max, reduce load and consciously reinforce the correct pattern. Neural reprogramming takes time — 4–6 weeks of consistent correct reps." },
  ],
  faq: [
    { q: "Is some knee cave okay?", a: "Minimal, momentary valgus under maximal load is seen even in elite powerlifters and isn't necessarily dangerous. Persistent, visible cave under moderate loads is a weakness to address. The goal is zero cave under normal working weights." },
    { q: "Will knee cave cause injury?", a: "Persistent knee valgus under load increases ACL stress and patellofemoral compression. It's a risk factor, not a guarantee. Address it proactively rather than waiting for pain to develop." },
  ],
  relatedPages: [
    { href: "/fix/squat-stuck", label: "Why is my squat stuck?" },
    { href: "/fix/squat-depth", label: "Squat depth problems" },
    { href: "/fix/weak-quads-squat", label: "Weak quads in squat" },
  ],
};

export default function Page() { return <FixPage config={config} />; }
