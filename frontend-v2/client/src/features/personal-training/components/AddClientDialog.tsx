// "Add client" from the roster: two ways in. The app invite is the existing
// InvitePanel; the web link adds a client who never installs anything and
// trains through a personal page. The trainer sends that link themselves.

import { useState } from 'react';
import { Link } from 'wouter';
import { ChevronRight, Link2, Smartphone } from 'lucide-react';
import { COPY } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PCOPY } from '../copyPlatform';
import { useCreateLinkClient, useTags } from '../platformHooks';
import { ChipInput, CopyField, errorText } from './ChipInput';

const choiceClass = cn(
  'flex w-full items-start gap-3 rounded-2xl border border-border p-4 text-left transition-colors duration-200 hover:bg-axiom-zinc-50',
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15',
);

function LinkClientForm({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const create = useCreateLinkClient();
  const known = useTags();

  if (create.data) {
    const { client, link } = create.data;
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm font-semibold">{PCOPY.addClient.created(client.name)}</p>
        <CopyField value={link.url} label={PCOPY.link.title(client.name.split(' ')[0])} copyLabel={COPY.invite.copy} copiedLabel={COPY.invite.copied} />
        <div className="space-y-1.5 rounded-xl bg-axiom-zinc-50 px-4 py-3 text-xs leading-relaxed text-axiom-zinc-600">
          <p>{PCOPY.addClient.sendYourself}</p>
          <p>{PCOPY.addClient.personal}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="h-10 rounded-xl"><Link href={`/personal-training/clients/${client.id}/timeline`} onClick={onClose}>{PCOPY.addClient.openDossier}</Link></Button>
          <Button type="button" variant="secondary" className="h-10 rounded-xl" onClick={onClose}>{PCOPY.addClient.done}</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        create.mutate({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}), ...(tags.length ? { tags } : {}) });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="pt-link-name">{PCOPY.addClient.name}</Label>
        <Input id="pt-link-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pt-link-email">{PCOPY.addClient.email}</Label>
          <Input id="pt-link-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pt-link-phone">{PCOPY.addClient.phone}</Label>
          <Input id="pt-link-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pt-link-tags">{PCOPY.addClient.tags}</Label>
        <ChipInput
          id="pt-link-tags" value={tags} onChange={setTags} placeholder={PCOPY.tags.placeholder} removeLabel={PCOPY.tags.remove}
          suggestions={known.data?.tags.map((t) => t.tag) ?? []} suggestionsLabel={PCOPY.tags.suggestions}
        />
      </div>
      {create.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(create.error, PCOPY.addClient.failed)}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={onBack}>{PCOPY.addClient.back}</Button>
        <Button type="submit" className="h-10 flex-1 rounded-xl" disabled={!name.trim() || create.isPending}>{PCOPY.addClient.create}</Button>
      </div>
    </form>
  );
}

export function AddClientDialog({ open, onOpenChange, onInviteToApp }: { open: boolean; onOpenChange: (open: boolean) => void; onInviteToApp: () => void }) {
  const [step, setStep] = useState<'choose' | 'link'>('choose');
  const close = (next: boolean) => { if (!next) setStep('choose'); onOpenChange(next); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{step === 'link' ? PCOPY.addClient.linkTitle : PCOPY.addClient.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{step === 'link' ? PCOPY.addClient.linkBody : PCOPY.addClient.body}</DialogDescription>
        </DialogHeader>
        {step === 'choose' ? (
          <div className="space-y-2">
            <button type="button" className={choiceClass} onClick={() => { close(false); onInviteToApp(); }}>
              <Smartphone className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{PCOPY.addClient.appTitle}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-axiom-zinc-600">{PCOPY.addClient.appBody}</span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-axiom-zinc-400" aria-hidden />
            </button>
            <button type="button" className={choiceClass} onClick={() => setStep('link')}>
              <Link2 className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{PCOPY.addClient.linkTitle}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-axiom-zinc-600">{PCOPY.addClient.linkBody}</span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-axiom-zinc-400" aria-hidden />
            </button>
          </div>
        ) : (
          <LinkClientForm onBack={() => setStep('choose')} onClose={() => close(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
