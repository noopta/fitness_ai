import { BlogPost } from "./BlogTemplate";

const config = {
  slug: "deadlift-form-guide",
  title: "Deadlift Form Guide: How to Pull Heavy Without Hurting Your Back",
  h1: "Deadlift Form Guide: Pull Heavy Without Hurting Your Back",
  metaDescription: "Learn proper deadlift technique from setup to lockout. This guide covers the most common form mistakes and how to fix them to pull more weight safely.",
  publishedDate: "2026-04-20",
  modifiedDate: "2026-04-20",
  readingMinutes: 7,
  sections: [
    {
      heading: "",
      body: "The deadlift has a reputation for being dangerous, but the evidence doesn't support this. Properly executed deadlifts are one of the safest exercises in the gym and one of the most effective for full-body strength and athletic development. The injuries that do occur almost always come from specific, correctable technique errors — not the exercise itself."
    },
    {
      heading: "The setup: everything starts here",
      body: [
        "Stand with your feet hip-width apart, toes under the bar so the bar is over your mid-foot (about 1 inch from your shins). Hip-width is narrower than most beginners think — your feet should not be at shoulder width.",
        "Hinge at the hips and grip the bar just outside your legs. Push your knees out to meet your arms. At this point, the bar should still be over mid-foot.",
        "Before lifting, take a full breath into your belly (not your chest), brace your core as if you're about to take a punch, and pull your chest up. This creates intra-abdominal pressure that protects your spine."
      ]
    },
    {
      heading: "The pull: legs first, then hips",
      body: [
        "Think of the deadlift as a leg press, not a back exercise. Initiate by driving your feet through the floor — you should feel your hamstrings load as you push the floor away.",
        "Keep the bar in contact with your legs throughout the pull. If the bar drifts forward, it creates a moment arm that dramatically increases the load on your lower back.",
        "As the bar passes your knees, drive your hips forward to lockout. Do not hyperextend your lower back at the top — stand straight with glutes squeezed."
      ]
    },
    {
      heading: "The descent: don't just drop it",
      body: "Hinge at the hips first and push them back, not down. Lower the bar to knee height with control, then bend the knees to lower it to the floor. This is the reverse of the pull. Dropping the bar from the top (unless you're using bumper plates in a training context) removes the eccentric loading benefit and puts the bar in an inconsistent position for the next rep."
    },
    {
      heading: "The most common mistake: back rounding",
      body: [
        "Lower back rounding is the most frequently cited form error and the most misunderstood. Some degree of thoracic (upper back) rounding is acceptable and normal, especially in heavy pulls. What's problematic is excessive lumbar (lower back) rounding, which increases compressive load on the spine's posterior structures.",
        "The fix: pull your chest up before initiating the pull. Think 'big chest' rather than 'arch your back' — this creates thoracic extension while keeping the lumbar region neutral.",
        "If you consistently round even with the cue, your spinal erectors may be the weak link. Romanian deadlifts and good mornings are the most effective targeted fix."
      ]
    },
    {
      heading: "Conventional vs. sumo deadlift",
      body: [
        "The conventional deadlift (feet hip-width, hands outside legs) is generally taught first and is appropriate for the majority of lifters. It requires moderate hip mobility and places more load on the hamstrings and spinal erectors.",
        "The sumo deadlift (wide foot stance, hands inside legs) reduces the range of motion by 20–40% depending on stance width and uses more hip abductor and quad involvement. Some lifters are significantly stronger sumo due to hip anatomy. Neither style is inherently better or safer — the right choice depends on your body proportions."
      ]
    },
    {
      heading: "How to increase your deadlift",
      body: "The deadlift responds well to moderate frequency (2 times per week) and a mix of heavy work (sets of 1–5) and moderate volume (sets of 4–6 at 75–85% of 1RM). The most common bottleneck is lower back fatigue limiting training frequency, which is fixed by strengthening the spinal erectors and improving bracing mechanics — not by reducing training frequency."
    }
  ],
  faq: [
    {
      q: "Is deadlifting dangerous for your lower back?",
      a: "No — when performed with proper technique, the deadlift is one of the safest exercises in strength training. Injuries typically occur due to specific technical errors (excessive lumbar rounding, bar drifting forward) or from progressing load faster than technique and strength allow. Proper form coaching and conservative loading progression makes deadlifting very safe."
    },
    {
      q: "Should I use a belt for deadlifts?",
      a: "A belt is not required and is not a substitute for good bracing mechanics. For beginners, focus on developing proper intra-abdominal pressure without a belt. Once you can consistently brace well on your own, a belt can help you lift more by giving you something to brace against — but it doesn't protect a back that's rounding under load."
    },
    {
      q: "How quickly should I add weight to my deadlift?",
      a: "Beginners can often add 5–10 lbs per session for the first several months. Intermediate lifters should target weekly progress. Never add weight if your technique degraded on the previous session — consistent technique is more important than a faster progression rate."
    }
  ],
  relatedPosts: [
    { href: "/fix/deadlift-stuck", label: "Deadlift stuck? Diagnose it" },
    { href: "/fix/deadlift-lower-back", label: "Fix lower back rounding" },
    { href: "/fix/deadlift-off-floor", label: "Weak off the floor" },
    { href: "/fix/weak-hamstrings-deadlift", label: "Weak hamstrings guide" },
    { href: "/blog/progressive-overload-guide", label: "Progressive overload guide" },
  ]
};

export default function BlogDeadliftForm() {
  return <BlogPost config={config} />;
}
