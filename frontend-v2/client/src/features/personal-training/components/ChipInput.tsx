// Small form pieces the coach-platform views share: a chip input for short
// lists (tags, specialties, languages) and a read-only link field with Copy.

import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

/**
 * Enter or comma adds what is typed; Backspace on an empty box removes the
 * last chip. `suggestions` are offered as one-tap chips underneath.
 */
export function ChipInput({
  id, value, onChange, placeholder, max = 12, maxLength = 40, suggestions = [], suggestionsLabel, removeLabel, describedBy,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  suggestions?: string[];
  suggestionsLabel?: string;
  removeLabel: (chip: string) => string;
  describedBy?: string;
}) {
  const [text, setText] = useState('');
  const full = value.length >= max;

  function add(raw: string) {
    const chip = raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (!chip || full || value.some((v) => v.toLowerCase() === chip.toLowerCase())) return;
    onChange([...value, chip]);
  }

  const offered = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 12);

  return (
    <div>
      <div className={cn('flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-background px-2 py-1.5', 'focus-within:ring-4 focus-within:ring-ring/15')}>
        {value.map((chip) => (
          <span key={chip} className="inline-flex items-center gap-1 rounded-lg bg-axiom-zinc-100 py-0.5 pl-2 pr-1 text-xs font-semibold">
            {chip}
            <button type="button" aria-label={removeLabel(chip)} onClick={() => onChange(value.filter((v) => v !== chip))} className={cn('grid size-5 place-items-center rounded text-axiom-zinc-500 hover:text-foreground', focusRing)}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          maxLength={maxLength}
          disabled={full}
          aria-describedby={describedBy}
          placeholder={value.length === 0 ? placeholder : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(',')) { v.split(',').slice(0, -1).forEach(add); setText(v.split(',').pop() ?? ''); } else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); }
            if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (text.trim()) { add(text); setText(''); } }}
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-axiom-zinc-500"
        />
      </div>
      {offered.length > 0 && !full && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {suggestionsLabel && <span className="text-xs text-axiom-zinc-500">{suggestionsLabel}</span>}
          {offered.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className={cn('rounded-lg border border-border px-2 py-0.5 text-xs font-semibold text-axiom-zinc-600 hover:bg-axiom-zinc-50', focusRing)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A selectable link and a Copy button. The clipboard can be blocked; the link stays selectable. */
export function CopyField({ value, label, copyLabel, copiedLabel }: { value: string; label: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Left selectable in the field.
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} aria-label={label} className="min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" variant="secondary" className="h-10 shrink-0 rounded-xl" onClick={copy}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </Button>
    </div>
  );
}

export const selectClass = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';

/** The message to show for a failed mutation: the server's own words for a 4xx, the fallback otherwise. */
export function errorText(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | null;
  return e && typeof e.status === 'number' && e.status < 500 && e.message ? e.message : fallback;
}
