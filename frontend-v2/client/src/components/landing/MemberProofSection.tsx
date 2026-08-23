/**
 * Member Proof — "Same person. Different data."
 *
 * Homepage section featuring Axiom member Alex Hernandez: before/after photos,
 * his logged e1RM gains, his testimonial, and the program Axiom wrote for him.
 * Sits between StrengthProfileSection and FeatureGrid.
 *
 * Built from the design team's handoff (design_handoff_member_proof_section).
 * The numbers below are hand-verified against production: 12 logged hip-thrust
 * sessions, first 43.09 kg x 12 (95 lb), best 88.45 kg x 12 (195 lb). The
 * "+140 lb" delta is the e1RM change (Epley: 95 x 1.4 = 133 -> 195 x 1.4 = 273),
 * which is what the column is labelled — not the raw load difference.
 *
 * Static by design. This is one member's published story, not a dashboard, so
 * the data is a typed constant rather than an API call.
 */

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";

type Lift = {
  name: string;
  sessions: number;
  first: string;
  best: string;
  /** Absolute e1RM delta. Null where we have no verified lb figure. */
  delta: string | null;
  pct: string;
  /** Share of the largest gain in the set (105%), for the bar width. */
  bar: number;
};

const MEMBER_PROOF_LIFTS: Lift[] = [
  { name: "Hip Thrust",            sessions: 12, first: "95 lb × 12",  best: "195 lb × 12", delta: "+140 lb", pct: "+105%", bar: 105 },
  { name: "Cable Crunch",          sessions: 21, first: "35 lb × 12",  best: "65 lb × 15",  delta: "+48 lb",  pct: "+99%",  bar: 99 },
  { name: "Incline Bench Press",   sessions: 10, first: "32 lb × 12",  best: "62 lb × 12",  delta: "+42 lb",  pct: "+94%",  bar: 94 },
  { name: "Cable Woodchoppers",    sessions: 3,  first: "33 lb × 12",  best: "43 lb × 15",  delta: "+18 lb",  pct: "+40%",  bar: 40 },
  { name: "Leg Extension",         sessions: 4,  first: "58 lb × 12",  best: "80 lb × 10",  delta: "+26 lb",  pct: "+33%",  bar: 33 },
  { name: "Bench Press",           sessions: 6,  first: "65 lb × 12",  best: "75 lb × 18",  delta: "+29 lb",  pct: "+32%",  bar: 32 },
  { name: "Bulgarian Split Squat", sessions: 3,  first: "40 lb × 10",  best: "50 lb × 12",  delta: "+17 lb",  pct: "+31%",  bar: 31 },
  // No verified absolute delta for this one, so the percentage takes the delta
  // slot and the caption reads "e1RM". Deliberately not invented.
  { name: "Romanian Deadlift",     sessions: 3,  first: "55 lb × 8",   best: "60 lb × 12",  delta: null,      pct: "+21%",  bar: 21 },
  { name: "Back Squat",            sessions: 8,  first: "130 lb × 10", best: "135 lb × 12", delta: "+16 lb",  pct: "+9%",   bar: 9 },
];

const MAX_BAR = 105;

const STATS = [
  { value: "8",     label: "Weeks on program" },
  { value: "5×", label: "Sessions per week" },
  { value: "9",     label: "Lifts tracked" },
  { value: "+105%", label: "Best e1RM gain (hip thrust)" },
];

const SESSION_TYPES = ["Upper Push", "Lower Pull", "Upper Pull", "Lower Push", "Accessory & Core"];

const QUOTE =
  "Axiom has helped me get out of my comfort zone to perform exercises suited for my needs and body goals. Logging in workouts has made it easy to focus on areas that I might be underperforming and also helps me look at areas where I can push. Axiom has also helped me stay on track with my eating; all of this combined, I was able to quickly see results. I definitely recommend users to try Axiom out.";

export function MemberProofSection() {
  const [showAll, setShowAll] = useState(false);
  const reduceMotion = useReducedMotion();
  const rows = showAll ? MEMBER_PROOF_LIFTS : MEMBER_PROOF_LIFTS.slice(0, 5);

  return (
    <motion.section
      className="border-t border-[#e4e4e7] bg-white px-5 py-16 min-[720px]:px-6 min-[720px]:py-24"
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      viewport={{ once: true, margin: "-15%" }}
    >
      <div className="mx-auto max-w-5xl">
        {/* 1. Eyebrow */}
        <div className="flex justify-center">
          <span className="rounded-full border border-[#e4e4e7] px-3 py-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#71717a]">
            Member proof
          </span>
        </div>

        {/* 2. Headline + subhead */}
        <h2 className="mt-5 text-center text-[28px] leading-[1.15] font-bold tracking-[-.02em] text-[#09090b] text-balance min-[720px]:text-[36px] min-[720px]:leading-[1.12]">
          Same person. Different data.
        </h2>
        <p className="mx-auto mt-3 max-w-[580px] text-center text-[15px] text-[#71717a] text-pretty">
          Eight weeks, five days a week, every set logged. The results speak for themselves, so we don't have to.
        </p>

        {/* 3. Photo pair */}
        <div className="mt-10 grid gap-5 min-[560px]:grid-cols-2">
          <figure className="rounded-2xl border border-[#e4e4e7] bg-[#fafafa] p-3.5">
            <div className="aspect-4/5 overflow-hidden rounded-xl bg-[#f4f4f5]">
              <img
                src="/alex-before.jpg"
                alt="Alex before starting Axiom"
                loading="lazy"
                className="h-full w-full object-cover"
                style={{ objectPosition: "50% 10%" }}
              />
            </div>
            <figcaption className="mt-3.5 flex items-baseline justify-between px-1 pb-1">
              <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#71717a]">Before Axiom</span>
              <span className="text-[13px] text-[#71717a]">Taken prior to starting</span>
            </figcaption>
          </figure>

          <figure className="rounded-2xl border border-[#e4e4e7] bg-[#09090b] p-3.5">
            <div className="aspect-4/5 overflow-hidden rounded-xl bg-[#18181b]">
              <img
                src="/alex-after.jpg"
                alt="Alex at his week 8 check-in"
                loading="lazy"
                className="h-full w-full object-cover"
                style={{ objectPosition: "50% 10%" }}
              />
            </div>
            <figcaption className="mt-3.5 flex items-baseline justify-between px-1 pb-1">
              <span className="text-[11px] font-bold uppercase tracking-[.12em] text-white">Week 8 &middot; Latest check-in</span>
              <span className="text-[13px] text-[#a1a1aa]">Build phase</span>
            </figcaption>
          </figure>
        </div>

        {/* 4. Stat strip */}
        <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-[14px] border border-[#e4e4e7] min-[720px]:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={[
                "px-4 py-4 min-[720px]:px-6 min-[720px]:py-[22px]",
                // 2x2: right hairline on the left column, bottom hairline on
                // the top row. 4-up: right hairline on all but the last, and
                // no bottom hairline at all.
                i % 2 === 0 ? "border-r border-[#e4e4e7]" : "",
                i < 2 ? "border-b border-[#e4e4e7] min-[720px]:border-b-0" : "",
                i === 3 ? "min-[720px]:border-r-0" : "min-[720px]:border-r min-[720px]:border-[#e4e4e7]",
              ].join(" ")}
            >
              <div className="text-[22px] font-bold tracking-[-.02em] text-[#09090b] min-[720px]:text-[28px]">{s.value}</div>
              <div className="mt-1.5 text-[11px] leading-snug text-[#71717a] min-[720px]:text-[12px]">{s.label}</div>
            </div>
          ))}
        </div>

        {/* 5. Quote band */}
        <figure className="mt-5 grid gap-8 rounded-2xl bg-[#09090b] px-6 py-8 min-[720px]:grid-cols-[1fr_220px] min-[720px]:items-center min-[720px]:gap-10 min-[720px]:px-11 min-[720px]:py-10">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#a1a1aa]">In Alex's words</div>
            <blockquote className="mt-[18px] text-[19px] font-normal leading-[1.5] tracking-[-.015em] text-white text-pretty min-[720px]:text-[24px]">
              &ldquo;{QUOTE}&rdquo;
            </blockquote>
          </div>
          <figcaption className="flex flex-col gap-3.5 border-t border-white/[.14] pt-8 min-[720px]:border-l min-[720px]:border-t-0 min-[720px]:pl-10 min-[720px]:pt-0">
            <div>
              <div className="text-[15px] font-semibold text-white">Alex Hernandez</div>
              <div className="mt-0.5 text-[12px] text-[#71717a]">Axiom member &middot; 8 weeks in</div>
            </div>
            <div className="text-[12px] text-[#a1a1aa]">Hypertrophy, 5 days/week</div>
          </figcaption>
        </figure>

        {/* 6. Data row */}
        <div className="mt-5 grid items-start gap-5 min-[900px]:grid-cols-[1fr_380px]">
          {/* 6a. Lift table */}
          <div className="overflow-hidden rounded-[14px] border border-[#e4e4e7]">
            <div className="flex items-center justify-between gap-3 border-b border-[#e4e4e7] px-3 py-4 min-[560px]:px-5">
              <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#71717a]">Logged e1RM change</span>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="whitespace-nowrap rounded-[10px] border border-[#e4e4e7] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#09090b] transition-colors duration-200 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-foreground/12"
              >
                {showAll ? "Show top 5" : `Show all ${MEMBER_PROOF_LIFTS.length} lifts`}
              </button>
            </div>

            {/* Column header. `First` is dropped on the narrowest layout. */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-[#f4f4f5] px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.12em] text-[#71717a] min-[560px]:grid-cols-[1fr_92px_92px_128px] min-[560px]:gap-4 min-[560px]:px-5">
              <div>Exercise</div>
              <div className="hidden text-right min-[560px]:block">First</div>
              <div className="text-right">Best</div>
              <div className="text-right">e1RM change</div>
            </div>

            <motion.div layout={!reduceMotion} transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}>
              {rows.map((l, i) => (
                <div
                  key={l.name}
                  data-lift={l.name}
                  className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-4 min-[560px]:grid-cols-[1fr_92px_92px_128px] min-[560px]:gap-4 min-[560px]:px-5 ${i > 0 ? "border-t border-[#e4e4e7]" : ""}`}
                >
                  <div>
                    <div className="text-[13px] font-semibold text-[#09090b]">{l.name}</div>
                    <div className="text-[11px] text-[#a1a1aa]">{l.sessions} sessions logged</div>
                    <div className="mt-1.5 h-[3px] max-w-[220px] overflow-hidden rounded-full bg-[#f4f4f5]">
                      <div className="h-full rounded-full bg-[#047857]" style={{ width: `${(l.bar / MAX_BAR) * 100}%` }} />
                    </div>
                  </div>
                  <div className="hidden text-right text-[13px] text-[#71717a] min-[560px]:block">{l.first}</div>
                  <div className="text-right text-[13px] font-semibold text-[#09090b]">{l.best}</div>
                  <div className="text-right">
                    <div className="text-[15px] font-bold tracking-[-.02em] text-[#047857]">{l.delta ?? l.pct}</div>
                    <div className="text-[11px] text-[#71717a]">{l.delta ? l.pct : "e1RM"}</div>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* 6b. Program card */}
          <div className="rounded-[14px] border border-[#e4e4e7] p-[22px]">
            <div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#71717a]">The program Axiom wrote</div>
            <div className="mt-3 text-[16px] font-semibold tracking-[-.01em] text-[#09090b] text-pretty">
              Hypertrophy with emphasis on definition and overall toning
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <div className="flex-1 rounded-[10px] border border-[#e4e4e7] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#71717a]">Phase 1</div>
                <div className="mt-0.5 whitespace-nowrap text-[13px] font-semibold text-[#09090b]">Foundation &middot; wks 1&ndash;4</div>
              </div>
              <span aria-hidden className="text-[13px] text-[#a1a1aa]">&rarr;</span>
              <div className="flex-1 rounded-[10px] bg-[#09090b] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#a1a1aa]">Phase 2</div>
                <div className="mt-0.5 whitespace-nowrap text-[13px] font-semibold text-white">Build &middot; wks 5&ndash;8</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {SESSION_TYPES.map((t) => (
                <span key={t} className="rounded-lg bg-[#f4f4f5] px-[9px] py-1 text-[11px] font-semibold text-[#3f3f46]">
                  {t}
                </span>
              ))}
            </div>

            <p className="mt-4 border-t border-[#e4e4e7] pt-4 text-[12px] text-[#71717a] text-pretty">
              Generated from <span className="font-semibold text-[#09090b]">8 cited sources</span> from NCSF and NASM.
              Every prescription traces back to a paper, not a hunch.
            </p>
          </div>
        </div>

        {/* 7. CTA row */}
        <div className="mt-8 flex flex-col items-stretch gap-6 border-t border-[#e4e4e7] pt-7 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between">
          <p className="max-w-[560px] text-[18px] font-semibold leading-[1.35] tracking-[-.02em] text-[#09090b] text-pretty min-[720px]:text-[20px]">
            Adaptive training and nutrition profiling helped Alex break past his limits. Now let's break yours.
          </p>
          <div className="flex flex-col gap-2.5 min-[720px]:flex-row">
            <Link
              href="/register"
              className="whitespace-nowrap rounded-xl bg-[#09090b] px-[18px] py-3 text-center text-[13px] font-semibold text-white transition-colors duration-200 hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-foreground/12"
            >
              Get started
            </Link>
            <a
              href="#coaching-stack"
              className="whitespace-nowrap rounded-xl border border-[#e4e4e7] bg-white px-[18px] py-3 text-center text-[13px] font-semibold text-[#09090b] transition-colors duration-200 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-foreground/12"
            >
              View features
            </a>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
