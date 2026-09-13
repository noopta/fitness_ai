import { COPY, verdictHeadline, videoMeasurements, type ThreadItem, type Verdict, type VideoResult } from '@axiom/diagnostic-core';
import { cn } from '@/lib/utils';
import { Eyebrow, InkButton, QuietButton, RichText, Tag } from './primitives';

export function AnakinBubble({ text, animate }: { text: string; animate: boolean }) {
  return (
    <div className={cn('flex justify-start', animate && 'dx-bubble-in')}>
      <div className="max-w-[88%] rounded-[16px_16px_16px_4px] border border-zinc-200 bg-white px-4 py-[15px] text-sm leading-[1.6] text-zinc-950">
        <RichText text={text} />
      </div>
    </div>
  );
}

export function UserBubble({ item, animate, onRetry }: { item: Extract<ThreadItem, { kind: 'user' }>; animate: boolean; onRetry: () => void }) {
  const failed = item.status === 'failed';
  return (
    <div className={cn('flex flex-col items-end', animate && 'dx-bubble-in')}>
      <div
        className={cn(
          'max-w-[80%] rounded-[16px_16px_4px_16px] px-4 py-[13px] text-sm font-medium leading-[1.5]',
          failed ? 'bg-zinc-100 text-zinc-500' : 'bg-zinc-950 text-white',
        )}
      >
        {item.text}
      </div>
      {failed ? (
        <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold">
          <span className="text-red-600">{COPY.didntSend}</span>
          <span className="text-zinc-500">·</span>
          <button type="button" onClick={onRetry} className="text-zinc-950 underline underline-offset-2">
            {COPY.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="flex justify-start" aria-label={COPY.statusTyping} role="status">
      <div className="flex gap-[5px] rounded-[16px_16px_16px_4px] border border-zinc-200 bg-white px-4 py-[17px]">
        {[0, 200, 400].map((d) => (
          <span key={d} className="dx-dot h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function VideoCard({ result, animate }: { result: VideoResult; animate: boolean }) {
  const rows = videoMeasurements(result);
  return (
    <div className={cn('flex flex-col gap-2.5 rounded-2xl border border-zinc-200 bg-white p-[18px]', animate && 'dx-card-in')}>
      <Eyebrow>{COPY.videoCardTitle}</Eyebrow>
      <div className="flex gap-3">
        {rows.map((r) => (
          <div key={r.label} className="flex-1">
            <div className="text-[22px] font-bold tracking-[-0.035em] text-zinc-950">{r.value}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{r.label}</div>
          </div>
        ))}
      </div>
      {result.frameUrl ? (
        <div className="aspect-video overflow-hidden rounded-xl bg-zinc-100">
          <img src={result.frameUrl} alt="Frame at the sticking point" className="h-full w-full object-cover" />
        </div>
      ) : null}
    </div>
  );
}

export function VerdictCard({ verdict, animate, onOpen }: { verdict: Verdict; animate: boolean; onOpen: () => void }) {
  const { eyebrow, headline } = verdictHeadline(verdict);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full flex-col gap-2.5 rounded-[18px] border border-zinc-200 bg-white p-5 text-left shadow-[0_6px_20px_-14px_rgba(0,0,0,0.18)]',
        animate && 'dx-card-in',
      )}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="text-2xl font-bold leading-tight tracking-[-0.035em] text-zinc-950">{headline}</div>
      <div className="text-[13px] font-semibold text-zinc-500">{COPY.confidence(verdict.confidence)}</div>
      {verdict.evidence.slice(0, 2).map((e, i) => (
        <div key={i} className="flex gap-2">
          <Tag>{e.tag}</Tag>
          <span className="text-[13px] leading-[1.45] text-zinc-700">{e.text}</span>
        </div>
      ))}
    </button>
  );
}

export function LimitCard({ animate, onUpgrade, onLater }: { animate: boolean; onUpgrade: () => void; onLater: () => void }) {
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-2xl bg-zinc-100 p-[18px]', animate && 'dx-card-in')}>
      <div className="text-[15px] font-semibold text-zinc-950">{COPY.limitTitle}</div>
      <div className="text-[13px] text-zinc-500">{COPY.limitBody}</div>
      <div className="mt-1 flex items-center gap-4">
        <InkButton onClick={onUpgrade} className="min-h-10 px-4 text-sm">{COPY.goUnlimited}</InkButton>
        <QuietButton onClick={onLater}>{COPY.later}</QuietButton>
      </div>
    </div>
  );
}
