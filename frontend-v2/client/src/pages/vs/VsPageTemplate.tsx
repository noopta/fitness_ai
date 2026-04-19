import { Link } from "wouter";
import { ArrowRight, Check, X, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";

type FeatureStatus = 'yes' | 'no' | 'partial';

interface ComparisonRow {
  feature: string;
  axiom: FeatureStatus;
  competitor: FeatureStatus;
  note?: string;
}

export interface VsPageConfig {
  slug: string;
  competitorName: string;
  competitorSubtitle: string;
  title: string;
  metaDescription: string;
  intro: string;
  verdict: string;
  rows: ComparisonRow[];
  axiomPros: string[];
  competitorPros: string[];
  whenToChooseAxiom: string[];
  whenToChooseCompetitor: string[];
  faq: { q: string; a: string }[];
}

function StatusIcon({ status }: { status: FeatureStatus }) {
  if (status === 'yes') return <Check size={16} className="text-green-600" />;
  if (status === 'no') return <X size={16} className="text-red-500" />;
  return <Minus size={16} className="text-yellow-500" />;
}

export function VsPage({ config }: { config: VsPageConfig }) {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": config.title,
      "description": config.metaDescription,
      "url": `https://axiomtraining.io/vs/${config.slug}`,
      "publisher": { "@type": "Organization", "name": "Axiom", "url": "https://axiomtraining.io" }
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
        canonical={`/vs/${config.slug}`}
        jsonLd={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
            <Link href="/" className="hover:text-foreground transition-colors">Axiom</Link>
            <span>/</span>
            <span>vs</span>
            <span>/</span>
            <span className="text-foreground font-medium">{config.competitorName}</span>
          </nav>

          {/* Header */}
          <div className="text-center mb-10">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
              Axiom vs. {config.competitorName}
            </h1>
            <p className="text-muted-foreground text-base max-w-xl mx-auto">{config.intro}</p>
          </div>

          {/* Verdict card */}
          <Card className="p-5 mb-8 border-2 border-foreground">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Bottom line</p>
            <p className="text-sm text-foreground leading-relaxed">{config.verdict}</p>
          </Card>

          {/* Feature comparison table */}
          <div className="overflow-x-auto mb-10">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-4 py-3 font-semibold text-foreground rounded-tl-lg">Feature</th>
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Axiom</th>
                  <th className="text-center px-4 py-3 font-semibold text-foreground rounded-tr-lg">{config.competitorName}</th>
                </tr>
              </thead>
              <tbody>
                {config.rows.map((row, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                    <td className="px-4 py-3 text-foreground">
                      {row.feature}
                      {row.note && <p className="text-xs text-muted-foreground mt-0.5">{row.note}</p>}
                    </td>
                    <td className="px-4 py-3 text-center"><span className="flex justify-center"><StatusIcon status={row.axiom} /></span></td>
                    <td className="px-4 py-3 text-center"><span className="flex justify-center"><StatusIcon status={row.competitor} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-4 mt-2 px-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Check size={12} className="text-green-600" /> Yes</span>
              <span className="flex items-center gap-1"><X size={12} className="text-red-500" /> No</span>
              <span className="flex items-center gap-1"><Minus size={12} className="text-yellow-500" /> Partial</span>
            </div>
          </div>

          {/* Pros/cons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10">
            <Card className="p-5">
              <h2 className="text-sm font-bold text-foreground mb-3">Axiom strengths</h2>
              <ul className="space-y-2">
                {config.axiomPros.map((pro, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check size={14} className="text-green-600 mt-0.5 shrink-0" /> {pro}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="text-sm font-bold text-foreground mb-3">{config.competitorName} strengths</h2>
              <ul className="space-y-2">
                {config.competitorPros.map((pro, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check size={14} className="text-blue-500 mt-0.5 shrink-0" /> {pro}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* When to choose */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10">
            <Card className="p-5 border-2 border-foreground">
              <h2 className="text-sm font-bold text-foreground mb-3">Choose Axiom if…</h2>
              <ul className="space-y-2">
                {config.whenToChooseAxiom.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-foreground shrink-0" /> {item}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="text-sm font-bold text-foreground mb-3">Choose {config.competitorName} if…</h2>
              <ul className="space-y-2">
                {config.whenToChooseCompetitor.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" /> {item}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* CTA */}
          <div className="rounded-2xl bg-foreground text-background p-6 text-center mb-10">
            <h2 className="text-lg font-bold mb-2">Try Axiom free — no credit card</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Get a full lift diagnostic and targeted program in 5 minutes. Free forever.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">Start my free diagnostic <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>

          {/* FAQ */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4">Frequently asked questions</h2>
            <div className="space-y-4">
              {config.faq.map((item, i) => (
                <div key={i}>
                  <h3 className="text-sm font-semibold text-foreground mb-1">{item.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
