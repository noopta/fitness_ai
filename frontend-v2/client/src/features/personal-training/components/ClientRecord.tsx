// The practice's own record of a client, in the dossier header: the pinned
// contraindication chips, the actions menu (pause, archive, tags, contact
// details, the web link) and the dialogs behind it. Nothing here messages the
// client; a new web link is sent by the trainer themselves.

import { useState } from 'react';
import { useLocation } from 'wouter';
import { MoreHorizontal } from 'lucide-react';
import { COPY, relativeDay, shortDate, type Client } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PCOPY } from '../copyPlatform';
import { contraChip, localDate } from '../platform';
import { useClientLink, useLinkActions, usePatchClient, useTags } from '../platformHooks';
import { ChipInput, CopyField, errorText } from './ChipInput';
import { SkeletonBlock } from './primitives';

const firstName = (c: Client) => c.name.split(' ')[0];
const dialogClass = 'max-h-[90vh] max-w-md overflow-y-auto rounded-2xl';
const titleClass = 'text-[17px] font-semibold tracking-[-0.01em]';

// ── Contraindication chips ───────────────────────────────────────────────────

/** Red while not cleared, amber once modified, hidden once cleared. "Review" marks what the trainer has not confirmed. */
export function ContraindicationChips({ client, onOpenHealth }: { client: Client; onOpenHealth?: () => void }) {
  const shown = client.contraindications.map((c) => ({ c, chip: contraChip(c) })).filter((x) => x.chip);
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Injuries">
      {shown.length === 0 && <li className="text-xs text-axiom-zinc-500">{COPY.timeline.noContraindications}</li>}
      {shown.map(({ c, chip }) => (
        <li key={c.id ?? c.label} title={c.note}>
          <button
            type="button"
            onClick={onOpenHealth}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
              chip!.tone === 'red' ? 'bg-axiom-destructive-soft text-axiom-destructive-ink' : 'bg-axiom-warning-soft text-axiom-warning-ink',
            )}
          >
            {c.label}
            {chip!.tone === 'amber' && <span className="font-normal">· {PCOPY.health.clearance.modified.toLowerCase()}</span>}
            {chip!.review && <span className="rounded bg-background px-1 text-[10px] text-axiom-warning-ink ring-1 ring-axiom-warning">{PCOPY.health.review}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

type DialogProps = { client: Client; open: boolean; onOpenChange: (open: boolean) => void };

function PauseDialog({ client, open, onOpenChange }: DialogProps) {
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const patch = usePatchClient(client.id);
  const tomorrow = localDate(new Date(Date.now() + 86_400_000));
  const close = (next: boolean) => { if (!next) { setUntil(''); setReason(''); patch.reset(); } onOpenChange(next); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PCOPY.pause.title(firstName(client))}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PCOPY.pause.body}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // Midnight at the start of that day, in the trainer's time zone.
            patch.mutate(
              { state: 'paused', pausedUntil: until ? new Date(`${until}T00:00:00`).toISOString() : null, stateReason: reason.trim() || null },
              { onSuccess: () => close(false) },
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="pt-pause-until">{PCOPY.pause.until}</Label>
            <Input id="pt-pause-until" type="date" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} aria-describedby="pt-pause-until-hint" />
            <p id="pt-pause-until-hint" className="text-xs text-axiom-zinc-500">{PCOPY.pause.untilHint}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-pause-reason">{PCOPY.pause.reason}</Label>
            <Input id="pt-pause-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={PCOPY.pause.reasonPlaceholder} />
          </div>
          {patch.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(patch.error, PCOPY.actions.failed)}</p>}
          <Button type="submit" className="h-10 w-full rounded-xl" disabled={patch.isPending}>{PCOPY.pause.submit}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({ client, open, onOpenChange }: DialogProps) {
  const patch = usePatchClient(client.id);
  const close = (next: boolean) => { if (!next) patch.reset(); onOpenChange(next); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PCOPY.archive.title(client.name)}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PCOPY.archive.body}</DialogDescription>
        </DialogHeader>
        {patch.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(patch.error, PCOPY.actions.failed)}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={() => close(false)}>{PCOPY.actions.cancel}</Button>
          <Button type="button" variant="destructive" className="h-10 rounded-xl" disabled={patch.isPending} onClick={() => patch.mutate({ state: 'archived' }, { onSuccess: () => close(false) })}>
            {PCOPY.archive.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TagsDialog({ client, open, onOpenChange }: DialogProps) {
  const [tags, setTags] = useState<string[]>(client.tags ?? []);
  const patch = usePatchClient(client.id);
  const known = useTags(open);
  const close = (next: boolean) => { if (!next) patch.reset(); else setTags(client.tags ?? []); onOpenChange(next); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PCOPY.tags.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PCOPY.tags.body}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); patch.mutate({ tags }, { onSuccess: () => close(false) }); }}>
          <div className="space-y-2">
            <Label htmlFor="pt-client-tags" className="sr-only">{PCOPY.tags.title}</Label>
            <ChipInput
              id="pt-client-tags" value={tags} onChange={setTags} placeholder={PCOPY.tags.placeholder} removeLabel={PCOPY.tags.remove}
              suggestions={known.data?.tags.map((t) => t.tag) ?? []} suggestionsLabel={PCOPY.tags.suggestions}
            />
          </div>
          {patch.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(patch.error, PCOPY.actions.failed)}</p>}
          <Button type="submit" className="h-10 w-full rounded-xl" disabled={patch.isPending}>{PCOPY.actions.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({ client, open, onOpenChange }: DialogProps) {
  const linkClient = client.channel === 'webLink';
  const initial = () => ({ name: client.name, email: client.contactEmail ?? '', phone: client.contactPhone ?? '' });
  const [form, setForm] = useState(initial);
  const patch = usePatchClient(client.id);
  const close = (next: boolean) => { if (!next) patch.reset(); else setForm(initial()); onOpenChange(next); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PCOPY.contact.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PCOPY.contact.body}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({
              // An app client's name belongs to their account; the server refuses to rename them.
              ...(linkClient && form.name.trim() !== client.name ? { name: form.name.trim() } : {}),
              contactEmail: form.email.trim() || null,
              contactPhone: form.phone.trim() || null,
            }, { onSuccess: () => close(false) });
          }}
        >
          {linkClient ? (
            <div className="space-y-2">
              <Label htmlFor="pt-contact-name">{PCOPY.contact.name}</Label>
              <Input id="pt-contact-name" required maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
          ) : <p className="text-xs text-axiom-zinc-500">{PCOPY.contact.appNameNote}</p>}
          <div className="space-y-2">
            <Label htmlFor="pt-contact-email">{PCOPY.contact.email}</Label>
            <Input id="pt-contact-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="client@example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-contact-phone">{PCOPY.contact.phone}</Label>
            <Input id="pt-contact-phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          {patch.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(patch.error, PCOPY.actions.failed)}</p>}
          <Button type="submit" className="h-10 w-full rounded-xl" disabled={patch.isPending || (linkClient && !form.name.trim())}>{PCOPY.actions.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Current link with Copy; a new link (the old one stops working) or turning it off each ask first. */
function LinkDialog({ client, open, onOpenChange }: DialogProps) {
  const link = useClientLink(client.id, open);
  const { issue, revoke } = useLinkActions(client.id);
  const [confirm, setConfirm] = useState<'renew' | 'revoke' | null>(null);
  const close = (next: boolean) => { if (!next) { setConfirm(null); issue.reset(); revoke.reset(); } onOpenChange(next); };
  const current = link.data?.link ?? null;
  const failed = issue.error ?? revoke.error;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PCOPY.link.title(firstName(client))}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PCOPY.link.body}</DialogDescription>
        </DialogHeader>
        {link.isPending ? (
          <div aria-busy="true" aria-label={PCOPY.link.loading}><SkeletonBlock className="h-10 w-full" /></div>
        ) : link.isError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-axiom-zinc-600">{PCOPY.link.loadFailed}</p>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => link.refetch()}>{COPY.roster.retry}</Button>
          </div>
        ) : confirm ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed">{confirm === 'renew' ? PCOPY.link.renewConfirm : PCOPY.link.revokeConfirm}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={() => setConfirm(null)}>{PCOPY.actions.cancel}</Button>
              <Button
                type="button"
                variant={confirm === 'revoke' ? 'destructive' : 'default'}
                className="h-10 rounded-xl"
                disabled={issue.isPending || revoke.isPending}
                onClick={() => (confirm === 'renew' ? issue.mutate(undefined, { onSuccess: () => setConfirm(null) }) : revoke.mutate(undefined, { onSuccess: () => setConfirm(null) }))}
              >
                {confirm === 'renew' ? PCOPY.link.renewSubmit : PCOPY.link.revokeSubmit}
              </Button>
            </div>
          </div>
        ) : current ? (
          <div className="space-y-3">
            <CopyField value={current.url} label={PCOPY.link.title(firstName(client))} copyLabel={PCOPY.link.copy} copiedLabel={PCOPY.link.copied} />
            <p className="text-xs text-axiom-zinc-500">
              {PCOPY.link.created(shortDate(new Date(current.createdAt)))} · {current.lastUsedAt ? PCOPY.link.lastUsed(relativeDay(current.lastUsedAt)?.toLowerCase() ?? '') : PCOPY.link.neverUsed}
            </p>
            <p className="rounded-xl bg-axiom-zinc-50 px-4 py-3 text-xs leading-relaxed text-axiom-zinc-600">{PCOPY.addClient.sendYourself}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="h-10 rounded-xl" onClick={() => setConfirm('renew')}>{PCOPY.link.renew}</Button>
              <Button type="button" variant="ghost" className="h-10 rounded-xl text-axiom-destructive-ink" onClick={() => setConfirm('revoke')}>{PCOPY.link.revoke}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p role={revoke.isSuccess ? 'status' : undefined} className="text-sm text-axiom-zinc-600">{revoke.isSuccess ? PCOPY.link.revoked : PCOPY.link.none}</p>
            <Button type="button" className="h-10 rounded-xl" disabled={issue.isPending} onClick={() => issue.mutate()}>{PCOPY.link.create}</Button>
          </div>
        )}
        {failed && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(failed, PCOPY.actions.failed)}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** A "Not joined" client from a spreadsheet becomes a link client. Their id changes, so the dossier follows them. */
export function ConvertToLinkDialog({ client, open, onOpenChange }: DialogProps) {
  const { issue } = useLinkActions(client.id);
  const [, navigate] = useLocation();
  const close = (next: boolean) => { if (!next) issue.reset(); onOpenChange(next); };
  const made = issue.data;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className={titleClass}>{PCOPY.link.convertTitle(firstName(client))}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{PCOPY.link.convertBody}</DialogDescription>
        </DialogHeader>
        {made ? (
          <div className="space-y-3">
            <CopyField value={made.link.url} label={PCOPY.link.title(firstName(client))} copyLabel={PCOPY.link.copy} copiedLabel={PCOPY.link.copied} />
            <div className="space-y-1.5 rounded-xl bg-axiom-zinc-50 px-4 py-3 text-xs leading-relaxed text-axiom-zinc-600">
              <p>{PCOPY.addClient.sendYourself}</p>
              <p>{PCOPY.addClient.personal}</p>
            </div>
            <Button
              type="button"
              className="h-10 w-full rounded-xl"
              onClick={() => { close(false); if (made.client && made.client.id !== client.id) navigate(`/personal-training/clients/${made.client.id}/timeline`); }}
            >
              {PCOPY.addClient.done}
            </Button>
          </div>
        ) : (
          <>
            {issue.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(issue.error, PCOPY.actions.failed)}</p>}
            <Button type="button" className="h-10 w-full rounded-xl" disabled={issue.isPending} onClick={() => issue.mutate()}>{PCOPY.link.convertSubmit}</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Menu ─────────────────────────────────────────────────────────────────────

type Open = 'pause' | 'archive' | 'tags' | 'contact' | 'link' | null;

export function ClientActionsMenu({ client }: { client: Client }) {
  const [open, setOpen] = useState<Open>(null);
  const patch = usePatchClient(client.id);
  const paused = client.state === 'paused';
  const archived = client.state === 'archived';
  const linkClient = client.channel === 'webLink';
  const dialog = (key: Exclude<Open, null>) => ({ client, open: open === key, onOpenChange: (o: boolean) => setOpen(o ? key : null) });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="h-11 w-11 rounded-xl p-0 md:h-10 md:w-10" aria-label={PCOPY.actions.menu}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl">
          {!archived && (paused
            ? <DropdownMenuItem onSelect={() => patch.mutate({ state: 'active' })}>{PCOPY.actions.resume}</DropdownMenuItem>
            : <DropdownMenuItem onSelect={() => setOpen('pause')}>{PCOPY.actions.pause}</DropdownMenuItem>)}
          <DropdownMenuItem onSelect={() => setOpen('tags')}>{PCOPY.actions.editTags}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen('contact')}>{linkClient ? PCOPY.actions.editDetails : PCOPY.actions.editContact}</DropdownMenuItem>
          {linkClient && !archived && <DropdownMenuItem onSelect={() => setOpen('link')}>{PCOPY.actions.portalLink}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {archived
            ? <DropdownMenuItem onSelect={() => patch.mutate({ state: 'active' })}>{PCOPY.actions.restore}</DropdownMenuItem>
            : <DropdownMenuItem className="text-axiom-destructive-ink" onSelect={() => setOpen('archive')}>{PCOPY.actions.archive}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {patch.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{errorText(patch.error, PCOPY.actions.failed)}</p>}
      <PauseDialog {...dialog('pause')} />
      <ArchiveDialog {...dialog('archive')} />
      <TagsDialog {...dialog('tags')} />
      <ContactDialog {...dialog('contact')} />
      {linkClient && <LinkDialog {...dialog('link')} />}
    </>
  );
}

/** Archived clients still open here; the banner says what that means and offers the way back. */
export function ArchivedBanner({ client }: { client: Client }) {
  const patch = usePatchClient(client.id);
  return (
    <div role="status" className="mb-4 flex flex-col gap-3 rounded-xl bg-axiom-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm text-axiom-zinc-600">
        <p>{PCOPY.archive.banner}</p>
        {client.channel === 'webLink' && <p className="mt-0.5 text-xs text-axiom-zinc-500">{PCOPY.archive.restoreNote}</p>}
      </div>
      <Button variant="secondary" className="h-10 shrink-0 rounded-xl" disabled={patch.isPending} onClick={() => patch.mutate({ state: 'active' })}>{PCOPY.actions.restore}</Button>
    </div>
  );
}
