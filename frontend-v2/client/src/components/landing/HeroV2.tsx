// Hero v2 — the headline + a real iPhone screenshot of the Strength Profile.
// Spec: handoff §05. Three changes vs. the original hero:
//   • A right-column phone visual replaces the centered text-only layout.
//   • App Store badges (iOS live, Play "coming soon") sit beneath the CTA pair.
//   • A compact social-proof stack ("5.0 ★ · App Store", "+24 lb bench", "87% broke a plateau")
//     anchors the column before the user scrolls.
//
// The existing 5-pill stats row still sits below the hero grid — handoff calls
// it `HeroStatsRow` and keeps it unchanged. We pass that in as `statsRow`.

import { Link } from "wouter";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { WebAnalytics } from "@/lib/analytics";
import { AppStoreBadge } from "./AppStoreBadge";

/**
 * Country-neutral App Store URL — Apple redirects to the user's storefront
 * automatically. The country-prefixed form
 * (https://apps.apple.com/us/app/axiom-ai-personal-trainer/id6761032954) would
 * pin every visitor to the US store.
 */
const APPLE_APP_STORE_URL = "https://apps.apple.com/app/id6761032954";

interface Props {
  /** Existing HeroStatsRow (the 5 stat pills) — rendered below the grid, unchanged from v1. */
  statsRow?: React.ReactNode;
}

function StarRow({ size = 14, color = "#f59e0b" }: { size?: number; color?: string }) {
  return (
    <div className="inline-flex" style={{ gap: 1 }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <path d="M12 .587l3.668 7.568L24 9.75l-6 5.852L19.336 24 12 19.897 4.664 24 6 15.602 0 9.75l8.332-1.595z" />
        </svg>
      ))}
    </div>
  );
}

/** Three compact proof rows under the hero CTA pair. Same numbers as the
 *  full Social Proof section below but condensed to a single column so they
 *  fit alongside the headline. */
function HeroSocialProofStack() {
  return (
    <div
      className="flex flex-col"
      style={{ marginTop: 28, gap: 12, maxWidth: 460 }}
    >
      <div className="flex items-center gap-3">
        <StarRow />
        <div style={{ lineHeight: 1.2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#09090b" }}>
            5.0
          </span>
          <span className="text-muted-foreground" style={{ fontSize: 13 }}>
            {" · App Store · Early reviews"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span style={{ fontWeight: 700, color: "#09090b" }}>+24 lb</span>
        <span className="text-muted-foreground">avg. bench in 12 weeks</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span style={{ fontWeight: 700, color: "#09090b" }}>87%</span>
        <span className="text-muted-foreground">broke a plateau in 6 wks</span>
      </div>
    </div>
  );
}

/** Black iPhone bezel framing the hero screenshot. Aspect ratio locked at
 *  1:2.16 (iPhone 11+) so the height auto-derives from `width`. */
function PhoneImageFrame({ src, width = 300, alt }: { src: string; width?: number; alt: string }) {
  const innerWidth = width - 14;
  const innerHeight = Math.round(innerWidth * 2.16);
  return (
    <div
      style={{
        width,
        padding: 7,
        background: "#111111",
        borderRadius: 38,
        boxShadow:
          "0 30px 80px -30px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 32,
          overflow: "hidden",
          width: innerWidth,
          height: innerHeight,
        }}
      >
        <img
          src={src}
          alt={alt}
          loading="eager"
          decoding="async"
          width={innerWidth}
          height={innerHeight}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }}
        />
      </div>
    </div>
  );
}

export function HeroV2({ statsRow }: Props) {
  const { user } = useAuth();
  return (
    <section className="pt-14 pb-16 sm:pt-20 sm:pb-24 overflow-hidden">
      <div className="container-tight">
        <div
          className="grid items-center gap-10 md:gap-14"
          style={{ gridTemplateColumns: "1fr" }}
        >
          {/* Two-column layout: text left, phone right. Collapses to single column on small screens. */}
          <div className="md:grid md:items-center md:gap-14" style={{ gridTemplateColumns: "1.05fr 0.95fr" }}>
            {/* Left — content stack */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              className="max-w-xl mx-auto md:mx-0 text-center md:text-left"
            >
              <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                Every feature, explained
              </div>
              <h1
                className="font-bold mt-5"
                style={{
                  fontSize: "clamp(36px, 5vw, 52px)",
                  letterSpacing: "-0.035em",
                  lineHeight: 1.04,
                  textWrap: "balance" as any,
                }}
              >
                Stop guessing.<br />Start training with precision.
              </h1>
              <p
                className="text-muted-foreground"
                style={{
                  marginTop: 18,
                  fontSize: 15,
                  lineHeight: 1.6,
                  maxWidth: 460,
                  textWrap: "pretty" as any,
                }}
              >
                Axiom is the only fitness platform that identifies exactly why your lifts are stalling, then builds your program, nutrition, and coaching around that answer.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start mt-6">
                <Button
                  size="lg"
                  className="rounded-xl text-base font-semibold px-7"
                  asChild
                  onClick={() => WebAnalytics.ctaClicked(user ? "Start a Diagnostic" : "Try It Free", "hero")}
                >
                  <Link href={user ? "/snapshot" : "/register"}>
                    {user ? "Start a Diagnostic" : "Try It Free"}
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl text-base px-7"
                  asChild
                  onClick={() => WebAnalytics.pricingViewed()}
                >
                  <Link href="/pricing">See Pricing</Link>
                </Button>
              </div>

              <div className="flex flex-wrap gap-2.5 justify-center md:justify-start mt-5">
                <AppStoreBadge store="apple" href={APPLE_APP_STORE_URL} />
                <AppStoreBadge store="google" comingSoon />
              </div>

              <div className="hidden sm:block">
                <HeroSocialProofStack />
              </div>
            </motion.div>

            {/* Right — phone screenshot. Hidden on mobile to keep the hero compact. */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="hidden md:flex justify-center relative"
            >
              {/* Soft radial wash behind the phone. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.05) 0%, transparent 60%)",
                  zIndex: 0,
                }}
                aria-hidden="true"
              />
              <div style={{ position: "relative", zIndex: 1 }}>
                <PhoneImageFrame
                  src="/hero-phone-strength.png"
                  width={300}
                  alt="Axiom Strength Profile on iPhone — Anakin's reading and movement balance radar"
                />
              </div>
            </motion.div>
          </div>

          {/* Existing 5-stat row, unchanged. Rendered below the grid. */}
          {statsRow && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2 }}
              style={{ marginTop: 56 }}
            >
              {statsRow}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}
