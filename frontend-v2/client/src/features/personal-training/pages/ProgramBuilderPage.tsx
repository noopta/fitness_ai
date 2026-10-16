// The program builder (handoff B1). The canvas owns the document while it is
// open. Drafts and templates save themselves a moment after each change; a
// published program is live for the client, so it saves only on "Save
// changes", and the server refuses (and saves nothing) when the rules engine
// finds a conflict. Publishing is refused the same way; both refusals arrive
// as a 409 carrying the check, which replaces what the panel shows.

import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { ChevronRight } from 'lucide-react';
import {
  COPY, PersonalTrainingApiError, relativeDay,
  type MeResponse, type ProgramCheck, type TrainerProgram,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckPanel, RefusalNotes } from '../components/CheckPanel';
import { errorText } from '../components/ChipInput';
import { Gate } from '../components/Gate';
import { Notice, Pill, SkeletonBlock } from '../components/primitives';
import { ProgramCanvas } from '../components/ProgramCanvas';
import { Shell } from '../components/Shell';
import { PRG } from '../copyPrograms';
import { useClient } from '../hooks';
import { checkFromError, useProgramActions, useTrainerProgram } from '../programHooks';
import { docReducer, publishBlocker } from '../programDoc';

const B = PRG.builder;
const AUTOSAVE_MS = 1200;

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export const saveLabel = (s: SaveState) => (s === 'saved' ? B.saved : s === 'saving' ? B.saving : s === 'unsaved' ? B.unsaved : B.saveFailed);

interface Meta { name: string; description: string; startDate: string }

function Builder({ me, initial }: { me: MeResponse; initial: TrainerProgram }) {
  const [doc, dispatch] = useReducer(docReducer, initial.doc);
  const [meta, setMeta] = useState<Meta>({ name: initial.name, description: initial.description, startDate: initial.startDate ?? '' });
  const [server, setServer] = useState<TrainerProgram>(initial);
  const [weekId, setWeekId] = useState(initial.doc.weeks[0]?.id ?? '');
  const [state, setState] = useState<SaveState>('saved');
  const [refused, setRefused] = useState<{ kind: 'save' | 'publish'; check: ProgramCheck | null; message: string } | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  const { save, acknowledge, publish } = useProgramActions(initial.id);
  const client = useClient(initial.clientId ?? '');
  const clientName = client.data?.client.name;

  const live = server.status === 'published';
  const snapshot = useRef({ doc, meta });
  snapshot.current = { doc, meta };
  // What the server last accepted. A save reports "Saved" only when the canvas
  // still matches what it carried, so an edit made mid-save is never lost.
  const signature = (v: { doc: unknown; meta: Meta }) => JSON.stringify([v.doc, v.meta]);
  const savedSig = useRef(signature({ doc: initial.doc, meta }));
  const inFlight = useRef(false);
  const again = useRef(false);

  const patch = () => ({
    doc: snapshot.current.doc,
    name: snapshot.current.meta.name.trim() || initial.name,
    description: snapshot.current.meta.description,
    startDate: snapshot.current.meta.startDate || null,
  });

  async function saveNow(): Promise<boolean> {
    // One save at a time, so an older document can never land after a newer one.
    if (inFlight.current) { again.current = true; return false; }
    inFlight.current = true;
    const carried = signature(snapshot.current);
    setState('saving');
    let ok = false;
    try {
      const { program } = await save.mutateAsync(patch());
      // Keep the canvas as typed; take the server's check, status and version.
      setServer(program);
      setRefused(null);
      savedSig.current = carried;
      setState(signature(snapshot.current) === carried ? 'saved' : 'unsaved');
      ok = true;
    } catch (err) {
      const check = checkFromError(err);
      if (check || (err instanceof PersonalTrainingApiError && err.status === 409)) {
        setRefused({ kind: 'save', check, message: (err as Error).message });
        setState('unsaved');
      } else setState('error');
    } finally {
      inFlight.current = false;
    }
    if (again.current) { again.current = false; return saveNow(); }
    return ok;
  }

  // Drafts and templates save a moment after the last change. A live program waits for "Save changes".
  useEffect(() => {
    if (signature({ doc, meta }) === savedSig.current) return;
    setState('unsaved');
    if (live) return;
    const t = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, meta]);

  async function onPublish() {
    setRefused(null);
    if (state !== 'saved' && !(await saveNow())) return;
    publish.mutate(undefined, {
      onSuccess: ({ program }) => { setServer(program); setJustPublished(true); setState('saved'); },
      onError: (err) => setRefused({ kind: 'publish', check: checkFromError(err), message: errorText(err, B.publishRefused) }),
    });
  }

  const shownCheck = refused?.check ?? server.check;
  const blocker = publishBlocker({ ...server, check: shownCheck });
  const busy = save.isPending || publish.isPending;

  return (
    <Shell me={me} active="programs" title={meta.name || B.back} width="wide">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-xs text-axiom-zinc-500">
        <Link href="/personal-training/programs" className="rounded font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15">{B.back}</Link>
        <ChevronRight className="size-3" aria-hidden />
        <span aria-current="page" className="truncate">{meta.name}</span>
      </nav>

      <header className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <Label htmlFor="pt-program-name" className="sr-only">{B.name}</Label>
            <Input id="pt-program-name" value={meta.name} maxLength={80} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
              className="h-12 rounded-xl border-transparent px-2 text-[22px] font-bold tracking-[-0.02em] hover:border-border focus-visible:border-border md:text-[26px]" />
            <div className="mt-1 flex flex-wrap items-center gap-2 px-2 text-xs text-axiom-zinc-500">
              <Pill tone={live ? 'green' : 'zinc'}>{PRG.status[server.status]}</Pill>
              <Pill tone="zinc">{PRG.source[server.source]}</Pill>
              <span>{server.isTemplate ? B.template : clientName ? B.forClient(clientName) : ''}</span>
              <span aria-live="polite" className={state === 'error' ? 'text-axiom-destructive-ink' : undefined}>{saveLabel(state)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1.5 md:items-end">
            <div className="flex flex-wrap gap-2">
              {live && (
                <Button variant="secondary" className="h-11 rounded-xl md:h-10" disabled={busy || state === 'saved'} onClick={() => void saveNow()}>{B.saveChanges}</Button>
              )}
              {!server.isTemplate && !live && (
                <Button className="h-11 rounded-xl md:h-10" disabled={!!blocker || busy} aria-describedby={blocker ? 'pt-publish-reason' : undefined} onClick={() => void onPublish()}>
                  {B.publish}
                </Button>
              )}
            </div>
            {blocker && !live && <p id="pt-publish-reason" className="max-w-xs text-xs text-axiom-zinc-600 md:text-right">{blocker}</p>}
          </div>
        </div>

        {live && !justPublished && <p className="rounded-xl bg-axiom-zinc-50 px-4 py-3 text-sm text-axiom-zinc-600">{B.liveNote}</p>}
        {justPublished && <p role="status" className="rounded-xl bg-axiom-success-soft px-4 py-3 text-sm text-axiom-success-ink">{B.publishedNote(clientName?.split(' ')[0] ?? 'Your client')}</p>}
        {refused && (
          <div role="alert" className="rounded-xl border border-axiom-destructive/30 bg-axiom-destructive-soft px-4 py-3 text-sm text-axiom-destructive-ink">
            <p className="font-semibold">{refused.kind === 'save' ? B.nothingSaved : B.publishRefused}</p>
            <p className="mt-0.5">{refused.message}</p>
          </div>
        )}
        <RefusalNotes annotations={server.annotations} />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <Label htmlFor="pt-program-desc" className="text-[11px] text-axiom-zinc-500">{B.description}</Label>
            <Textarea id="pt-program-desc" rows={2} maxLength={1000} value={meta.description} placeholder={B.descriptionPlaceholder}
              onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} className="rounded-xl text-sm" />
          </div>
          <div>
            <Label htmlFor="pt-program-start" className="text-[11px] text-axiom-zinc-500">{B.startDate}</Label>
            <Input id="pt-program-start" type="date" value={meta.startDate} onChange={(e) => setMeta((m) => ({ ...m, startDate: e.target.value }))} className="h-10 rounded-xl" />
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <ProgramCanvas doc={doc} dispatch={dispatch} check={shownCheck} annotations={server.annotations} weekId={weekId} onWeekChange={setWeekId} />
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <CheckPanel
            check={shownCheck}
            isTemplate={server.isTemplate}
            acknowledging={acknowledge.isPending}
            onAcknowledge={(key) => acknowledge.mutate([key], { onSuccess: ({ program }) => { setServer(program); setRefused(null); } })}
          />
          {acknowledge.isError && <p role="alert" className="mt-2 text-xs text-axiom-destructive-ink">{errorText(acknowledge.error, PRG.list.failed)}</p>}
          <p className="mt-3 text-xs text-axiom-zinc-500">{PRG.list.updated(relativeDay(server.updatedAt)?.toLowerCase() ?? '')}</p>
        </aside>
      </div>
    </Shell>
  );
}

function Page({ me, id }: { me: MeResponse; id: string }) {
  const program = useTrainerProgram(id);
  const notFound = program.error instanceof PersonalTrainingApiError && program.error.status === 404;
  if (program.isPending) {
    return (
      <Shell me={me} active="programs" title={B.back} width="wide">
        <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-12 w-80" /><SkeletonBlock className="h-40 w-full" /><SkeletonBlock className="h-40 w-full" /></div>
      </Shell>
    );
  }
  if (program.isError) {
    return (
      <Shell me={me} active="programs" title={B.back} width="wide">
        <Notice alert action={notFound ? <Button asChild variant="secondary" className="h-10 rounded-xl"><Link href="/personal-training/programs">{B.back}</Link></Button>
          : <Button variant="secondary" className="h-10 rounded-xl" onClick={() => program.refetch()}>{COPY.roster.retry}</Button>}>
          {notFound ? B.notFound : B.loadFailed}
        </Notice>
      </Shell>
    );
  }
  return <Builder key={program.data.program.id} me={me} initial={program.data.program} />;
}

export default function ProgramBuilderPage() {
  const [, params] = useRoute('/personal-training/programs/:id');
  const id = params?.id ?? '';
  return <Gate>{(me) => <Page me={me} id={id} />}</Gate>;
}
