// Team: the trainers in a practice. Everyone sees who is on it and can assign
// clients; the owner also invites co-trainers (a link bound to one email),
// removes them, and sees how each trainer's clients are doing.

import { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { COPY, PersonalTrainingApiError, type Client, type MeResponse, type TeamMember } from '@axiom/personal-training-core';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAssignClient, useBillingStatus, useInviteCoach, useRemoveCoach, useTeam, useTeamAnalytics } from '../businessHooks';
import { formatMoney } from '../businessFormat';
import { BCOPY } from '../copyBusiness';
import { CopyField, errorText, selectClass } from '../components/ChipInput';
import { Gate } from '../components/Gate';
import { Avatar, Notice, PageTitle, Pill, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useRoster } from '../hooks';

const T = BCOPY.team;
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const isForbidden = (err: unknown) => err instanceof PersonalTrainingApiError && err.status === 403;

function Members({ members, meId, isOwner }: { members: TeamMember[]; meId: string; isOwner: boolean }) {
  const remove = useRemoveCoach();
  const [confirm, setConfirm] = useState<TeamMember | null>(null);
  return (
    <section aria-labelledby="members-h" className="space-y-2">
      <h2 id="members-h" className="sr-only">Members</h2>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
            <Avatar initials={initialsOf(m.name)} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{m.name}{m.userId === meId && <span className="font-normal text-axiom-zinc-500"> · {T.you}</span>}</p>
              <p className="truncate text-xs text-axiom-zinc-500">{[m.email, T.assigned(m.assignedClients)].filter(Boolean).join(' · ')}</p>
            </div>
            <Pill tone={m.role === 'owner' ? 'green' : 'zinc'}>{T.role[m.role]}</Pill>
            {isOwner && m.role === 'coach' && m.userId !== meId && (
              <Button variant="ghost" className="h-10 shrink-0 rounded-xl text-axiom-zinc-600" onClick={() => setConfirm(m)} aria-label={`${T.remove} ${m.name}`}>
                <UserMinus className="size-4" aria-hidden /><span className="hidden sm:inline">{T.remove}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(remove.error, 'Could not remove this trainer.')}</p>}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? T.removeTitle(confirm.name) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{T.removeBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.keep}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) remove.mutate(confirm.userId); setConfirm(null); }}>{T.remove}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Invite() {
  const invite = useInviteCoach();
  const [email, setEmail] = useState('');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (isForbidden(invite.error)) return null;
  return (
    <section aria-labelledby="invite-h" className="space-y-3 rounded-2xl border border-border p-4">
      <div>
        <h2 id="invite-h" className="text-[15px] font-semibold">{T.invite}</h2>
        <p className="text-sm text-axiom-zinc-600">{T.inviteBody}</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (valid) invite.mutate(email.trim()); }} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="coach-email" className="text-xs">{T.email}</Label>
          <Input id="coach-email" type="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); invite.reset(); }} className="h-10 rounded-xl" />
        </div>
        <Button type="submit" className="h-11 rounded-xl sm:h-10" disabled={!valid || invite.isPending}>{T.inviteSubmit}</Button>
      </form>
      {invite.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(invite.error, 'Could not create the invite.')}</p>}
      {invite.isSuccess && (
        <div className="space-y-1.5">
          <CopyField value={invite.data.link} label={T.inviteLink(invite.data.email)} copyLabel={COPY.invite.copy} copiedLabel={COPY.invite.copied} />
          <p className="text-xs text-axiom-zinc-500">{T.inviteExpires(new Date(invite.data.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</p>
        </div>
      )}
    </section>
  );
}

function Analytics({ currency }: { currency: string }) {
  const q = useTeamAnalytics();
  if (q.isPending) return <SkeletonBlock className="h-32 w-full rounded-2xl" />;
  if (q.isError) return isForbidden(q.error) ? null : <Notice alert>{T.loadFailed}</Notice>;
  const C = T.cols;
  return (
    <section aria-labelledby="analytics-h" className="space-y-2">
      <h2 id="analytics-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.analytics}</h2>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-axiom-zinc-50 text-left text-xs text-axiom-zinc-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">{C.trainer}</th>
              {[C.clients, C.support, C.highRisk, C.engagement, C.sessions, C.mrr].map((h) => <th key={h} scope="col" className="px-4 py-2 text-right font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.data.trainers.map((t) => (
              <tr key={t.userId}>
                <th scope="row" className="px-4 py-2.5 text-left font-semibold">{t.name}</th>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.clients}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.needsSupport}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.highRisk}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.avgEngagement === null ? '—' : Math.round(t.avgEngagement * 10) / 10}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.sessionsNext7d}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(t.mrrCents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssignRow({ client, members }: { client: Client; members: TeamMember[] }) {
  const assign = useAssignClient();
  const id = `assign-${client.id}`;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <Label htmlFor={id} className="min-w-0 truncate text-sm font-semibold">{client.name}</Label>
      <div className="sm:w-56">
        <select
          id={id} className={selectClass} aria-label={T.assignFor(client.name)} disabled={assign.isPending}
          value={client.assignedTrainerId ?? ''} onChange={(e) => assign.mutate({ clientId: client.id, trainerId: e.target.value || null })}
        >
          <option value="">{T.unassigned}</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
        {assign.isError && <p role="alert" className="mt-1 text-xs text-axiom-destructive-ink">{errorText(assign.error, 'Could not assign.')}</p>}
      </div>
    </li>
  );
}

function Assign({ members }: { members: TeamMember[] }) {
  const roster = useRoster();
  const clients = (roster.data?.clients ?? []).filter((c) => c.state !== 'archived');
  return (
    <section aria-labelledby="assign-h" className="space-y-2">
      <div>
        <h2 id="assign-h" className="text-[17px] font-semibold tracking-[-0.01em]">{T.assign}</h2>
        <p className="text-sm text-axiom-zinc-600">{T.assignBody}</p>
      </div>
      {roster.isPending ? <SkeletonBlock className="h-24 w-full rounded-2xl" /> : clients.length === 0 ? <Notice>{T.noClients}</Notice> : (
        <ul className="divide-y divide-border rounded-2xl border border-border">{clients.map((c) => <AssignRow key={c.id} client={c} members={members} />)}</ul>
      )}
    </section>
  );
}

function TeamView({ me }: { me: MeResponse }) {
  const team = useTeam();
  const members = team.data?.members ?? [];
  const isOwner = members.some((m) => m.userId === me.trainer.id && m.role === 'owner');
  return (
    <Shell me={me} active="team" title={T.title}>
      <PageTitle sub={T.sub}>{T.title}</PageTitle>
      {team.isPending ? <SkeletonBlock className="h-32 w-full rounded-2xl" /> : team.isError ? (
        <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => team.refetch()}>{BCOPY.inbox.retry}</Button>}>{T.loadFailed}</Notice>
      ) : (
        <div className="space-y-10">
          <Members members={members} meId={me.trainer.id} isOwner={isOwner} />
          {isOwner && <Invite />}
          {isOwner && <AnalyticsWithCurrency />}
          <Assign members={members} />
        </div>
      )}
    </Shell>
  );
}

/** MRR in the practice's billing currency (USD until billing answers, as on the server). */
function AnalyticsWithCurrency() {
  const billing = useBillingStatus();
  return <Analytics currency={billing.data?.status.currency || 'usd'} />;
}

export default function TeamPage() {
  return <Gate>{(me) => <TeamView me={me} />}</Gate>;
}
