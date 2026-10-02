// Invite a client to the practice. v1 is the app invite only — the client
// signs in with their Axiom account and accepts. The no-install web link in
// the design is a separate client channel and is not built.

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { COPY, shortDate } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateInvite } from '../hooks';

export function InvitePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const invite = useCreateInvite();

  function close(next: boolean) {
    if (!next) { setEmail(''); setCopied(false); invite.reset(); }
    onOpenChange(next);
  }

  async function copy() {
    if (!invite.data) return;
    try {
      await navigator.clipboard.writeText(invite.data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link stays selectable in the field.
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.invite.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-axiom-zinc-600">{COPY.invite.body}</DialogDescription>
        </DialogHeader>

        {invite.data ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={invite.data.link} aria-label="Invite link" className="flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="secondary" className="h-10 shrink-0 rounded-xl" onClick={copy}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                <span aria-live="polite">{copied ? COPY.invite.copied : COPY.invite.copy}</span>
              </Button>
            </div>
            <p className="text-xs text-axiom-zinc-500">
              {COPY.invite.expires(shortDate(new Date(invite.data.expiresAt)))}
              {invite.data.email ? ` ${invite.data.email}` : ''}
            </p>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); invite.mutate(email.trim() || undefined); }}
          >
            <div className="space-y-2">
              <Label htmlFor="pt-invite-email">{COPY.invite.emailLabel}</Label>
              <Input id="pt-invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
              <p className="text-xs text-axiom-zinc-500">{COPY.invite.emailHint}</p>
            </div>
            {invite.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{COPY.invite.failed}</p>}
            <Button type="submit" className="h-10 w-full rounded-xl" disabled={invite.isPending}>{COPY.invite.generate}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
