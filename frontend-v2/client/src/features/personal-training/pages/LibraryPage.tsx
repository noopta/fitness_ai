// The exercise library: Axiom's built-in exercises and the practice's own.
// Patterns are what the safety rules read, so the page says so plainly; a
// pattern a trainer tags adds to what the name already implies and never
// removes one.

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { COPY, type LibraryExercise, type MeResponse } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText, selectClass } from '../components/ChipInput';
import { useDebounced } from '../components/ExercisePicker';
import { Gate } from '../components/Gate';
import { PatternPicker } from '../components/HealthTab';
import { Notice, PageTitle, Pill, SegmentedControl, SkeletonBlock } from '../components/primitives';
import { ProgramsNav } from '../components/ProgramsNav';
import { Shell } from '../components/Shell';
import { PRG } from '../copyPrograms';
import { patternLabel } from '../platform';
import { useContraindicationMeta } from '../platformHooks';
import { useExerciseActions, useExercises } from '../programHooks';

const T = PRG.library;
type Scope = 'all' | 'builtin' | 'mine';

export interface ExerciseForm { name: string; patterns: string[]; equipment: string[]; videoUrl: string; cues: string; primaryMuscle: string }

/** Field errors, matching what the server refuses. Empty when the form can be saved. */
export function validateExerciseForm(f: ExerciseForm): Partial<Record<keyof ExerciseForm, string>> {
  const errors: Partial<Record<keyof ExerciseForm, string>> = {};
  if (f.name.trim().length < 2) errors.name = T.errors.name;
  if (f.videoUrl.trim() && !/^https:\/\/[^\s]{4,500}$/.test(f.videoUrl.trim())) errors.videoUrl = T.errors.video;
  return errors;
}

export const formOf = (e: LibraryExercise | null): ExerciseForm => ({
  name: e?.name ?? '', patterns: e?.patterns ?? [], equipment: e?.equipment ?? [], videoUrl: e?.videoUrl ?? '', cues: e?.cues ?? '', primaryMuscle: e?.primaryMuscle ?? '',
});

export const inScope = (e: LibraryExercise, scope: Scope) => scope === 'all' || (scope === 'builtin' ? e.builtIn : !e.builtIn);

function ExerciseDialog({ exercise, patterns, equipment, onClose }: { exercise: LibraryExercise | null; patterns: string[]; equipment: string[]; onClose: () => void }) {
  const [form, setForm] = useState<ExerciseForm>(() => formOf(exercise));
  const [tried, setTried] = useState(false);
  const { create, update } = useExerciseActions();
  const save = exercise ? update : create;
  const errors = validateExerciseForm(form);
  const set = <K extends keyof ExerciseForm>(k: K, v: ExerciseForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const show = (k: keyof ExerciseForm) => (tried ? errors[k] : undefined);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    const input = {
      name: form.name.trim(), patterns: form.patterns, equipment: form.equipment, videoUrl: form.videoUrl.trim() || null,
      cues: form.cues.trim(), primaryMuscle: form.primaryMuscle.trim(),
    };
    if (exercise) update.mutate({ id: exercise.id, input }, { onSuccess: onClose });
    else create.mutate(input, { onSuccess: onClose });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{T.formTitle[exercise ? 'edit' : 'add']}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{T.rulesNote}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="pt-ex-name">{T.name}</Label>
            <Input id="pt-ex-name" maxLength={80} value={form.name} aria-invalid={!!show('name')} aria-describedby={show('name') ? 'pt-ex-name-err' : undefined} onChange={(e) => set('name', e.target.value)} />
            {show('name') && <p id="pt-ex-name-err" className="text-xs text-axiom-destructive-ink">{show('name')}</p>}
          </div>
          <PatternPicker name="patterns" legend={T.patterns} help={T.patternsHelp} patterns={patterns} value={form.patterns} onChange={(v) => set('patterns', v)} />
          <fieldset>
            <legend className="text-[13px] font-semibold">{T.equipmentLabel}</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {equipment.map((eq) => (
                <label key={eq} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-foreground" checked={form.equipment.includes(eq)}
                    onChange={() => set('equipment', form.equipment.includes(eq) ? form.equipment.filter((x) => x !== eq) : [...form.equipment, eq])} />
                  {PRG.equipment[eq] ?? eq}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="pt-ex-video">{T.video}</Label>
            <Input id="pt-ex-video" type="url" inputMode="url" value={form.videoUrl} placeholder="https://" aria-invalid={!!show('videoUrl')} aria-describedby="pt-ex-video-hint" onChange={(e) => set('videoUrl', e.target.value)} />
            <p id="pt-ex-video-hint" className={show('videoUrl') ? 'text-xs text-axiom-destructive-ink' : 'text-xs text-axiom-zinc-500'}>{show('videoUrl') ?? T.videoHint}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-ex-muscle">{T.muscle}</Label>
            <Input id="pt-ex-muscle" maxLength={60} value={form.primaryMuscle} onChange={(e) => set('primaryMuscle', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-ex-cues">{T.cues}</Label>
            <Textarea id="pt-ex-cues" rows={3} maxLength={1000} value={form.cues} onChange={(e) => set('cues', e.target.value)} className="rounded-xl text-sm" />
          </div>
          {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(save.error, T.failed)}</p>}
          <Button type="submit" className="h-10 w-full rounded-xl" disabled={save.isPending}>{T.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Page({ me }: { me: MeResponse }) {
  const [text, setText] = useState('');
  const [pattern, setPattern] = useState('');
  const [equipment, setEquipment] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [editing, setEditing] = useState<{ exercise: LibraryExercise | null } | null>(null);
  const q = useDebounced(text.trim());
  const list = useExercises({ q, pattern, equipment });
  const meta = useContraindicationMeta();
  const { archive } = useExerciseActions();
  const patterns = meta.data?.patterns ?? [];
  const allEquipment = list.data?.equipment ?? [];
  const visible = (list.data?.exercises ?? []).filter((e) => inScope(e, scope));

  return (
    <Shell me={me} active="programs" title={T.title}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <PageTitle sub={T.sub}>{T.title}</PageTitle>
        <Button className="mb-6 h-11 shrink-0 rounded-xl md:h-10" disabled={!meta.data} onClick={() => setEditing({ exercise: null })}>{T.add}</Button>
      </div>
      <ProgramsNav active="library" />
      <p className="mb-4 rounded-xl bg-axiom-zinc-50 px-4 py-3 text-sm leading-relaxed text-axiom-zinc-600">{T.rulesNote}</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
        <Input type="search" aria-label={T.search} placeholder={T.search} value={text} onChange={(e) => setText(e.target.value)} className="h-10 rounded-xl" />
        <select aria-label={T.pattern} className={selectClass} value={pattern} onChange={(e) => setPattern(e.target.value)}>
          <option value="">{T.anyPattern}</option>
          {patterns.map((p) => <option key={p} value={p}>{patternLabel(p)}</option>)}
        </select>
        <select aria-label={T.equipment} className={selectClass} value={equipment} onChange={(e) => setEquipment(e.target.value)}>
          <option value="">{T.anyEquipment}</option>
          {allEquipment.map((eq) => <option key={eq} value={eq}>{PRG.equipment[eq] ?? eq}</option>)}
        </select>
        <SegmentedControl<Scope> label={T.scope} value={scope} onChange={setScope} options={(['all', 'builtin', 'mine'] as const).map((s) => ({ value: s, label: T.scopes[s] }))} />
      </div>

      {list.isPending ? (
        <div aria-busy="true" className="space-y-2">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-14 w-full" />)}</div>
      ) : list.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => list.refetch()}>{COPY.roster.retry}</Button>}>{T.loadFailed}</Notice>
      ) : visible.length === 0 ? (
        <Notice>{T.empty}</Notice>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {visible.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-[13px] font-semibold">{e.name}</p>
                  <Pill tone="zinc">{e.builtIn ? T.builtIn : T.mine}</Pill>
                  {e.videoUrl && (
                    <a href={e.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-axiom-zinc-600 underline-offset-2 hover:underline">
                      {T.watch}<ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-axiom-zinc-500">
                  {[e.patterns.map(patternLabel).join(', '), e.equipment.map((x) => PRG.equipment[x] ?? x).join(', '), e.primaryMuscle].filter(Boolean).join(' · ')}
                </p>
                {e.cues && <p className="mt-1 line-clamp-2 text-xs text-axiom-zinc-600">{e.cues}</p>}
              </div>
              {!e.builtIn && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" className="h-9 rounded-lg px-2 text-xs text-axiom-zinc-600" onClick={() => setEditing({ exercise: e })}>{T.edit}</Button>
                  <Button variant="ghost" className="h-9 rounded-lg px-2 text-xs text-axiom-zinc-600" disabled={archive.isPending}
                    onClick={() => { if (window.confirm(T.archiveConfirm)) archive.mutate(e.id); }}>{T.archive}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {archive.isError && <p role="alert" className="mt-2 text-xs text-axiom-destructive-ink">{errorText(archive.error, T.failed)}</p>}
      {editing && <ExerciseDialog exercise={editing.exercise} patterns={patterns} equipment={allEquipment} onClose={() => setEditing(null)} />}
    </Shell>
  );
}

export default function LibraryPage() {
  return <Gate>{(me) => <Page me={me} />}</Gate>;
}
