// A practice's public page at /p/:slug: who the trainer is, how they work,
// and an enquiry form (with an optional free consult when they have open
// times). Anonymous — no Axiom sign-in, no session — and branded with the
// practice's colour and logo.

import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Globe2, MapPin, MonitorSmartphone } from 'lucide-react';
import { PersonalTrainingApiError, type PublicPractice, type Slot } from '@axiom/personal-training-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatLocalDate, formatMinute, groupSlotsByDate } from '@/features/personal-training/businessFormat';
import { Card, PortalButton, PracticeMark, SkeletonBlock } from '@/features/pt-portal/components';
import { accentVars } from '@/features/pt-portal/helpers';
import { publicApi } from './api';

const FORMAT: Record<NonNullable<PublicPractice['format']>, { label: string; icon: typeof Globe2 }> = {
  online: { label: 'Online coaching', icon: MonitorSmartphone },
  hybrid: { label: 'Online and in person', icon: Globe2 },
  in_person: { label: 'In person', icon: MapPin },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

export interface EnquiryFields { name: string; email: string; phone: string; goal: string; message: string; website: string }

/** What the form would send, or why it can't yet. Mirrors the server's own checks. Exported for tests. */
export function enquiryFromForm(f: EnquiryFields, consultAt: string | null):
  { input: { name: string; email?: string; phone?: string; goal?: string; message?: string; consultAt?: string; website?: string } } | { error: string } {
  const name = f.name.trim();
  if (name.length < 2) return { error: 'Tell us your name.' };
  const email = f.email.trim();
  const phone = f.phone.trim();
  if (email && !EMAIL_RE.test(email)) return { error: 'That email address doesn’t look right.' };
  if (phone && !PHONE_RE.test(phone)) return { error: 'That phone number doesn’t look right.' };
  if (!email && !phone) return { error: 'Leave an email or phone number so they can reply.' };
  const input: { name: string; email?: string; phone?: string; goal?: string; message?: string; consultAt?: string; website?: string } = { name };
  if (email) input.email = email;
  if (phone) input.phone = phone;
  if (f.goal.trim()) input.goal = f.goal.trim();
  if (f.message.trim()) input.message = f.message.trim();
  if (consultAt) input.consultAt = consultAt;
  // The honeypot travels as typed: only a bot fills it, and the server quietly drops those.
  if (f.website) input.website = f.website;
  return { input };
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-axiom-zinc-500">{label}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((t) => <li key={t} className="rounded-full border border-border bg-background px-3 py-1 text-[13px] font-medium">{t}</li>)}
      </ul>
    </div>
  );
}

function ConsultPicker({ slug, value, onChange }: { slug: string; value: Slot | null; onChange: (s: Slot | null) => void }) {
  const q = useQuery({ queryKey: ['pt-public', slug, 'slots'], queryFn: () => publicApi.slots(slug), staleTime: 60_000, retry: false });
  if (q.isPending) return <SkeletonBlock className="h-24 w-full rounded-xl" />;
  if (q.isError || q.data.slots.length === 0) return <p className="text-sm text-axiom-zinc-600">No open times right now. Send your enquiry and they’ll suggest one.</p>;
  return (
    <div className="space-y-3">
      {groupSlotsByDate(q.data.slots).map((g) => (
        <div key={g.date} role="group" aria-label={formatLocalDate(g.date)}>
          <p className="mb-1.5 text-sm font-semibold">{formatLocalDate(g.date)}</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {g.slots.map((s) => {
              const on = value?.startsAt === s.startsAt && value.trainerId === s.trainerId;
              return (
                <li key={`${s.trainerId}-${s.startsAt}`}>
                  <button
                    type="button" aria-pressed={on} onClick={() => onChange(on ? null : s)}
                    aria-label={`${formatLocalDate(g.date)} at ${formatMinute(s.localMinute)}`}
                    className={cn(
                      'min-h-11 w-full rounded-xl border text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                      on ? 'border-[var(--portal-accent)] bg-[var(--portal-accent)] text-[var(--portal-on-accent)]' : 'border-border bg-background hover:bg-axiom-zinc-50',
                    )}
                  >
                    {formatMinute(s.localMinute)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EnquiryForm({ practice }: { practice: PublicPractice }) {
  const [f, setF] = useState<EnquiryFields>({ name: '', email: '', phone: '', goal: '', message: '', website: '' });
  const [consult, setConsult] = useState<Slot | null>(null);
  const [wantsConsult, setWantsConsult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({ mutationFn: (input: Parameters<typeof publicApi.enquire>[1]) => publicApi.enquire(practice.slug, input) });
  const first = practice.trainerName.split(/\s+/)[0] || practice.trainerName;
  const set = (k: keyof EnquiryFields, v: string) => { setF((s) => ({ ...s, [k]: v })); setError(null); };

  if (send.isSuccess) {
    return (
      <Card className="py-8 text-center" aria-live="polite">
        <CheckCircle2 aria-hidden className="mx-auto mb-3 size-10 text-axiom-success" />
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Thanks, {f.name.trim().split(/\s+/)[0]}.</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-axiom-zinc-600">
          {first} has your message and will get back to you soon.
          {consult && ` You asked for a free consult on ${formatLocalDate(consult.localDate)} at ${formatMinute(consult.localMinute)}; ${first} will confirm it.`}
        </p>
      </Card>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out = enquiryFromForm(f, wantsConsult && consult ? consult.startsAt : null);
    if ('error' in out) return setError(out.error);
    send.mutate(out.input);
  };
  const serverError = send.error instanceof PersonalTrainingApiError && send.error.status < 500 && send.error.status > 0 ? send.error.message : send.isError ? 'Something went wrong. Try again in a moment.' : null;

  return (
    <Card as="section" aria-labelledby="enquire-h">
      <h2 id="enquire-h" className="text-[19px] font-semibold tracking-[-0.01em]">Get in touch with {first}</h2>
      <p className="mt-1 text-sm text-axiom-zinc-600">Tell them a little about you. No account needed.</p>
      <form onSubmit={submit} noValidate className="relative mt-4 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="enq-name">Your name</Label>
          <Input id="enq-name" autoComplete="name" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} className="h-11 rounded-xl text-base md:text-sm" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="enq-email">Email</Label>
            <Input id="enq-email" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={(e) => set('email', e.target.value)} className="h-11 rounded-xl text-base md:text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="enq-phone">Phone <span className="font-normal text-axiom-zinc-500">(or email)</span></Label>
            <Input id="enq-phone" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} className="h-11 rounded-xl text-base md:text-sm" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="enq-goal">What would you like to work on?</Label>
          <Input id="enq-goal" value={f.goal} maxLength={300} placeholder="Get stronger, run a 10k, come back from an injury…" onChange={(e) => set('goal', e.target.value)} className="h-11 rounded-xl text-base md:text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="enq-message">Anything else <span className="font-normal text-axiom-zinc-500">(optional)</span></Label>
          <Textarea id="enq-message" rows={4} maxLength={1000} value={f.message} onChange={(e) => set('message', e.target.value)} className="rounded-xl text-base md:text-sm" />
        </div>
        {/* Honeypot: people never see or reach it; bots that fill every field give themselves away. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="enq-website">Website</label>
          <input id="enq-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} />
        </div>

        {practice.offersConsults && (
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Book a free consult <span className="font-normal text-axiom-zinc-500">(optional)</span></legend>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--portal-accent)]" checked={wantsConsult} onChange={(e) => { setWantsConsult(e.target.checked); if (!e.target.checked) setConsult(null); }} />
              Pick a time for a short intro call with {first}
            </label>
            {wantsConsult && <ConsultPicker slug={practice.slug} value={consult} onChange={setConsult} />}
          </fieldset>
        )}

        {(error || serverError) && <p role="alert" className="rounded-xl bg-axiom-destructive-soft px-3 py-2 text-sm text-axiom-destructive-ink">{error ?? serverError}</p>}
        <PortalButton type="submit" className="w-full" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send enquiry'}</PortalButton>
        <p className="text-center text-xs text-axiom-zinc-500">Your details go only to {practice.name}.</p>
      </form>
    </Card>
  );
}

function Unavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-axiom-zinc-50 px-4">
      <div role="alert" className="w-full max-w-[420px] rounded-2xl border border-border bg-background p-8 text-center shadow-xs">
        <h1 className="text-[19px] font-semibold tracking-[-0.01em]">This page isn’t available.</h1>
        <p className="mt-2 text-sm text-axiom-zinc-600">The link may be wrong, or the trainer has taken it down.</p>
      </div>
    </main>
  );
}

export default function PublicPracticePage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const q = useQuery({ queryKey: ['pt-public', slug], queryFn: () => publicApi.practice(slug), enabled: !!slug, retry: false, staleTime: 5 * 60_000 });
  const practice = q.data?.practice;

  useEffect(() => {
    if (!practice) return;
    const prev = document.title;
    document.title = `${practice.name} · ${practice.trainerName}`;
    return () => { document.title = prev; };
  }, [practice]);

  if (!slug || (q.isError && q.error instanceof PersonalTrainingApiError && q.error.status === 404)) return <Unavailable />;
  if (q.isPending) {
    return (
      <main aria-busy="true" aria-label="Loading" className="min-h-screen bg-axiom-zinc-50">
        <div className="mx-auto max-w-[640px] px-4 pt-10">
          <SkeletonBlock className="mb-4 size-16 rounded-2xl" /><SkeletonBlock className="mb-2 h-8 w-64" /><SkeletonBlock className="mb-6 h-4 w-40" /><SkeletonBlock className="h-40 w-full rounded-2xl" />
        </div>
      </main>
    );
  }
  if (!practice) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-axiom-zinc-50 px-4">
        <div role="alert" className="w-full max-w-[420px] rounded-2xl border border-border bg-background p-8 text-center">
          <p className="text-[15px] font-semibold">Couldn’t load this page right now.</p>
          <PortalButton variant="secondary" className="mt-4" onClick={() => q.refetch()}>Try again</PortalButton>
        </div>
      </main>
    );
  }

  const format = practice.format ? FORMAT[practice.format] : null;
  const branding = { practiceName: practice.name, trainerName: practice.trainerName, logoUrl: practice.logoUrl, brandColor: practice.brandColor, accentColor: practice.accentColor };
  return (
    <div className="min-h-screen bg-axiom-zinc-50 text-foreground" style={accentVars(practice.brandColor) as React.CSSProperties}>
      <header className="relative overflow-hidden bg-[var(--portal-accent)] text-[var(--portal-on-accent)]">
        <div className="mx-auto max-w-[640px] px-4 pb-14 pt-10">
          <div className="mb-5 inline-flex rounded-2xl bg-background p-1.5 shadow-xs"><PracticeMark branding={branding} size={56} /></div>
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{practice.name}</h1>
          <p className="mt-1 text-[15px] opacity-85">Coached by {practice.trainerName}</p>
          {format && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/10 px-3 py-1 text-[13px] font-semibold">
              <format.icon aria-hidden className="size-4" /> {format.label}
            </p>
          )}
        </div>
      </header>
      <main className="mx-auto -mt-8 max-w-[640px] space-y-4 px-4 pb-16">
        {(practice.bio || practice.specialties.length > 0 || practice.styleTags.length > 0 || practice.languages.length > 0) && (
          <Card as="section" aria-label={`About ${practice.trainerName}`} className="space-y-4">
            {practice.bio && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{practice.bio}</p>}
            <Chips label="Specialties" items={practice.specialties} />
            <Chips label="Coaching style" items={practice.styleTags} />
            <Chips label="Languages" items={practice.languages} />
          </Card>
        )}
        <EnquiryForm practice={practice} />
        <p className="pt-2 text-center text-xs text-axiom-zinc-500">Powered by Axiom</p>
      </main>
    </div>
  );
}
