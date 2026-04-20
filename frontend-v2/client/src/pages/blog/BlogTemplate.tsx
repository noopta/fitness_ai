import { Link } from "wouter";
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

export interface BlogPostConfig {
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  publishedDate: string;
  modifiedDate: string;
  readingMinutes: number;
  sections: { heading: string; body: string | string[] }[];
  faq: { q: string; a: string }[];
  relatedPosts: { href: string; label: string }[];
}

export function BlogPost({ config }: { config: BlogPostConfig }) {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": config.title,
      "description": config.metaDescription,
      "url": `https://axiomtraining.io/blog/${config.slug}`,
      "datePublished": config.publishedDate,
      "dateModified": config.modifiedDate,
      "author": { "@type": "Organization", "name": "Axiom" },
      "publisher": {
        "@type": "Organization",
        "name": "Axiom",
        "url": "https://axiomtraining.io",
        "logo": { "@type": "ImageObject", "url": "https://axiomtraining.io/axiom-logo.png" }
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": config.faq.map(({ q, a }) => ({
        "@type": "Question",
        "name": q,
        "acceptedAnswer": { "@type": "Answer", "text": a }
      }))
    }
  ];

  return (
    <>
      <SEO
        title={config.title}
        description={config.metaDescription}
        canonical={`/blog/${config.slug}`}
        jsonLd={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
            <Link href="/" className="hover:text-foreground transition-colors">Axiom</Link>
            <span>/</span>
            <Link href="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <span>/</span>
            <span className="text-foreground font-medium truncate">{config.h1}</span>
          </nav>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">{config.h1}</h1>

          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-10">
            <span className="flex items-center gap-1"><Calendar size={12} /> {config.publishedDate}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> {config.readingMinutes} min read</span>
          </div>

          {/* Article body */}
          <div className="space-y-8 mb-12">
            {config.sections.map((section, i) => (
              <section key={i}>
                {section.heading && (
                  <h2 className="text-xl font-bold text-foreground mb-3">{section.heading}</h2>
                )}
                {Array.isArray(section.body)
                  ? section.body.map((para, j) => (
                      <p key={j} className="text-muted-foreground leading-relaxed mb-3 last:mb-0">{para}</p>
                    ))
                  : <p className="text-muted-foreground leading-relaxed">{section.body}</p>
                }
              </section>
            ))}
          </div>

          {/* CTA */}
          <div className="rounded-2xl bg-foreground text-background p-6 text-center mb-12">
            <p className="text-xs font-semibold text-background/60 mb-1 uppercase tracking-wide">Free tool</p>
            <h2 className="text-lg font-bold mb-2">Get a personalized program in 5 minutes</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Axiom diagnoses the exact weak link in your lift and builds a targeted plan to fix it — for free.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">Start my free diagnostic <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>

          {/* FAQ */}
          {config.faq.length > 0 && (
            <section className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Frequently asked questions</h2>
              <div className="space-y-5">
                {config.faq.map((item, i) => (
                  <div key={i}>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{item.q}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Related */}
          {config.relatedPosts.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">Related articles</h2>
              <div className="flex flex-wrap gap-2">
                {config.relatedPosts.map(({ href, label }) => (
                  <Link key={href} href={href} className="text-sm border border-border rounded-lg px-3 py-2 text-foreground hover:bg-muted transition-colors">
                    {label}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
