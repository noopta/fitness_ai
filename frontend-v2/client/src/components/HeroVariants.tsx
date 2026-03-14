/**
 * 10 Hero Section UI Variations for the landing page.
 * Variants 4–8 feature both web and phone views.
 */

import { motion } from "framer-motion";

import dashboardHero from "@/assets/images/dashboard-hero.png";
import dashboardHeroPhone from "@/assets/images/dashboard-hero-phone.png";

export const HERO_VARIANT_COUNT = 10;

/** Shared phone mockup for web+phone variants */
function PhoneMockup({
  className = "",
  style = {},
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-[2.25rem] border-4 border-border bg-background shadow-2xl overflow-hidden ${className}`}
      style={style}
    >
      <img
        src={dashboardHeroPhone}
        alt="Axiom AI Coach — mobile view"
        className="w-full aspect-[9/19] object-cover"
      />
    </div>
  );
}

interface HeroContent {
  badges: { icon: string; text: string }[];
  title: string;
  titleMuted: string;
  subtitle: string;
}

interface CTAContent {
  user: { name?: string; email?: string } | null;
  children: React.ReactNode;
}

interface HeroVariantProps {
  content: HeroContent;
  cta: CTAContent;
  badgeIcons: Record<string, React.ReactNode>;
}

function ValuePill({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}

// ── Variant 1: Split layout — copy left, image right (overflow) ─────────────
export function HeroVariant1({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8 overflow-visible">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center overflow-visible">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative overflow-visible flex justify-start"
        >
          <img
            src={dashboardHero}
            alt="Axiom AI Coach dashboard — Today's Workout and Schedule"
            className="w-[135%] min-w-[135%] max-w-none rounded-2xl border shadow-xl"
          />
        </motion.div>
      </div>
      <div className="flex justify-center lg:justify-start">{cta.children}</div>
    </div>
  );
}

// ── Variant 2: Centered — title, then full-width image, CTA below ────────────
export function HeroVariant2({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-10">
      <div className="text-center max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {content.badges.map((b, i) => (
            <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
          ))}
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          {content.title}
          <span className="text-muted-foreground">{content.titleMuted}</span>
        </h1>
        <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {content.subtitle}
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="rounded-2xl overflow-hidden border shadow-2xl"
      >
        <img
          src={dashboardHero}
          alt="Axiom AI Coach dashboard"
          className="w-full"
        />
      </motion.div>
      <div className="flex justify-center">{cta.children}</div>
    </div>
  );
}

// ── Variant 3: Image with gradient fade into background, CTA below ───────────
export function HeroVariant3({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8">
      <div className="relative">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 relative rounded-2xl overflow-hidden"
        >
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{
              background: "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 85%)",
            }}
          />
          <img
            src={dashboardHero}
            alt="Axiom AI Coach dashboard"
            className="w-full rounded-2xl border shadow-xl"
          />
        </motion.div>
      </div>
      <div className="flex justify-center">{cta.children}</div>
    </div>
  );
}

// ── Variant 4: Web view only, perspective tilt (3D) ───────────────────────────
export function HeroVariant4({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8 overflow-visible">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center overflow-visible">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, rotateY: 15 }}
          animate={{ opacity: 1, rotateY: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="perspective-[1200px] flex justify-start overflow-visible"
          style={{ perspective: "1200px" }}
        >
          <div
            className="rounded-2xl border shadow-2xl overflow-hidden transition-transform hover:scale-[1.02] w-[135%] min-w-[135%] max-w-none"
            style={{
              transform: "rotateY(-6deg) rotateX(2deg)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
            }}
          >
            <img
              src={dashboardHero}
              alt="Axiom AI Coach dashboard"
              className="w-full"
            />
          </div>
        </motion.div>
      </div>
      <div className="flex justify-center lg:justify-start">{cta.children}</div>
    </div>
  );
}

// ── Variant 5: Web + phone — phone overlapping bottom-left ───────────────────
export function HeroVariant5({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8 overflow-visible">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center overflow-visible">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="relative min-h-[320px] lg:min-h-[380px]"
        >
          <div className="rounded-2xl border shadow-2xl overflow-hidden w-full">
            <img src={dashboardHero} alt="Axiom AI Coach — web view" className="w-full" />
          </div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="absolute left-4 lg:left-8 bottom-4 lg:bottom-8 z-10 w-[130px] sm:w-[160px] lg:w-[190px]"
          >
            <PhoneMockup
              style={{
                transform: "rotateY(8deg) rotateX(5deg) rotateZ(6deg)",
                boxShadow: "0 24px 48px -12px rgba(0,0,0,0.35)",
              }}
            />
          </motion.div>
        </motion.div>
      </div>
      <div className="flex justify-center lg:justify-start">{cta.children}</div>
    </div>
  );
}

// ── Variant 6: Web + phone — side by side, both angled ───────────────────────
export function HeroVariant6({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8 overflow-visible">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center overflow-visible">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex gap-4 lg:gap-6 items-end justify-start overflow-visible"
        >
          <div
            className="rounded-2xl border shadow-2xl overflow-hidden flex-1 min-w-0 max-w-[65%]"
            style={{
              transform: "rotateY(-4deg) rotateX(1deg)",
              boxShadow: "0 20px 40px -10px rgba(0,0,0,0.25)",
            }}
          >
            <img src={dashboardHero} alt="Axiom AI Coach — web view" className="w-full" />
          </div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="w-[120px] sm:w-[150px] lg:w-[180px] shrink-0"
          >
            <PhoneMockup
              style={{
                transform: "rotateY(6deg) rotateX(-4deg) rotateZ(4deg)",
                boxShadow: "0 20px 40px -10px rgba(0,0,0,0.3)",
              }}
            />
          </motion.div>
        </motion.div>
      </div>
      <div className="flex justify-center lg:justify-start">{cta.children}</div>
    </div>
  );
}

// ── Variant 7: Web + phone — phone centered in front ────────────────────────
export function HeroVariant7({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8 overflow-visible">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center overflow-visible">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="relative"
        >
          <div
            className="rounded-2xl border shadow-xl overflow-hidden opacity-80"
            style={{ transform: "scale(0.95)" }}
          >
            <img src={dashboardHero} alt="Axiom AI Coach — web view" className="w-full" />
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-[160px] sm:w-[200px] lg:w-[240px]"
          >
            <PhoneMockup
              style={{
                transform: "rotateY(-5deg) rotateX(8deg) rotateZ(-2deg)",
                boxShadow: "0 32px 64px -16px rgba(0,0,0,0.4)",
              }}
            />
          </motion.div>
        </motion.div>
      </div>
      <div className="flex justify-center lg:justify-start">{cta.children}</div>
    </div>
  );
}

// ── Variant 8: Web + phone — stacked vertically ─────────────────────────────
export function HeroVariant8({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8 overflow-visible">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center overflow-visible">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {content.badges.map((b, i) => (
              <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
            ))}
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {content.title}
            <span className="text-muted-foreground">{content.titleMuted}</span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {content.subtitle}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-6 items-center lg:items-end"
        >
          <div
            className="rounded-2xl border shadow-2xl overflow-hidden w-full max-w-xl"
            style={{
              transform: "rotateY(-3deg) rotateX(1deg)",
              boxShadow: "0 20px 40px -10px rgba(0,0,0,0.25)",
            }}
          >
            <img src={dashboardHero} alt="Axiom AI Coach — web view" className="w-full" />
          </div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="w-[140px] sm:w-[170px] lg:w-[200px]"
          >
            <PhoneMockup
              style={{
                transform: "rotateY(5deg) rotateX(-3deg) rotateZ(3deg)",
                boxShadow: "0 20px 40px -10px rgba(0,0,0,0.3)",
              }}
            />
          </motion.div>
        </motion.div>
      </div>
      <div className="flex justify-center lg:justify-start">{cta.children}</div>
    </div>
  );
}

// ── Variant 9: Image full-width, CTA below ──────────────────────────────────
export function HeroVariant9({ content, cta, badgeIcons }: HeroVariantProps) {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {content.badges.map((b, i) => (
            <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
          ))}
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          {content.title}
          <span className="text-muted-foreground">{content.titleMuted}</span>
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {content.subtitle}
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="rounded-2xl overflow-hidden border shadow-2xl"
      >
        <img
          src={dashboardHero}
          alt="Axiom AI Coach dashboard"
          className="w-full"
        />
      </motion.div>
      <div className="flex justify-center">{cta.children}</div>
    </div>
  );
}

// ── Variant 10: Floating badges around image, CTA below ─────────────────────
export function HeroVariant10({ content, cta, badgeIcons }: HeroVariantProps) {
  const floatBadges = [
    { label: "Today's Workout", pos: "top-4 left-4" },
    { label: "Anakin's Tips", pos: "bottom-24 left-6" },
    { label: "Life Happened?", pos: "bottom-4 right-1/3" },
  ];
  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {content.badges.map((b, i) => (
            <ValuePill key={i} icon={badgeIcons[b.icon as string] ?? null} text={b.text} />
          ))}
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          {content.title}
          <span className="text-muted-foreground">{content.titleMuted}</span>
        </h1>
        <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {content.subtitle}
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="relative max-w-4xl mx-auto"
      >
        {floatBadges.map((b, i) => (
          <motion.div
            key={b.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 + i * 0.1 }}
            className={`absolute ${b.pos} z-10`}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/95 backdrop-blur px-3 py-1.5 text-xs font-medium shadow-lg">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {b.label}
            </span>
          </motion.div>
        ))}
        <div className="rounded-2xl border shadow-2xl overflow-hidden">
          <img
            src={dashboardHero}
            alt="Axiom AI Coach dashboard"
            className="w-full"
          />
        </div>
      </motion.div>
      <div className="flex justify-center">{cta.children}</div>
    </div>
  );
}

// ── Export map for easy switching ────────────────────────────────────────
export const HERO_VARIANTS: Record<number, React.ComponentType<HeroVariantProps>> = {
  1: HeroVariant1,
  2: HeroVariant2,
  3: HeroVariant3,
  4: HeroVariant4,
  5: HeroVariant5,
  6: HeroVariant6,
  7: HeroVariant7,
  8: HeroVariant8,
  9: HeroVariant9,
  10: HeroVariant10,
};
