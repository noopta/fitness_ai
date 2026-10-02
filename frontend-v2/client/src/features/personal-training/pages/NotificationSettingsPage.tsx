// Notification settings (design handoff §6.7): a delivery tier per event type,
// a live estimate of how often the trainer will be interrupted, channels,
// quiet hours and per-client overrides. Every change saves on its own.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  COPY, hourLabel,
  type MeResponse, type NotificationGroup, type NotificationOverride, type NotificationSettings, type Tier,
} from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Gate } from '../components/Gate';
import { Eyebrow, Notice, PageTitle, SegmentedControl, SkeletonBlock } from '../components/primitives';
import { Shell } from '../components/Shell';
import { useNotificationSettings, useRoster, useSaveNotificationSettings } from '../hooks';

const TIERS: Tier[] = ['immediate', 'briefing', 'timeline'];
const GROUPS: NotificationGroup[] = ['Safety', 'Engagement', 'Client activity', 'Insights'];
const selectClass = 'h-10 rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15';
const stripNames = (overrides: NotificationOverride[]) => overrides.map(({ clientName: _n, ...o }) => o);

function Settings({ settings }: { settings: NotificationSettings }) {
  const save = useSaveNotificationSettings();
  const roster = useRoster();
  const [draft, setDraft] = useState<{ clientId: string; eventType: string; tier: Tier; note: string }>({ clientId: '', eventType: '*', tier: 'immediate', note: '' });
  const clients = roster.data?.clients ?? [];

  return (
    <div className="space-y-10">
      <section>
        <p className="text-[17px] font-semibold tracking-[-0.01em]" aria-live="polite">{COPY.notifications.estimate(settings.weeklyEstimate)}</p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-axiom-zinc-600">
          {TIERS.map((t) => (
            <div key={t} className="flex gap-1.5"><dt>{COPY.notifications.tiers[t]}</dt><dd className="font-semibold tabular-nums text-foreground">{settings.tierCounts[t]}</dd></div>
          ))}
        </dl>
        <div className="mt-2 min-h-5">
          {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{(save.error as Error).message || COPY.notifications.saveFailed}</p>}
          {save.isSuccess && <p role="status" className="text-sm text-axiom-success-ink">{COPY.notifications.saved}</p>}
        </div>
      </section>

      {GROUPS.map((group) => (
        <section key={group} aria-label={group}>
          <Eyebrow className="mb-2">{group}</Eyebrow>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {settings.rules.filter((r) => r.group === group).map((r) => (
              <li key={r.eventType} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{r.label}</p>
                  <p className="text-xs text-axiom-zinc-500 tabular-nums">{COPY.notifications.perWeek(r.perWeek)}{r.locked ? ` · ${COPY.notifications.locked}` : ''}</p>
                </div>
                <SegmentedControl
                  size="sm" label={r.label} value={r.tier}
                  onChange={(tier) => save.mutate({ rules: { [r.eventType]: tier } })}
                  options={TIERS.map((t) => ({
                    value: t, label: COPY.notifications.tiers[t],
                    // Pain and injury can never be recorded silently: the segment is disabled, with the reason.
                    disabled: r.locked && t === 'timeline',
                    title: r.locked && t === 'timeline' ? COPY.notifications.locked : COPY.notifications.tierHelp[t],
                  }))}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <Eyebrow className="mb-2">{COPY.notifications.channels}</Eyebrow>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {(['push', 'email'] as const).map((c) => (
            <li key={c} className="flex min-h-14 items-center justify-between gap-3 px-4">
              <Label htmlFor={`pt-channel-${c}`} className="text-[13px] font-semibold">{COPY.notifications[c]}</Label>
              <Switch id={`pt-channel-${c}`} checked={settings.channels[c]} onCheckedChange={(v) => save.mutate({ channels: { [c]: v } })} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Eyebrow className="mb-2">{COPY.notifications.quietHours}</Eyebrow>
        <p className="mb-3 text-xs text-axiom-zinc-600">{COPY.notifications.quietHelp}</p>
        <div className="flex flex-wrap items-center gap-3">
          {(['start', 'end'] as const).map((edge) => (
            <label key={edge} className="flex items-center gap-2 text-[13px]">
              {edge === 'start' ? COPY.notifications.from : COPY.notifications.to}
              <select className={selectClass} value={settings.quietHours[edge]} onChange={(e) => save.mutate({ quietHours: { ...settings.quietHours, [edge]: Number(e.target.value) } })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section>
        <Eyebrow className="mb-2">{COPY.notifications.overrides}</Eyebrow>
        <p className="mb-3 text-xs text-axiom-zinc-600">{COPY.notifications.overridesHelp}</p>
        {settings.overrides.length > 0 && (
          <ul className="mb-3 divide-y divide-border rounded-2xl border border-border">
            {settings.overrides.map((o, i) => (
              <li key={`${o.clientId}-${o.eventType}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 text-[13px]">
                  <span className="font-semibold">{o.clientName ?? 'Client'}</span>: {o.eventType === '*' ? COPY.notifications.allEvents.toLowerCase() : settings.rules.find((r) => r.eventType === o.eventType)?.label.toLowerCase()}{' '}
                  → {COPY.notifications.tiers[o.tier].toLowerCase()}{o.note ? ` · ${o.note}` : ''}
                </p>
                <Button variant="ghost" className="size-10 shrink-0 rounded-xl p-0 text-axiom-zinc-500" aria-label={`${COPY.notifications.removeOverride}: ${o.clientName ?? ''}`}
                  onClick={() => save.mutate({ overrides: stripNames(settings.overrides.filter((_, j) => j !== i)) })}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.clientId) return;
            const rest = settings.overrides.filter((o) => !(o.clientId === draft.clientId && o.eventType === draft.eventType));
            save.mutate({ overrides: [...stripNames(rest), { clientId: draft.clientId, eventType: draft.eventType, tier: draft.tier, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }] },
              { onSuccess: () => setDraft((d) => ({ ...d, clientId: '', note: '' })) });
          }}
        >
          <select aria-label="Client" className={selectClass} value={draft.clientId} onChange={(e) => setDraft((d) => ({ ...d, clientId: e.target.value }))}>
            <option value="">Client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Event" className={selectClass} value={draft.eventType} onChange={(e) => setDraft((d) => ({ ...d, eventType: e.target.value }))}>
            <option value="*">{COPY.notifications.allEvents}</option>
            {settings.rules.map((r) => <option key={r.eventType} value={r.eventType}>{r.label}</option>)}
          </select>
          <select aria-label="Tier" className={selectClass} value={draft.tier} onChange={(e) => setDraft((d) => ({ ...d, tier: e.target.value as Tier }))}>
            {TIERS.map((t) => <option key={t} value={t}>{COPY.notifications.tiers[t]}</option>)}
          </select>
          <div className="min-w-40 flex-1">
            <Input aria-label={COPY.notifications.overrideNote} value={draft.note} maxLength={120} placeholder={COPY.notifications.overrideNotePlaceholder} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} className="h-10 rounded-xl" />
          </div>
          <Button type="submit" variant="secondary" className="h-10 rounded-xl" disabled={!draft.clientId || save.isPending}>{COPY.notifications.addOverride}</Button>
        </form>
      </section>
    </div>
  );
}

function Page({ me }: { me: MeResponse }) {
  const settings = useNotificationSettings();
  return (
    <Shell me={me} active="settings" title={COPY.notifications.title} width="narrow">
      <PageTitle>{COPY.notifications.title}</PageTitle>
      {settings.isPending ? <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-10 w-72" /><SkeletonBlock className="h-64 w-full" /></div>
        : settings.isError ? <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => settings.refetch()}>{COPY.roster.retry}</Button>}>{COPY.notifications.loadFailed}</Notice>
        : <Settings settings={settings.data} />}
    </Shell>
  );
}

export default function NotificationSettingsPage() {
  return <Gate>{(me) => <Page me={me} />}</Gate>;
}
