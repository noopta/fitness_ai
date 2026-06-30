import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ArrowRight, ChevronLeft } from 'lucide-react';
import type { TrainingProgram, ProgramSource, ProgramSourceSection } from './ProgramSetup';
import {
  BRAND_CERTIFICATIONS, BRAND_SCIENCE_PAGES, studiesCitedCount, refsForSection,
  buildPhases, buildExercises, buildVolumeTiles, buildNutrition, firstNameOf,
} from './revealModel';

// The Program Reveal — the conviction screen shown the moment generation
// completes, right before the paywall. Intentionally a single light surface
// with exactly one dark element (the credentials hero), per the design spec.
// Tailwind zinc/green utilities map 1:1 to the spec tokens
// (zinc-950 #09090b, zinc-600 #52525b, zinc-500 #71717a, zinc-400 #a1a1aa,
//  zinc-300 #d4d4d8, zinc-200 #e4e4e7, zinc-100 #f4f4f5;
//  green-500 #22c55e, green-200 #bbf7d0, green-100 #dcfce7, green-700 #15803d).

interface Props {
  program: TrainingProgram;
  userName: string | null;
  onNext: () => void;
  onBack?: () => void;
  stepLabel?: string;
}

const SECTION_META: Array<{ key: ProgramSourceSection; index: string; eyebrow: string }> = [
  { key: 'periodization', index: '01', eyebrow: 'Periodization' },
  { key: 'exercise', index: '02', eyebrow: 'Exercise selection' },
  { key: 'volume', index: '03', eyebrow: 'Volume & intensity' },
  { key: 'nutrition', index: '04', eyebrow: 'Nutrition' },
];

export function ProgramReveal({ program, userName, onNext, onBack, stepLabel }: Props) {
  const reduce = useReducedMotion();

  const m = useMemo(() => {
    const sources: ProgramSource[] = Array.isArray(program?.sources) ? program.sources : [];
    return {
      firstName: firstNameOf(userName),
      durationWeeks: Number(program?.durationWeeks) || null,
      sources,
      studiesCited: studiesCitedCount(sources),
      phases: buildPhases(program),
      exercises: buildExercises(program),
      volume: buildVolumeTiles(program),
      nutrition: buildNutrition(program),
    };
  }, [program, userName]);

  const { firstName, durationWeeks, sources, studiesCited, phases, exercises, volume, nutrition } = m;

  let order = 0;
  const stagger = (children: React.ReactNode) => {
    const i = order++;
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.06, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    );
  };

  // Inline ref chips for a section — only when that section has backing sources.
  const RefChips = ({ section }: { section: ProgramSourceSection }) => {
    const refs = refsForSection(sources, section);
    if (refs.length === 0) return null;
    return (
      <span className="ml-auto flex items-center gap-1">
        {refs.map((r) => (
          <sup
            key={r.id}
            className="inline-flex h-[15px] min-w-[16px] items-center justify-center rounded-[5px] border border-zinc-300 font-mono text-[9px] font-bold leading-none text-zinc-500"
          >
            {sources.indexOf(r) + 1}
          </sup>
        ))}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-white text-zinc-950">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-5 pt-6 pb-36 space-y-6">

          {/* ── Block A · Completion marker ─────────────────────────── */}
          {stagger(
            <div className="flex items-center justify-between rounded-2xl bg-zinc-100 px-4 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-100 py-[5px] pl-[7px] pr-[11px]">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-green-500">
                  <Check className="h-3 w-3 text-white" strokeWidth={3.2} />
                </span>
                <span className="text-[11px] font-bold text-green-700">Program generated</span>
              </span>
              {stepLabel && (
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-zinc-400">{stepLabel}</span>
              )}
            </div>,
          )}

          {/* ── Block B · Title ─────────────────────────────────────── */}
          {stagger(
            <div className="space-y-2.5">
              {durationWeeks && (
                <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-zinc-500">
                  Your {durationWeeks}-week plan
                </p>
              )}
              <h1 className="text-[33px] font-extrabold leading-[1.04] tracking-[-0.03em] text-balance">
                Engineered around you, {firstName}.
              </h1>
              <p className="text-[14.5px] leading-relaxed text-zinc-600 text-pretty">
                Built from your working weights, training history, and the constraints you logged —
                then checked against the literature, line by line.
              </p>
            </div>,
          )}

          {/* ── Block C · Credentials hero (the one dark surface) ────── */}
          {stagger(
            <div className="rounded-[22px] bg-zinc-950 p-5 text-white shadow-[0_24px_50px_-28px_rgba(0,0,0,0.5)]">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/50">Constructed from</p>
              <div className="mt-4 flex">
                <HeroStat value={String(BRAND_CERTIFICATIONS)} label="trainer certifications" grow="1" first />
                <HeroStat value={BRAND_SCIENCE_PAGES.toLocaleString()} label="pages of sports science" grow="1.2" />
                {studiesCited > 0 && (
                  <HeroStat value={String(studiesCited)} label="studies cited in your plan" grow="1" />
                )}
              </div>
              <div className="my-4 h-px bg-white/10" />
              <p className="text-[12.5px] leading-relaxed text-white/80">
                {studiesCited > 0 ? (
                  <>Every choice below traces back to peer-reviewed evidence. Tap a{' '}
                    <span className="rounded border border-white/30 px-1 font-mono text-[11px]">ref</span>{' '}
                    to see the source.</>
                ) : (
                  <>Every choice below is built on certified strength-and-conditioning science.</>
                )}
              </p>
            </div>,
          )}

          {/* ── Block D · Construction sections ─────────────────────── */}
          {phases.length > 0 && stagger(
            <Section meta={SECTION_META[0]} first refs={<RefChips section="periodization" />}>
              <h2 className="text-xl font-bold tracking-[-0.02em]">
                {phases.length === 1 ? 'A focused block, built to peak you.' : `${phases.length} phases, sequenced to peak you.`}
              </h2>
              {phases[0].rationale && <p className="text-[13.5px] leading-[1.55] text-zinc-600">{phases[0].rationale}</p>}
              <div className="flex gap-[5px]">
                {phases.map((p, i) => (
                  <div
                    key={i}
                    style={{ flex: p.weeks }}
                    className={`flex h-[54px] flex-col justify-between rounded-[9px] p-2 ${
                      p.isCurrent ? 'bg-zinc-950' : 'border border-zinc-200 bg-zinc-100'
                    }`}
                  >
                    <span className={`truncate text-[11px] font-bold ${p.isCurrent ? 'text-white' : 'text-zinc-950'}`}>{p.name}</span>
                    <span className={`truncate text-[9.5px] ${p.isCurrent ? 'text-white/70' : 'text-zinc-500'}`}>{p.weeksLabel}</span>
                  </div>
                ))}
              </div>
            </Section>,
          )}

          {exercises.length > 0 && stagger(
            <Section meta={SECTION_META[1]} refs={<RefChips section="exercise" />}>
              <h2 className="text-xl font-bold tracking-[-0.02em]">Chosen for your body, not a template.</h2>
              <div className="space-y-2">
                {exercises.map((ex, i) => (
                  <div key={i} className="rounded-xl border border-zinc-200 px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold">{ex.name}</span>
                      {ex.tag && <span className="shrink-0 font-mono text-[11px] text-zinc-500">{ex.tag}</span>}
                    </div>
                    {ex.reason && <p className="mt-1 text-xs leading-snug text-zinc-600">{ex.reason}</p>}
                  </div>
                ))}
              </div>
            </Section>,
          )}

          {volume.length > 0 && stagger(
            <Section meta={SECTION_META[2]} refs={<RefChips section="volume" />}>
              <h2 className="text-xl font-bold tracking-[-0.02em]">Dosed for adaptation, not exhaustion.</h2>
              <div className="flex gap-2">
                {volume.map((t, i) => (
                  <div key={i} className="flex-1 rounded-xl border border-zinc-200 p-3">
                    <div className="text-2xl font-extrabold tracking-[-0.02em] tabular-nums">{t.value}</div>
                    <div className="mt-1.5 text-[11px] leading-tight text-zinc-500">{t.label}</div>
                  </div>
                ))}
              </div>
            </Section>,
          )}

          {nutrition && stagger(
            <Section meta={SECTION_META[3]} refs={<RefChips section="nutrition" />}>
              <h2 className="text-xl font-bold tracking-[-0.02em]">Fuel matched to the work.</h2>
              <div className="space-y-3.5 rounded-2xl border border-zinc-200 p-3.5">
                <div className="flex">
                  {nutrition.proteinG != null && <NutritionStat value={`${nutrition.proteinG} g`} label="Protein" />}
                  {nutrition.calories != null && (
                    <NutritionStat value={nutrition.calories.toLocaleString()} label="Calories" last={nutrition.percents == null} />
                  )}
                  {nutrition.percents && <NutritionStat value={`${nutrition.percents.protein}%`} label="From protein" last />}
                </div>
                {nutrition.percents && (
                  <>
                    <div className="flex h-2 overflow-hidden rounded">
                      <div style={{ flex: nutrition.percents.protein }} className="bg-zinc-950" />
                      <div style={{ flex: nutrition.percents.carbs }} className="bg-zinc-500" />
                      <div style={{ flex: nutrition.percents.fat }} className="bg-zinc-300" />
                    </div>
                    <div className="flex flex-wrap gap-x-3.5 gap-y-1">
                      <Legend className="bg-zinc-950" label={`Protein ${nutrition.percents.protein}%`} />
                      <Legend className="bg-zinc-500" label={`Carbs ${nutrition.percents.carbs}%`} />
                      <Legend className="bg-zinc-300" label={`Fat ${nutrition.percents.fat}%`} />
                    </div>
                  </>
                )}
              </div>
            </Section>,
          )}

          {/* ── Block E · Sources cited ─────────────────────────────── */}
          {sources.length > 0 && stagger(
            <div className="space-y-3 border-t border-zinc-200 pt-6">
              <h2 className="text-xl font-bold tracking-[-0.02em]">Sources cited</h2>
              {sources.map((s, i) => (
                <div key={s.id} className="flex gap-3">
                  <span className="mt-0.5 w-4 shrink-0 font-mono text-[10px] font-bold">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-semibold leading-snug">{s.source}</p>
                    {s.chapter && <p className="text-[11.5px] leading-snug text-zinc-600">{s.chapter}</p>}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-zinc-400">Drawn from the certified science library that informed your plan.</p>
            </div>,
          )}
        </div>
      </div>

      {/* ── Block F · Pinned CTA (frosted) ────────────────────────── */}
      <div className="sticky bottom-0 border-t border-zinc-200 bg-white/92 backdrop-blur-[10px]">
        <div className="mx-auto w-full max-w-xl space-y-2 px-5 py-3">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button
                onClick={onBack}
                className="grid h-[52px] w-11 place-items-center rounded-[14px] border border-zinc-200 text-zinc-500 transition active:scale-[0.98]"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={onNext}
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-zinc-950 text-[15.5px] font-bold text-white transition active:scale-[0.98]"
            >
              See your plan
              <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>
          </div>
          <p className="text-center text-[11px] text-zinc-500">
            {durationWeeks ? `${durationWeeks} weeks · ` : ''}adapts every session you log
          </p>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ value, label, grow, first }: { value: string; label: string; grow: string; first?: boolean }) {
  return (
    <div className={`px-3 ${first ? '' : 'border-l border-white/[0.14]'}`} style={{ flex: grow }}>
      <div className="text-[30px] font-extrabold tracking-[-0.03em] tabular-nums">{value}</div>
      <div className="mt-1.5 text-[10.5px] leading-[1.3] text-white/[0.62]">{label}</div>
    </div>
  );
}

function Section({
  meta, first, refs, children,
}: {
  meta: { index: string; eyebrow: string };
  first?: boolean;
  refs?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-3 ${first ? '' : 'border-t border-zinc-200 pt-6'}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold">{meta.index}</span>
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-zinc-500">{meta.eyebrow}</span>
        {refs}
      </div>
      {children}
    </div>
  );
}

function NutritionStat({ value, label, last }: { value: string; label: string; last?: boolean }) {
  return (
    <div className={`flex-1 px-3 ${last ? '' : 'border-r border-zinc-200'}`}>
      <div className="text-[22px] font-extrabold tracking-[-0.02em] tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${className}`} />
      <span className="text-[11px] text-zinc-500">{label}</span>
    </span>
  );
}
