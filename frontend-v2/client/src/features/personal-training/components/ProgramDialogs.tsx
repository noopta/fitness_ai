// Dialogs that start or spread a program: New program (for a client or as a
// template, blank or from a template), Copy to clients, and Generate with
// Axiom. Each lands the trainer on the builder canvas; nothing here sends
// anything to a client.

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { COPY, PersonalTrainingApiError, type Client, type ProgramAiRequest, type ProgramSummary } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PCOPY } from '../copyPlatform';
import { PRG } from '../copyPrograms';
import { useRoster } from '../hooks';
import { useCopyProgram, useCreateProgram, useExercises, useGenerateProgram, usePrograms } from '../programHooks';
import { errorText, selectClass } from './ChipInput';

const dialogClass = 'max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl';
const titleClass = 'text-[17px] font-semibold tracking-[-0.01em]';

/** Clients a program can be written for: joined (app or web link) and not archived. */
export const programmable = (clients: Client[]) => clients.filter((c) => c.status !== 'notJoined' && c.state !== 'archived');

type Open = { open: boolean; onOpenChange: (open: boolean) => void };

// ── New program ──────────────────────────────────────────────────────────────

export function NewProgramDialog({ open, onOpenChange, clientId: fixedClient }: Open & { clientId?: string }) {
  const roster = useRoster(open);
  const templates = usePrograms({ templates: true });
  const create = useCreateProgram();
  const [, navigate] = useLocation();
  const [target, setTarget] = useState(fixedClient ?? '');
  const [from, setFrom] = useState('');
  const [days, setDays] = useState(3);
  const [name, setName] = useState('');
  const clients = programmable(roster.data?.clients ?? []);
  const close = (next: boolean) => { if (!next) create.reset(); onOpenChange(next); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PRG.create.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PRG.create.body}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target) return;
            const isTemplate = target === '__template';
            create.mutate({
              ...(isTemplate ? { isTemplate: true } : { clientId: target }),
              ...(from ? { fromProgramId: from } : { daysPerWeek: days }),
              ...(name.trim() ? { name: name.trim() } : {}),
            }, { onSuccess: ({ program }) => { close(false); navigate(`/personal-training/programs/${program.id}`); } });
          }}
        >
          {!fixedClient && (
            <div className="space-y-2">
              <Label htmlFor="pt-new-for">{PRG.create.forLabel}</Label>
              <select id="pt-new-for" required className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{PRG.create.chooseClient}</option>
                <option value="__template">{PRG.create.asTemplate}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pt-new-from">{PRG.create.from}</Label>
            <select id="pt-new-from" className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{PRG.create.blank}</option>
              {(templates.data?.programs ?? []).filter((p) => p.isTemplate).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {!from && (
            <div className="space-y-2">
              <Label htmlFor="pt-new-days">{PRG.create.days}</Label>
              <select id="pt-new-days" className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pt-new-name">{PRG.create.name}</Label>
            <Input id="pt-new-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {create.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(create.error, PRG.create.failed)}</p>}
          <Button type="submit" className="h-10 w-full rounded-xl" disabled={!target || create.isPending}>{PRG.create.submit}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Copy ─────────────────────────────────────────────────────────────────────

export function CopyProgramDialog({ program, open, onOpenChange }: Open & { program: ProgramSummary }) {
  const roster = useRoster(open);
  const copy = useCopyProgram();
  const [chosen, setChosen] = useState<string[]>([]);
  const [asTemplate, setAsTemplate] = useState(false);
  const clients = programmable(roster.data?.clients ?? []).filter((c) => c.id !== program.clientId);
  const close = (next: boolean) => { if (!next) { copy.reset(); setChosen([]); setAsTemplate(false); } onOpenChange(next); };
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PRG.copy.title(program.name)}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PRG.copy.body}</DialogDescription>
        </DialogHeader>
        {copy.data ? (
          <div className="space-y-3">
            <p role="status" className="text-sm font-semibold">{PRG.copy.done(copy.data.programs.length)}</p>
            <Button type="button" className="h-10 w-full rounded-xl" onClick={() => close(false)}>{PCOPY.addClient.done}</Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (chosen.length || asTemplate) copy.mutate({ id: program.id, clientIds: chosen, asTemplate }); }}>
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold">{PRG.copy.clients}</legend>
              <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {roster.isPending && <li className="px-3 py-2 text-xs text-axiom-zinc-500">{COPY.roster.title}…</li>}
                {clients.map((c) => (
                  <li key={c.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-foreground" />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {!program.isTemplate && (
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={asTemplate} onChange={(e) => setAsTemplate(e.target.checked)} className="size-4 accent-foreground" />
                {PRG.copy.asTemplate}
              </label>
            )}
            {copy.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(copy.error, PRG.list.failed)}</p>}
            <Button type="submit" className="h-10 w-full rounded-xl" disabled={(!chosen.length && !asTemplate) || copy.isPending}>{PRG.copy.submit}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Generate with Axiom ──────────────────────────────────────────────────────

const G = PRG.generate;
const EXPERIENCES = ['beginner', 'intermediate', 'advanced'] as const;

/** The progress line for a request that has been running `seconds`. Calm, never a bare spinner. */
export function progressLine(seconds: number): string {
  const steps = G.progress;
  return steps[Math.min(steps.length - 1, Math.floor(seconds / 9))];
}

/** Defaults for the structured selectors, from what is known about the client. */
export function generateDefaults(client: Pick<Client, 'sessionsPerWeek'> | undefined): Omit<ProgramAiRequest, 'brief'> {
  return { weeks: 4, daysPerWeek: Math.max(1, Math.min(7, client?.sessionsPerWeek || 3)), sessionMinutes: 60, experience: 'intermediate' };
}

function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) { setS(0); return; }
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return s;
}

export function GenerateDialog({ open, onOpenChange, clientId: fixedClient }: Open & { clientId?: string }) {
  const roster = useRoster(open);
  const library = useExercises({}, open);
  const generate = useGenerateProgram();
  const [, navigate] = useLocation();
  const clients = programmable(roster.data?.clients ?? []);
  const [clientId, setClientId] = useState(fixedClient ?? '');
  const [brief, setBrief] = useState('');
  const [sel, setSel] = useState(() => generateDefaults(undefined));
  const [equipment, setEquipment] = useState<string[] | null>(null);
  const [focus, setFocus] = useState('');
  const elapsed = useElapsed(generate.isPending);
  const allEquipment = library.data?.equipment ?? [];
  const chosenEquipment = equipment ?? allEquipment;

  // Pre-fill days a week from the client once they are known.
  const client = clients.find((c) => c.id === clientId);
  useEffect(() => { if (client) setSel((s) => ({ ...s, daysPerWeek: generateDefaults(client).daysPerWeek })); }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (next: boolean) => { if (generate.isPending) return; if (!next) generate.reset(); onOpenChange(next); };
  const briefOk = brief.trim().length >= 10;
  // A 503 (the model could not draft) and a 429 (too many drafts at once) both mean "not right now".
  const unavailable = generate.error instanceof PersonalTrainingApiError && (generate.error.status >= 500 || generate.error.status === 429);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{G.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{G.body}</DialogDescription>
        </DialogHeader>
        {generate.isPending ? (
          <div role="status" aria-live="polite" className="space-y-3 py-6 text-center">
            <div aria-hidden className="mx-auto h-1 w-40 overflow-hidden rounded-full bg-axiom-zinc-100">
              <div className="h-full w-1/3 rounded-full bg-foreground motion-safe:animate-[pt-pulse_1.6s_ease-in-out_infinite]" />
            </div>
            <p className="text-[15px] font-semibold">{progressLine(elapsed)}</p>
            <p className="text-xs text-axiom-zinc-500">{G.progressNote}</p>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!clientId || !briefOk) return;
              generate.mutate({
                clientId,
                req: {
                  brief: brief.trim(), weeks: sel.weeks, daysPerWeek: sel.daysPerWeek,
                  ...(sel.sessionMinutes ? { sessionMinutes: sel.sessionMinutes } : {}),
                  ...(chosenEquipment.length ? { equipment: chosenEquipment } : {}),
                  ...(sel.experience ? { experience: sel.experience } : {}),
                  ...(focus.trim() ? { focus: focus.trim() } : {}),
                },
              }, { onSuccess: ({ program }) => { onOpenChange(false); navigate(`/personal-training/programs/${program.id}`); } });
            }}
          >
            {!fixedClient && (
              <div className="space-y-2">
                <Label htmlFor="pt-gen-client">{G.client}</Label>
                <select id="pt-gen-client" required className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">{G.chooseClient}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="pt-gen-brief">{G.brief}</Label>
              <Textarea id="pt-gen-brief" rows={4} maxLength={2000} value={brief} placeholder={G.briefPlaceholder} aria-describedby="pt-gen-brief-hint"
                onChange={(e) => setBrief(e.target.value)} className="rounded-xl text-sm leading-relaxed" />
              <p id="pt-gen-brief-hint" className="text-xs text-axiom-zinc-500">{G.briefHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pt-gen-weeks">{G.weeks}</Label>
                <select id="pt-gen-weeks" className={selectClass} value={sel.weeks} onChange={(e) => setSel((s) => ({ ...s, weeks: Number(e.target.value) }))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pt-gen-days">{G.days}</Label>
                <select id="pt-gen-days" className={selectClass} value={sel.daysPerWeek} onChange={(e) => setSel((s) => ({ ...s, daysPerWeek: Number(e.target.value) }))}>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="pt-gen-min">{G.minutes}</Label>
                <Input id="pt-gen-min" type="number" min={15} max={180} step={5} value={sel.sessionMinutes ?? ''} onChange={(e) => setSel((s) => ({ ...s, sessionMinutes: e.target.value === '' ? undefined : Number(e.target.value) }))} className="h-10 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pt-gen-exp">{G.experience}</Label>
                <select id="pt-gen-exp" className={selectClass} value={sel.experience ?? ''} onChange={(e) => setSel((s) => ({ ...s, experience: (e.target.value || undefined) as ProgramAiRequest['experience'] }))}>
                  {EXPERIENCES.map((x) => <option key={x} value={x}>{G.experiences[x]}</option>)}
                </select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="pt-gen-focus">{G.focus}</Label>
                <Input id="pt-gen-focus" maxLength={120} value={focus} placeholder={G.focusPlaceholder} onChange={(e) => setFocus(e.target.value)} className="h-10 rounded-xl" />
              </div>
            </div>
            {allEquipment.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold">{G.equipment}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {allEquipment.map((eq) => {
                    const on = chosenEquipment.includes(eq);
                    return (
                      <label key={eq} className="cursor-pointer">
                        <input type="checkbox" className="peer sr-only" checked={on}
                          onChange={() => setEquipment(on ? chosenEquipment.filter((x) => x !== eq) : [...chosenEquipment, eq])} />
                        <span className={cn('inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-colors duration-200 peer-focus-visible:ring-4 peer-focus-visible:ring-ring/15',
                          on ? 'border-foreground bg-foreground text-background' : 'border-border text-axiom-zinc-600 hover:bg-axiom-zinc-50')}>
                          {PRG.equipment[eq] ?? eq}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {generate.isError && (
              <p role="alert" className="text-sm text-axiom-destructive-ink">{unavailable ? G.unavailable : errorText(generate.error, G.failed)}</p>
            )}
            {brief.trim().length > 0 && !briefOk && <p className="text-xs text-axiom-zinc-500">{G.briefTooShort}</p>}
            <Button type="submit" className="h-10 w-full rounded-xl" disabled={!clientId || !briefOk}>{G.submit}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
