// Shared building blocks of the personal-training views (design handoff §5).
// Colours come from the axiom-* tokens in index.css; red, amber and green
// appear only as status dots, pills and sparkline strokes.

import {
  STATUS_LABEL, engagementAltText, sparklinePoints,
  type ClientStatus, type EngagementTrend, type Tone,
} from '@axiom/personal-training-core';
import { cn } from '@/lib/utils';

const TONE_PILL: Record<Tone, string> = {
  red: 'bg-axiom-destructive-soft text-axiom-destructive-ink',
  amber: 'bg-axiom-warning-soft text-axiom-warning-ink',
  green: 'bg-axiom-success-soft text-axiom-success-ink',
  zinc: 'bg-axiom-zinc-100 text-axiom-zinc-600',
};

const TONE_DOT: Record<Tone, string> = {
  red: 'bg-axiom-destructive',
  amber: 'bg-axiom-warning',
  green: 'bg-axiom-success',
  zinc: 'bg-axiom-zinc-400',
};

/** "Might need support" is amber — worth a look — not the red of an urgent item. */
export const STATUS_TONE: Record<ClientStatus, Tone> = {
  support: 'amber',
  new: 'zinc',
  onPlan: 'green',
  paused: 'zinc',
};

/** 6px dot + 11/600 label on a soft fill. The label means status is never colour-only. */
export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', TONE_PILL[tone], className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT[tone])} />
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: ClientStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

const AVATAR_SIZE = {
  28: 'size-7 text-[10px]',
  32: 'size-8 text-[11px]',
  36: 'size-9 text-xs',
  44: 'size-11 text-sm',
  56: 'size-14 text-base',
} as const;

export function Avatar({
  initials, size = 36, status, className,
}: { initials: string; size?: keyof typeof AVATAR_SIZE; status?: ClientStatus; className?: string }) {
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center rounded-full bg-axiom-zinc-100 font-semibold text-foreground', AVATAR_SIZE[size], className)}>
      <span aria-hidden>{initials}</span>
      {status && (
        <span
          role="img"
          aria-label={STATUS_LABEL[status]}
          className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-background', TONE_DOT[STATUS_TONE[status]])}
        />
      )}
    </span>
  );
}

/** Polyline only — no axes, no fill. A falling client's line is the one place it turns red. */
export function Sparkline({
  series, trend, width = 72, height = 24,
}: { series: number[]; trend: EngagementTrend; width?: number; height?: number }) {
  return (
    <svg
      role="img"
      aria-label={engagementAltText(trend, series.length)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', trend === 'falling' ? 'text-axiom-destructive' : 'text-foreground')}
    >
      <polyline
        points={sparklinePoints(series, width, height)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Height 32, full radius, hairline. Active = black fill, white text. */
export function FilterChip({
  active, onClick, children, count,
}: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
        active ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-axiom-zinc-600 hover:bg-axiom-zinc-50',
      )}
    >
      {children}
      {count !== undefined && <span className={cn('tabular-nums font-normal', active ? 'text-background/70' : 'text-axiom-zinc-500')}>{count}</span>}
    </button>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500', className)}>{children}</p>;
}

/** zinc-100 block pulsing 1 → .45 over 1.6s; still when the viewer prefers reduced motion. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cn('rounded-lg bg-axiom-zinc-100 motion-safe:animate-[pt-pulse_1.6s_ease-in-out_infinite]', className)} />;
}
