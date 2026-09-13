import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { parseRich } from '@axiom/diagnostic-core';
import { cn } from '@/lib/utils';

// Zinc scale = the handoff's tokens: ink #09090b (zinc-950), muted #71717a
// (zinc-500, the floor for interactive text), body #3f3f46/#52525b, disabled
// #a1a1aa (decoration only), border #e4e4e7, muted surface #f4f4f5.

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {parseRich(text).map((seg, i) =>
        seg.strong ? (
          <strong key={i} className="font-bold text-zinc-950">{seg.text}</strong>
        ) : seg.em ? (
          <em key={i}>{seg.text}</em>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

export function Monogram({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-950 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.44 }}
    >
      A
    </span>
  );
}

/** 46×46 ink circle, arrow-right 18 / stroke 2.2. Disabled = opacity .35. */
export function SendButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      aria-label="Send"
      className={cn(
        'inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-opacity disabled:opacity-35',
        className,
      )}
      {...props}
    >
      <ArrowRight size={18} strokeWidth={2.2} />
    </button>
  );
}

export function Chip({ active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-full border px-[14px] py-[9px] text-[13px] font-semibold leading-none transition-colors disabled:opacity-35',
        active ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-white text-zinc-950 hover:bg-zinc-100',
        className,
      )}
      {...props}
    />
  );
}

export function InkButton({ inverse, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { inverse?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-opacity disabled:opacity-35',
        inverse ? 'bg-white text-zinc-950' : 'bg-zinc-950 text-white hover:opacity-90',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function OutlineButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-[15px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-35',
        className,
      )}
      {...props}
    />
  );
}

export function QuietButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn('py-1.5 text-sm font-semibold text-zinc-500 hover:text-zinc-950 disabled:opacity-35', className)}
      {...props}
    />
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500', className)}>{children}</div>;
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="mt-px inline-block shrink-0 self-start rounded-md border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-zinc-600">
      {children}
    </span>
  );
}
