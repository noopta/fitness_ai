// A searchable exercise field for the builder. Typing searches the library;
// choosing a match links the exercise (so its tagged patterns apply), and
// whatever is typed can always stand as a free-text name.

import { useEffect, useId, useState } from 'react';
import type { LibraryExercise } from '@axiom/personal-training-core';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PRG } from '../copyPrograms';
import { useExercises } from '../programHooks';

const B = PRG.builder;

/** The library query trails the keyboard by a beat. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ExercisePicker({
  value, onChange, label, invalid, describedBy,
}: {
  value: string;
  onChange: (next: { name: string; exerciseId?: string }) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(value.trim());
  const list = useExercises({ q }, open && q.length >= 1);
  const listId = useId();
  const matches: LibraryExercise[] = open && q.length >= 1 ? (list.data?.exercises ?? []).slice(0, 8) : [];
  const exact = matches.some((m) => m.name.toLowerCase() === value.trim().toLowerCase());
  const options: { key: string; label: string; pick: () => void; hint?: string }[] = [
    ...matches.map((m) => ({ key: m.id, label: m.name, hint: m.builtIn ? undefined : PRG.library.mine, pick: () => onChange({ name: m.name, exerciseId: m.id }) })),
    ...(value.trim() && !exact ? [{ key: '__free', label: B.custom(value.trim()), pick: () => onChange({ name: value.trim() }) }] : []),
  ];
  const showList = open && value.trim().length >= 1 && (options.length > 0 || list.isFetching);

  function choose(i: number) {
    options[i]?.pick();
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        maxLength={80}
        placeholder={B.exercisePlaceholder}
        onFocus={() => setOpen(true)}
        // Delay so a click on an option lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { onChange({ name: e.target.value }); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && options[active]) { e.preventDefault(); choose(active); }
          if (e.key === 'Escape') setOpen(false);
        }}
        className={cn('h-10 rounded-xl text-sm', invalid && 'border-axiom-destructive')}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-sm">
          {options.length === 0 && <li className="px-3 py-2 text-xs text-axiom-zinc-500">{B.noMatches}</li>}
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm', i === active && 'bg-axiom-zinc-100', o.key === '__free' && 'text-axiom-zinc-600')}
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[11px] text-axiom-zinc-500">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
