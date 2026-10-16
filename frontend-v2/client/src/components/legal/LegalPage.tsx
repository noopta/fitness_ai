// Shared shell + facts for the legal pages (privacy, terms, health-data,
// trainer-terms, affiliate-terms, accessibility). Same markup and classes the
// original privacy.tsx / terms.tsx used, so the pages look identical.
//
// PLACEHOLDERS: values in [SQUARE BRACKETS] are facts the founder/counsel must
// fill before publishing. They render visibly on purpose so nobody ships them
// unnoticed.
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { BrandLogo } from "@/components/BrandLogo";

export const LEGAL = {
  lastUpdated: "16 October 2026",
  termsVersion: "2026-10",
  /** Legal name of the operating entity. */
  entity: "[LEGAL ENTITY NAME]",
  postalAddress: "[POSTAL ADDRESS]",
  euRepresentative: "[EU REPRESENTATIVE]",
  ukRepresentative: "[UK REPRESENTATIVE]",
  /** Replace with the real address once the mailbox exists (suggested: privacy@axiomtraining.io). */
  privacyEmail: "[PRIVACY CONTACT EMAIL — suggest privacy@axiomtraining.io]",
  supportEmail: "inquiries@axiomtraining.io",
  site: "axiomtraining.io",
  /** Web Pro price charged by Stripe (mobile shows the same Stripe price). Keep in sync with pricing. */
  webProPrice: "US$12.99",
} as const;

export function Mail({ to = LEGAL.privacyEmail }: { to?: string }) {
  // Unfilled placeholder: render it visibly, but not as a broken mailto link.
  if (to.startsWith("[")) return <span className="font-medium text-foreground">{to}</span>;
  return <a href={`mailto:${to}`} className="text-primary hover:underline">{to}</a>;
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id}>
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      {children}
    </section>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return <p className="font-medium text-foreground mt-4">{children}</p>;
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-6 mt-2 space-y-1">{children}</ul>;
}

export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <Navbar variant="full" />
      <main className="container-tight py-12 sm:py-16">
        <div className="max-w-3xl mx-auto space-y-6 text-sm text-muted-foreground">
          <h1 className="text-2xl font-bold text-foreground mb-1">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">Last updated: {LEGAL.lastUpdated}</p>
          {intro}
          {children}
        </div>

        <footer className="border-t py-10 mt-12">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BrandLogo height={24} className="h-6 w-auto" />
              <span>Axiom — AI-Powered Strength Training</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
              <Link href="/health-data" className="hover:text-foreground">Consumer Health Data Privacy Policy</Link>
              <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
              <Link href="/accessibility" className="hover:text-foreground">Accessibility</Link>
              <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
