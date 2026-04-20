import { BlogPost } from "./BlogTemplate";

const config = {
  slug: "squat-depth-guide",
  title: "How to Squat Deeper: Fixing the Most Common Depth Problems",
  h1: "How to Squat Deeper: Fix Your Depth Problems",
  metaDescription: "Can't hit parallel on your squat? This guide identifies the three most common causes of squat depth problems and gives you specific drills to fix each one.",
  publishedDate: "2026-04-20",
  modifiedDate: "2026-04-20",
  readingMinutes: 5,
  sections: [
    {
      heading: "",
      body: "Squat depth is one of the most common technique problems in the gym. Many lifters load the bar with more weight than they can handle at proper depth, then wonder why their squat isn't progressing. The fix is almost always simpler than expected — the most common depth problems trace to one of three specific causes."
    },
    {
      heading: "Cause 1: Limited ankle dorsiflexion",
      body: [
        "Ankle dorsiflexion (the ability to move your shin forward over your foot) is the most common structural cause of depth problems. When ankle mobility is insufficient, the heels want to rise as you descend — and your body compensates by cutting the squat short.",
        "Test: Can you touch your knee to a wall 4 inches in front of your toes without your heel rising? If not, ankle mobility is likely limiting your depth.",
        "Fix: Daily calf stretching (straight-leg and bent-knee to target both the gastroc and soleus), ankle circles, and heel-elevated squats while you build mobility. Even a 2-inch heel raise can immediately restore depth while you address the underlying limitation."
      ]
    },
    {
      heading: "Cause 2: Hip flexor tightness",
      body: [
        "Tight hip flexors create a pelvic tilt that limits hip flexion — the hip simply runs out of range before you reach parallel. This often manifests as a 'butt wink' (posterior pelvic tilt at the bottom of the squat).",
        "Test: Kneel on one knee and push your hips forward. If you feel strong restriction in the front of the hip of the kneeling leg, hip flexor tightness is present.",
        "Fix: Couch stretch (3 sets of 2 minutes per side), half-kneeling hip flexor stretches, and goblet squats with a slow descent to develop range at the hip. Consistency over weeks produces more change than aggressive single sessions."
      ]
    },
    {
      heading: "Cause 3: Lack of bottom-position strength",
      body: [
        "Sometimes depth is actually available but the lifter subconsciously avoids it because they lack strength and confidence in the bottom position. The body will not allow you to move into positions it doesn't feel it can get out of.",
        "Fix: Pause squats at depth (2–3 second pause just below parallel), box squats to a low box, and goblet squats with kettlebells. These build familiarity and strength at the bottom.",
        "Working with a lighter weight that allows genuine depth and accumulating reps there will produce faster long-term progress than grinding through partial reps at higher loads."
      ]
    },
    {
      heading: "Foot stance and depth",
      body: "Stance width and toe angle significantly affect achievable depth. A slightly wider stance with toes pointed 30–35 degrees outward creates more room for the hips to track between the legs, which often immediately improves depth. Some lifters find significant improvement just from adjusting their stance. Experiment with several widths and angles to find your optimal position before assuming you have a mobility problem."
    },
    {
      heading: "How deep should you squat?",
      body: [
        "Parallel (hip crease at or below knee) is the standard depth for powerlifting and is sufficient to develop complete quad and hip strength. Going below parallel (ass to grass) is not necessary for most lifters and may not be achievable or optimal for all hip anatomies.",
        "In competition, squat depth is judged at the top of the hip crease being at or below the top of the knee. Train to a consistent depth that you can hit reliably under heavy loads — depth that only appears at light weights doesn't count."
      ]
    }
  ],
  faq: [
    {
      q: "Why does my squat depth get worse as I add weight?",
      a: "Under heavier loads, existing mobility limitations become more apparent because you have less time and control to work through them. It also exposes bottom-position strength deficits — your body short-circuits the movement before reaching a depth it can't recover from. Reduce load, work depth specifically, and build back up."
    },
    {
      q: "Does squatting deep damage the knees?",
      a: "The research does not support this concern for healthy knees. Deep squats with proper technique actually develop the ligaments, tendons, and muscles that protect the knee joint. Problems arise from poor alignment (knee caving inward) and excessive forward lean under load, not from depth itself."
    },
    {
      q: "How long does it take to improve squat depth?",
      a: "With daily mobility work targeting the specific limitation (ankles or hip flexors), most lifters see meaningful improvement in 4–8 weeks. Structural limitations (hip anatomy) may permanently limit depth, in which case adjusting stance width is a more effective solution."
    }
  ],
  relatedPosts: [
    { href: "/fix/squat-depth", label: "Fix squat depth (diagnostic)" },
    { href: "/fix/squat-knee-cave", label: "Fix squat knee cave" },
    { href: "/fix/squat-stuck", label: "Squat stuck guide" },
    { href: "/blog/best-accessories-squat", label: "Best squat accessories" },
  ]
};

export default function BlogSquatDepth() {
  return <BlogPost config={config} />;
}
