import { Link } from "wouter";
import { ArrowRight, CheckCircle2, AlertCircle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

export interface FixPageConfig {
  slug: string;
  title: string;
  h1: string;
  metaDescription: string;
  intro: string;
  causes: { heading: string; body: string }[];
  fixes: { heading: string; body: string; exercises?: string[] }[];
  faq: { q: string; a: string }[];
  relatedPages: { href: string; label: string }[];
}

export function FixPage({ config }: { config: FixPageConfig }) {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": config.title,
      "description": config.metaDescription,
      "url": `https://axiomtraining.io/fix/${config.slug}`,
      "datePublished": "2025-01-01",
      "dateModified": "2026-04-20",
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
      "@type": "HowTo",
      "name": config.title,
      "description": config.metaDescription,
      "url": `https://axiomtraining.io/fix/${config.slug}`,
      "step": config.fixes.map((f, i) => ({
        "@type": "HowToStep",
        "position": i + 1,
        "name": f.heading,
        "text": f.body,
        ...(f.exercises?.length ? { "itemListElement": f.exercises.map(ex => ({ "@type": "HowToTip", "text": ex })) } : {})
      }))
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
        canonical={`/fix/${config.slug}`}
        jsonLd={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
            <Link href="/" className="hover:text-foreground transition-colors">Axiom</Link>
            <span>/</span>
            <span>Fix</span>
            <span>/</span>
            <span className="text-foreground font-medium truncate">{config.h1}</span>
          </nav>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">{config.h1}</h1>
          <p className="text-muted-foreground text-base mb-10 leading-relaxed">{config.intro}</p>

          {/* Causes */}
          <section className="mb-10">
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <AlertCircle size={18} className="text-red-500" /> Why it happens
            </h2>
            <div className="space-y-4">
              {config.causes.map((c, i) => (
                <Card key={i} className="p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-1">{c.heading}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* Fixes */}
          <section className="mb-10">
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-600" /> How to fix it
            </h2>
            <div className="space-y-4">
              {config.fixes.map((f, i) => (
                <Card key={i} className="p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-1">{f.heading}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-2">{f.body}</p>
                  {f.exercises && f.exercises.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {f.exercises.map((ex) => (
                        <span key={ex} className="bg-muted text-foreground text-xs font-medium px-2.5 py-1 rounded-full border border-border">
                          {ex}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div className="rounded-2xl bg-foreground text-background p-6 text-center mb-10">
            <p className="text-xs font-semibold text-background/60 mb-1 uppercase tracking-wide">Free tool</p>
            <h2 className="text-lg font-bold mb-2">Get your exact diagnosis in 5 minutes</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Axiom analyzes your working weights and accessory lifts to pinpoint the specific muscle or movement phase holding you back — then builds a targeted program to fix it.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">Start my free diagnostic <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>

          {/* FAQ */}
          <section className="mb-10">
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Lightbulb size={18} className="text-yellow-500" /> Frequently asked questions
            </h2>
            <div className="space-y-4">
              {config.faq.map((item, i) => (
                <div key={i}>
                  <h3 className="text-sm font-semibold text-foreground mb-1">{item.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Related */}
          {config.relatedPages.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">Related guides</h2>
              <div className="flex flex-wrap gap-2">
                {config.relatedPages.map(({ href, label }) => (
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
