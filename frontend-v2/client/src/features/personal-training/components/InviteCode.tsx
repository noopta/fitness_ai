// The short code beside an invite link ("K7QM-3XPA"): easier to read out or
// text than a link. The client types it under You → Coach in the app, or
// sends it to Anakin in chat.

import { COPY } from '@axiom/personal-training-core';
import { CopyField } from './ChipInput';

export function InviteCode({ code }: { code: string | null | undefined }) {
  if (!code) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-axiom-zinc-600">{COPY.invite.codeLabel}</p>
      <CopyField value={code} label="Invite code" copyLabel={COPY.invite.copyCode} copiedLabel={COPY.invite.copied} />
      <p className="text-xs text-axiom-zinc-500">{COPY.invite.codeHint}</p>
    </div>
  );
}
