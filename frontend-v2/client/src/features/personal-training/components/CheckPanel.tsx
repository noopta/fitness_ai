// What the rules engine said about a program: refusals, warnings the trainer
// can acknowledge, structural problems, and exercises it could not read.
// Refusals are stated plainly and cannot be acknowledged away.

import type { ProgramAnnotation, ProgramCheck } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PRG } from '../copyPrograms';
import { ackKey, acknowledgeable, refusalNotes } from '../programDoc';
import { Eyebrow, Pill } from './primitives';

const C = PRG.check;

/** Program-level refusals Axiom wrote while drafting: "Not programmed: …". */
export function RefusalNotes({ annotations }: { annotations: ProgramAnnotation[] }) {
  const notes = refusalNotes(annotations);
  if (notes.length === 0) return null;
  return (
    <ul aria-label={C.notProgrammed} className="space-y-2">
      {notes.map((n, i) => (
        <li key={i} className="flex gap-2 rounded-xl border border-axiom-destructive/30 bg-axiom-destructive-soft px-4 py-3 text-sm leading-relaxed text-axiom-destructive-ink">
          <span className="shrink-0 font-semibold">{C.notProgrammed}:</span>
          <span className="min-w-0">{n.text.replace(/^Not programmed:\s*/i, '')}</span>
        </li>
      ))}
    </ul>
  );
}

export function CheckPanel({ check, isTemplate, onAcknowledge, acknowledging, className }: {
  check: ProgramCheck | null;
  isTemplate: boolean;
  onAcknowledge?: (key: string) => void;
  acknowledging?: boolean;
  className?: string;
}) {
  const violations = check?.guardrails?.violations ?? [];
  const blocks = violations.filter((v) => v.level === 'block');
  const warns = acknowledgeable(check);
  const issues = check?.issues ?? [];
  const unclassified = check?.guardrails?.unclassified ?? [];
  const clean = !!check && violations.length === 0 && issues.length === 0;

  return (
    <section aria-label={C.title} className={cn('space-y-4 rounded-2xl border border-border p-4', className)}>
      <Eyebrow>{C.title}</Eyebrow>
      {isTemplate && <p className="text-xs leading-relaxed text-axiom-zinc-500">{C.noClient}</p>}
      {clean && check?.guardrails && <p role="status" className="text-sm text-axiom-success-ink">{C.clean(check.guardrails.label)}</p>}

      {blocks.length > 0 && (
        <div>
          <Pill tone="red" className="mb-2">{C.blocks} · {blocks.length}</Pill>
          <ul className="space-y-2">
            {blocks.map((v, i) => (
              <li key={i} className="text-sm">
                <p className="font-semibold">{v.exercise}</p>
                <p className="text-xs leading-relaxed text-axiom-zinc-600">{v.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warns.length > 0 && (
        <div>
          <Pill tone="amber" className="mb-2">{C.warns} · {warns.length}</Pill>
          <ul className="space-y-3">
            {warns.map((v) => (
              <li key={ackKey(v)} className="text-sm">
                <p className="font-semibold">{v.exercise}</p>
                <p className="text-xs leading-relaxed text-axiom-zinc-600">{v.reason}</p>
                {onAcknowledge && (
                  <Button type="button" variant="secondary" className="mt-1.5 h-8 rounded-lg px-3 text-xs" disabled={acknowledging}
                    aria-label={`${C.acknowledge}: ${v.exercise}, ${v.condition}`} onClick={() => onAcknowledge(ackKey(v))}>
                    {C.acknowledge}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-axiom-zinc-500">{C.acknowledgeHelp}</p>
        </div>
      )}

      {issues.length > 0 && (
        <div>
          <Pill tone="zinc" className="mb-2">{C.issues} · {issues.length}</Pill>
          <ul className="space-y-1">
            {issues.map((i, k) => (
              <li key={k} className={cn('text-xs leading-relaxed', i.level === 'block' ? 'text-axiom-destructive-ink' : 'text-axiom-warning-ink')}>
                <span className="font-semibold">{i.level === 'block' ? C.refused : C.warning}:</span> {i.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unclassified.length > 0 && (
        <div>
          <Pill tone="zinc" className="mb-2">{C.unclassified} · {unclassified.length}</Pill>
          <p className="text-xs text-axiom-zinc-600">{unclassified.join(', ')}</p>
          <p className="mt-1 text-xs text-axiom-zinc-500">{C.unclassifiedHelp}</p>
        </div>
      )}
    </section>
  );
}
