import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Lock, Share, X } from 'lucide-react';
import {
  COPY,
  reportSections,
  sharpenList,
  verdictHeadline,
  type Candidate,
  type Verdict,
} from '@axiom/diagnostic-core';
import { shareDiagnostic } from '@/lib/diagnosticApi';
import { cn } from '@/lib/utils';
import { DiagnosticRadar, EfficiencyGauge } from './Charts';
import { VideoCard } from './ThreadItems';
import { Eyebrow, InkButton, OutlineButton, Tag } from './primitives';

const RANK_LABEL: Record<Candidate['rank'], string> = {
  primary: COPY.primary,
  secondary: COPY.secondary,
  ruled_out: COPY.ruledOut,
  leading: COPY.leading,
  open: COPY.open,
};

interface Props {
  verdict: Verdict;
  onClose: () => void;
  onUpgrade: () => void;
  onAddNumbers?: () => void;
  readOnly?: boolean;
}

/** Header (share · close) / verdict / evidence / charts / video / fix / track. */
export function ReportView({ verdict, onClose, onUpgrade, onAddNumbers, readOnly }: Props) {
  const { eyebrow, headline } = verdictHeadline(verdict);
  const sections = reportSections(verdict);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const share = async () => {
    try {
      const url = await shareDiagnostic(verdict.sessionId);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2600);
    } catch {
      /* inline only — no toasts in this flow */
    }
  };

  const basis = [
    `${verdict.ratiosLogged} ${verdict.ratiosLogged === 1 ? 'ratio' : 'ratios'}`,
    verdict.hasVideo ? 'video' : null,
    verdict.answersGiven ? `${verdict.answersGiven} ${verdict.answersGiven === 1 ? 'answer' : 'answers'}` : null,
  ].filter(Boolean).join(', ');

  return (
    <div className="min-h-[100dvh] bg-white">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/95 px-3 backdrop-blur">
        {!readOnly ? (
          <button type="button" onClick={share} className="flex min-h-11 items-center gap-1.5 px-2 text-zinc-950" aria-label={COPY.share}>
            {copied ? <Check size={18} /> : <Share size={18} />}
            <span className={cn('text-[13px] font-semibold', copied ? 'text-zinc-500' : 'text-zinc-950')}>{copied ? COPY.linkCopied : COPY.share}</span>
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center text-zinc-950" aria-label={COPY.close}>
          <X size={20} />
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 px-4 pb-16 pt-6">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.035em] text-zinc-950">{headline}</h1>
          <p className="text-[13px] font-semibold text-zinc-500">{COPY.confidence(verdict.confidence)} · {basis}</p>
        </div>

        {verdict.evidence.length ? (
          <Section title={COPY.evidence}>
            {verdict.evidence.map((e, i) => (
              <div key={i} className={cn('flex gap-2 py-2', i > 0 && 'border-t border-zinc-100')}>
                <Tag>{e.tag}</Tag>
                <span className="text-sm leading-5 text-zinc-700">{e.text}</span>
              </div>
            ))}
          </Section>
        ) : null}

        {verdict.candidates.length ? (
          <Section title={COPY.candidates}>
            {verdict.candidates.map((c, i) => (
              <div key={c.key} className={cn('flex items-center justify-between gap-3 py-2.5', i > 0 && 'border-t border-zinc-100')}>
                <span className={cn('text-sm font-semibold', c.rank === 'ruled_out' ? 'text-zinc-500' : 'text-zinc-950')}>{c.label}</span>
                <span className={cn('text-xs font-semibold', c.rank === 'primary' || c.rank === 'leading' ? 'text-zinc-950' : 'text-zinc-500')}>
                  {RANK_LABEL[c.rank]}
                  {c.score != null ? ` · ${c.score}` : ''}
                </span>
              </div>
            ))}
          </Section>
        ) : null}

        {sections.charts && verdict.charts ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {Object.keys(verdict.charts.indices).length ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 p-[18px]">
                <Eyebrow className="self-start">{COPY.strengthProfile}</Eyebrow>
                <DiagnosticRadar lift={verdict.lift} indices={verdict.charts.indices} size={180} />
              </div>
            ) : null}
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 p-[18px]">
              <Eyebrow className="self-start">{COPY.efficiency}</Eyebrow>
              <EfficiencyGauge score={verdict.charts.efficiency} size={150} />
            </div>
          </div>
        ) : null}

        {sections.notEnoughLiftsNote ? (
          <div className="rounded-2xl bg-zinc-100 p-[18px] text-sm leading-5 text-zinc-600">{COPY.notEnoughLifts}</div>
        ) : null}

        {sections.validationTest && verdict.validationTest ? (
          <Section title={COPY.validationTest}>
            <div className="text-[15px] font-semibold text-zinc-950">{verdict.validationTest.description}</div>
            <p className="text-sm leading-5 text-zinc-700">{verdict.validationTest.howToRun}</p>
          </Section>
        ) : null}

        {sections.sharpen ? (
          <Section title={COPY.sharpenThis}>
            <ul className="flex flex-col gap-1.5">
              {sharpenList(verdict).map((s) => (
                <li key={s} className="flex gap-2 text-sm leading-5 text-zinc-700">
                  <span className="text-zinc-400" aria-hidden>•</span>
                  {s}
                </li>
              ))}
            </ul>
            {onAddNumbers && verdict.missingLifts.length ? (
              <OutlineButton className="mt-2" onClick={onAddNumbers}>{COPY.addMissingNumbers}</OutlineButton>
            ) : null}
          </Section>
        ) : null}

        {verdict.video ? <VideoCard result={verdict.video} animate={false} /> : null}

        <Fix verdict={verdict} onUpgrade={onUpgrade} readOnly={readOnly} />

        {verdict.trackNextTime.length ? (
          <Section title={COPY.trackNextTime}>
            <ul className="flex flex-col gap-1.5">
              {verdict.trackNextTime.map((t) => (
                <li key={t} className="flex gap-2 text-sm leading-5 text-zinc-700">
                  <span className="text-zinc-400" aria-hidden>•</span>
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </main>
    </div>
  );
}

function Fix({ verdict, onUpgrade, readOnly }: { verdict: Verdict; onUpgrade: () => void; readOnly?: boolean }) {
  const fix = verdict.fix;
  if (fix.locked) {
    const zero = verdict.grade === 0;
    return (
      <div className="flex flex-col gap-2 rounded-[18px] bg-zinc-950 p-5 text-white">
        <Lock size={18} />
        <div className="text-xl font-bold tracking-[-0.02em]">{zero ? COPY.confirmLockedTitle : COPY.fixLockedTitle}</div>
        <p className="text-sm leading-5 text-white/[.72]">{zero ? COPY.confirmLockedBody : COPY.fixLockedBody(fix.accessoryCount)}</p>
        {!readOnly ? (
          <>
            <InkButton inverse className="mt-1.5" onClick={onUpgrade}>{COPY.startFreeMonth}</InkButton>
            <p className="text-center text-xs text-white/[.72]">{COPY.freeMonthFine}</p>
          </>
        ) : null}
      </div>
    );
  }
  return (
    <Section title={COPY.fixTitle}>
      <div className="flex flex-col gap-0.5 py-2">
        <div className="text-[15px] font-semibold text-zinc-950">{fix.primary.name}</div>
        <div className="text-[13px] font-semibold text-zinc-500">
          {fix.primary.sets} × {fix.primary.reps} · {fix.primary.intensity} · {fix.primary.restMinutes} min rest
        </div>
      </div>
      {fix.accessories.map((a) => (
        <div key={a.exerciseId + a.name} className="flex flex-col gap-0.5 border-t border-zinc-100 py-2">
          <div className="text-[15px] font-semibold text-zinc-950">{a.name}</div>
          <div className="text-[13px] font-semibold text-zinc-500">{a.sets} × {a.reps}</div>
          <p className="text-sm leading-5 text-zinc-700">{a.why}</p>
        </div>
      ))}
      {fix.progression.length ? (
        <div className="flex flex-col gap-1 border-t border-zinc-100 py-2">
          <Eyebrow>{COPY.progression}</Eyebrow>
          {fix.progression.map((p) => (
            <p key={p} className="text-sm leading-5 text-zinc-700">{p}</p>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-[18px]">
      <Eyebrow className="mb-1">{title}</Eyebrow>
      {children}
    </section>
  );
}
