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

/**
 * Polyline only — no axes, no fill. Colour is status, never decoration: red
 * for a falling or regressing line, amber for a plateau, ink otherwise.
 * `domain` rescales for real measurements; `band` shades the plateau zone.
 */
export function Sparkline({
  series, trend, width = 72, height = 24, label, domain, tone, band,
}: {
  series: number[];
  trend?: EngagementTrend;
  width?: number;
  height?: number;
  /** Text alternative; defaults to the engagement description. */
  label?: string;
  domain?: [number, number];
  tone?: 'red' | 'amber' | 'ink';
  band?: boolean;
}) {
  const colour = tone ?? (trend === 'falling' ? 'red' : 'ink');
  const [min, max] = domain ?? [0, 10];
  return (
    <svg
      role="img"
      aria-label={label ?? engagementAltText(trend ?? 'steady', series.length)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', colour === 'red' ? 'text-axiom-destructive' : colour === 'amber' ? 'text-axiom-warning' : 'text-foreground')}
    >
      {band && <rect x={0} y={height * 0.25} width={width} height={height * 0.5} rx={4} className="fill-axiom-warning-soft" />}
      <polyline
        points={sparklinePoints(series, width, height, max, 2, min)}
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

/** zinc-100 track, 3px inset, active segment white with a hairline shadow. */
export function SegmentedControl<T extends string>({
  value, onChange, options, label, size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-axiom-zinc-100 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[9px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
            value === o.value ? 'bg-background text-foreground shadow-xs' : 'text-axiom-zinc-600 hover:text-foreground',
            o.disabled && 'cursor-not-allowed opacity-40 hover:text-axiom-zinc-600',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "→"-prefixed reasons, then a "Sources: …" caption. Shared by briefing cards, check-ins and Anakin. */
export function EvidenceList({ reasons, sources }: { reasons: string[]; sources: { label: string }[] }) {
  return (
    <div>
      <ul className="space-y-1">
        {reasons.map((r) => (
          <li key={r} className="flex gap-2 text-sm leading-relaxed text-axiom-zinc-600">
            <span aria-hidden className="text-axiom-zinc-400">→</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
      {sources.length > 0 && <p className="mt-2 text-xs text-axiom-zinc-500">Sources: {sources.map((s) => s.label).join(' · ')}</p>}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="hidden text-[30px] font-bold leading-tight tracking-[-0.02em] md:block">{children}</h1>
      {sub && <p className="text-sm text-axiom-zinc-600 md:mt-1">{sub}</p>}
    </div>
  );
}

export function Notice({ children, action, alert }: { children: React.ReactNode; action?: React.ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? 'alert' : undefined} className="rounded-2xl border border-border p-8 text-center">
      <div className="text-sm text-axiom-zinc-600">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
