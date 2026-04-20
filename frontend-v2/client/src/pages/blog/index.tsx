import { Link } from "wouter";
import { ArrowRight, Clock } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

const POSTS = [
  {
    slug: "how-to-break-a-bench-press-plateau",
    title: "How to Break a Bench Press Plateau",
    excerpt: "Stuck on the same bench for months? Identify your exact weak link and start progressing again with these 7 evidence-based strategies.",
    readingMinutes: 6,
    category: "Bench Press",
  },
  {
    slug: "progressive-overload-guide",
    title: "Progressive Overload: The Complete Guide",
    excerpt: "The single most important principle in strength training — what it is, how to apply it correctly, and what to do when it stops working.",
    readingMinutes: 7,
    category: "Programming",
  },
  {
    slug: "strength-training-for-beginners",
    title: "Strength Training for Beginners",
    excerpt: "Everything a new lifter needs: the essential compound movements, how to structure your first program, and how fast you should expect to progress.",
    readingMinutes: 8,
    category: "Beginner",
  },
  {
    slug: "how-much-protein-strength-athletes",
    title: "How Much Protein Do Strength Athletes Need?",
    excerpt: "Evidence-based protein targets with actual numbers. How many grams per pound, when to eat it, and what sources are most effective.",
    readingMinutes: 5,
    category: "Nutrition",
  },
  {
    slug: "best-accessories-squat",
    title: "Best Accessory Exercises for a Bigger Squat",
    excerpt: "The right squat accessories depend entirely on your specific weakness. Learn how to identify it and which exercises fix each problem.",
    readingMinutes: 6,
    category: "Squat",
  },
  {
    slug: "deadlift-form-guide",
    title: "Deadlift Form Guide: Pull Heavy Without Hurting Your Back",
    excerpt: "Proper deadlift technique from setup to lockout. The most common errors, why they happen, and exactly how to correct each one.",
    readingMinutes: 7,
    category: "Deadlift",
  },
  {
    slug: "squat-depth-guide",
    title: "How to Squat Deeper: Fixing the Most Common Depth Problems",
    excerpt: "Can't hit parallel? Three specific causes of squat depth problems and targeted drills to fix each one.",
    readingMinutes: 5,
    category: "Squat",
  },
  {
    slug: "how-to-increase-deadlift",
    title: "How to Increase Your Deadlift",
    excerpt: "Programming principles, weak-point identification, and the best accessories for every specific deadlift bottleneck.",
    readingMinutes: 6,
    category: "Deadlift",
  },
  {
    slug: "powerlifting-vs-bodybuilding",
    title: "Powerlifting vs Bodybuilding: Which Is Right for You?",
    excerpt: "The real differences between training for strength and training for size — and why most recreational lifters should blend both approaches.",
    readingMinutes: 6,
    category: "Programming",
  },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Blog",
  "name": "Axiom Strength Training Blog",
  "url": "https://axiomtraining.io/blog",
  "description": "Evidence-based guides on strength training, programming, nutrition, and lifting technique for powerlifters and strength athletes.",
  "publisher": {
    "@type": "Organization",
    "name": "Axiom",
    "url": "https://axiomtraining.io",
    "logo": { "@type": "ImageObject", "url": "https://axiomtraining.io/axiom-logo.png" }
  },
  "blogPost": POSTS.map(p => ({
    "@type": "BlogPosting",
    "headline": p.title,
    "url": `https://axiomtraining.io/blog/${p.slug}`,
    "description": p.excerpt,
  }))
};

export default function BlogIndexPage() {
  return (
    <>
      <SEO
        title="Strength Training Blog — Axiom"
        description="Evidence-based guides on strength training, powerlifting programming, nutrition, and lifting technique. Written for lifters who want to get stronger, not just inspired."
        canonical="/blog"
        jsonLd={JSON_LD}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          <div className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">Strength Training Blog</h1>
            <p className="text-muted-foreground text-base">
              Evidence-based guides on getting stronger — no filler, no inspiration porn.
            </p>
          </div>

          <div className="space-y-6">
            {POSTS.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="block group">
                <div className="border border-border rounded-xl p-5 hover:bg-muted/40 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{post.category}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock size={10} /> {post.readingMinutes} min</span>
                  </div>
                  <h2 className="text-base font-bold text-foreground mb-1 group-hover:underline">{post.title}</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">{post.excerpt}</p>
                  <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-foreground">
                    Read article <ArrowRight size={12} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
