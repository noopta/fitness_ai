import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { Navbar } from "@/components/Navbar";
import { BrandLogo } from "@/components/BrandLogo";

const FREE_LIMIT = 2;
const STRIPE_PRO_URL = "https://buy.stripe.com/9B614gaQ2gjIdxV26NfUQ01";

const tiers = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try the diagnostic engine and see what's limiting your lifts.",
    cta: "Get started free",
    ctaVariant: "outline" as const,
    href: "/register",
    badge: null,
    features: [
      `${FREE_LIMIT} full diagnostic analyses per day`,
      "All 9 supported lifts (including Olympic)",
      "AI diagnostic interview",
      "Phase breakdown & limiter identification",
      "Accessory prescription",
      "Share your analysis",
    ],
    missing: [
      "Unlimited analyses",
      "Session history",
      "Exercise tutorial videos",
      "Priority support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$12",
    period: "per month",
    description: "Unlimited diagnostics, history, and video tutorials for serious lifters.",
    cta: "Upgrade to Pro",
    ctaVariant: "default" as const,
    href: null, // handled by onClick
    badge: "Most popular",
    features: [
      "Unlimited diagnostic analyses",
      "All 9 supported lifts (including Olympic)",
      "AI diagnostic interview",
      "Phase breakdown & limiter identification",
      "Accessory prescription",
      "Share your analysis",
      "Full session history",
      "Exercise tutorial videos",
      "Priority support",
    ],
    missing: [],
  },
];

export default function Pricing() {
  const { user } = useAuth();

  function handleProClick() {
    const url = user
      ? `${STRIPE_PRO_URL}?client_reference_id=${user.id}`
      : STRIPE_PRO_URL;
    window.open(url, "_blank");
  }

  return (
    <div className="page">
      <Navbar variant="full" />

      <main className="container-tight">
        <section className="py-16 sm:py-24">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground mb-6">
              <Zap className="h-3.5 w-3.5" />
              Simple pricing
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Start free. Upgrade when ready.
            </h1>
            <p className="mt-4 text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Run {FREE_LIMIT} full diagnostics per day for free — no credit card required.
              Go Pro for unlimited analyses and full history access.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2 max-w-3xl mx-auto">
            {tiers.map((tier, i) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              >
                <Card className={`relative card-min rounded-2xl p-7 h-full flex flex-col ${tier.id === "pro" ? "border-primary/50 shadow-md" : ""}`}>
                  {tier.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                        {tier.badge}
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      {tier.name}
                    </div>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-4xl font-semibold tracking-tight">{tier.price}</span>
                      <span className="text-sm text-muted-foreground">/ {tier.period}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      {tier.description}
                    </p>
                  </div>

                  <div className="mt-6 space-y-2.5 flex-1">
                    {tier.features.map((f) => (
                      <div key={f} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
                        <span>{f}</span>
                      </div>
                    ))}
                    {tier.missing.map((f) => (
                      <div key={f} className="flex items-start gap-2.5 text-sm text-muted-foreground/50">
                        <span className="mt-0.5 h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground/30 text-xs">—</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8">
                    {tier.href ? (
                      <Link href={tier.href}>
                        <Button
                          variant={tier.ctaVariant}
                          className="w-full rounded-xl"
                          asChild
                        >
                          <span>
                            {tier.cta}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </span>
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant={tier.ctaVariant}
                        className="w-full rounded-xl bg-gradient-to-r from-primary to-blue-600 font-semibold shadow-lg hover:shadow-xl"
                        onClick={handleProClick}
                      >
                        {tier.cta}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Current plan indicator */}
          {user && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-8 text-center text-sm text-muted-foreground"
            >
              You're currently on the{" "}
              <span className="font-semibold text-foreground capitalize">{user.tier}</span> plan.
              {user.tier === "free" && (
                <span> Upgrade to Pro to unlock unlimited analyses.</span>
              )}
              {user.tier !== "free" && (
                <span> Thanks for supporting LiftOff!</span>
              )}
            </motion.div>
          )}
        </section>

        {/* FAQ */}
        <section className="pb-16 sm:pb-24 max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold tracking-tight mb-6 text-center">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: "What counts as one analysis?",
                a: `A full diagnostic session — where you enter your snapshots, complete the interview, and generate a plan. Free users can run ${FREE_LIMIT} per day. Sessions reset at midnight.`,
              },
              {
                q: "Can I share my analysis without a Pro account?",
                a: "Yes. Sharing is available on all tiers — just click the Share button on your plan page to generate a public link.",
              },
              {
                q: "What lifts are supported?",
                a: "Flat Bench Press, Incline Bench Press, Deadlift, Barbell Back Squat, Barbell Front Squat, Clean & Jerk, Snatch, Power Clean, and Hang Clean.",
              },
              {
                q: "Can I cancel Pro anytime?",
                a: "Yes. Your subscription is month-to-month and you can cancel from the Stripe customer portal at any time. You'll retain Pro access until the end of the billing period.",
              },
            ].map(({ q, a }) => (
              <Card key={q} className="card-min rounded-2xl p-5">
                <div className="text-sm font-semibold">{q}</div>
                <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{a}</div>
              </Card>
            ))}
          </div>
        </section>

        <footer className="border-t py-10">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BrandLogo height={24} className="h-6 w-auto" />
              <span>LiftOff - AI-Powered Lift Diagnostics</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <Link href="/login" className="hover:text-foreground">Sign In</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
