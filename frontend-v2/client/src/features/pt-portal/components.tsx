// Building blocks of the client portal. The accent comes from the practice's
// brand colour through --portal-accent / --portal-on-accent on the portal root.

import { forwardRef } from 'react';
import type { PortalBranding } from '@axiom/personal-training-core';
import { cn } from '@/lib/utils';
import { Eyebrow, SkeletonBlock } from '@/features/personal-training/components/primitives';

export { Eyebrow, SkeletonBlock };

const FOCUS = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'accent' | 'secondary' | 'ghost' | 'danger' };

/** 44px tall everywhere: the portal is used one-handed on a phone. */
export const PortalButton = forwardRef<HTMLButtonElement, ButtonProps>(function PortalButton(
  { variant = 'accent', className, type = 'button', ...props }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-opacity duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        FOCUS,
        variant === 'accent' && 'bg-[var(--portal-accent)] text-[var(--portal-on-accent)] hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-background text-foreground hover:bg-axiom-zinc-50',
        variant === 'ghost' && 'text-axiom-zinc-600 hover:bg-axiom-zinc-50 hover:text-foreground',
        variant === 'danger' && 'border border-border bg-background text-axiom-destructive-ink hover:bg-axiom-destructive-soft',
        className,
      )}
      {...props}
    />
  );
});

export function Card({ children, className, as: As = 'section', ...rest }: { children: React.ReactNode; className?: string; as?: 'section' | 'div' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return <As className={cn('rounded-2xl border border-border bg-background p-4 shadow-xs', className)} {...rest}>{children}</As>;
}

export function ScreenTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{children}</h1>
      {sub && <p className="mt-1 text-sm text-axiom-zinc-600">{sub}</p>}
    </div>
  );
}

/** A designed empty or unavailable state — never a raw error. */
export function EmptyState({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      {icon && <div aria-hidden className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-axiom-zinc-100 text-axiom-zinc-600 [&_svg]:size-5">{icon}</div>}
      <p className="text-[15px] font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-axiom-zinc-600">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function InlineError({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rounded-xl bg-axiom-destructive-soft px-3 py-2 text-sm text-axiom-destructive-ink">{children}</p>;
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState title="Couldn't load this right now" action={<PortalButton variant="secondary" onClick={onRetry}>Try again</PortalButton>}>
      Check your connection and try again.
    </EmptyState>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} className="h-2 w-full overflow-hidden rounded-full bg-axiom-zinc-100">
      <div className="h-full rounded-full bg-[var(--portal-accent)] transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <SkeletonBlock key={i} className="h-16 w-full rounded-2xl" />)}
    </div>
  );
}

export function PracticeMark({ branding, size = 40 }: { branding: PortalBranding; size?: number }) {
  if (branding.logoUrl) {
    return <img src={branding.logoUrl} alt={`${branding.practiceName} logo`} width={size} height={size} className="shrink-0 rounded-xl object-contain" style={{ width: size, height: size }} />;
  }
  const initials = branding.practiceName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'A';
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-xl bg-[var(--portal-accent)] text-sm font-bold text-[var(--portal-on-accent)]" style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}

/** Native select styled like the kit's inputs; 44px tall. */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn('h-11 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm', FOCUS, className)}
      {...props}
    />
  );
});
