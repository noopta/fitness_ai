// Practice settings: who the trainer is (bio, specialties, style, languages,
// format, time zone) and the branding clients see on their web link. Unlike
// notification settings, this is a form with one Save: a half-typed bio
// should never reach a client's page. The logo uploads on its own.

import { useMemo, useRef, useState } from 'react';
import { COPY, type MeResponse, type PracticeProfile } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput, errorText, selectClass } from '../components/ChipInput';
import { Gate } from '../components/Gate';
import { Eyebrow, Notice, PageTitle, SegmentedControl, SkeletonBlock } from '../components/primitives';
import { SettingsNav } from '../components/SettingsNav';
import { Shell } from '../components/Shell';
import { PCOPY } from '../copyPlatform';
import { downscaleImage, isHex } from '../platform';
import { isStorageOff, usePracticeProfile, useSavePracticeProfile, useUploadLogo } from '../platformHooks';

const T = PCOPY.practice;
type Format = NonNullable<PracticeProfile['format']>;
const FORMATS: Format[] = ['online', 'hybrid', 'in_person'];

/** Every IANA zone the browser knows, falling back to the viewer's own when the API is missing. */
export function timeZones(current: string | null): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let zones: string[] = [];
  try {
    zones = supported ? supported('timeZone') : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = [Intl.DateTimeFormat().resolvedOptions().timeZone].filter(Boolean);
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const bad = value !== '' && !isHex(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color" aria-label={`${label}, picker`} value={isHex(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-border bg-background p-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15"
        />
        <Input id={id} value={value} maxLength={7} placeholder="#1F6FEB" aria-invalid={bad} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.value.trim())} className="h-10 min-w-0 flex-1 rounded-xl font-mono text-sm uppercase" />
      </div>
      <p id={`${id}-hint`} className={bad ? 'text-xs text-axiom-destructive-ink' : 'text-xs text-axiom-zinc-500'}>{bad ? T.badHex : T.colorHint}</p>
    </div>
  );
}

function Logo({ url }: { url: string | null }) {
  const upload = useUploadLogo();
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setLocalError(null);
    if (!file.type.startsWith('image/')) { setLocalError(PCOPY.photos.notImage); return; }
    setPreparing(true);
    try {
      // PNG keeps a transparent background; 512px is plenty for a page header.
      const data = await downscaleImage(file, { max: 512, type: 'image/png' });
      upload.mutate(data);
    } catch {
      setLocalError(PCOPY.photos.notImage);
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = '';
    }
  }

  const storageOff = upload.isError && isStorageOff(upload.error);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-axiom-zinc-50">
        {url ? <img src={url} alt={T.logo} className="max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-xs text-axiom-zinc-500">{T.logoNone}</span>}
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-axiom-zinc-500">{T.logoHelp}</p>
        <input ref={input} id="pt-logo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
        <Button type="button" variant="secondary" className="h-10 rounded-xl" disabled={preparing || upload.isPending || storageOff} onClick={() => input.current?.click()}>
          {url ? T.logoReplace : T.logoUpload}
        </Button>
        {storageOff ? <p role="status" className="text-xs text-axiom-zinc-600">{T.logoStorageOff}</p>
          : (localError || upload.isError) && <p role="alert" className="text-xs text-axiom-destructive-ink">{localError ?? errorText(upload.error, T.logoFailed)}</p>}
      </div>
    </div>
  );
}

interface Form {
  name: string; bio: string; specialties: string[]; styleTags: string[]; languages: string[];
  format: Format | null; timezone: string; brandColor: string; accentColor: string;
}

const formOf = (p: PracticeProfile, name: string): Form => ({
  name, bio: p.bio, specialties: p.specialties, styleTags: p.styleTags, languages: p.languages,
  format: p.format, timezone: p.timezone ?? '', brandColor: p.brandColor ?? '', accentColor: p.accentColor ?? '',
});

function Settings({ profile, practiceName }: { profile: PracticeProfile; practiceName: string }) {
  const [form, setForm] = useState<Form>(() => formOf(profile, practiceName));
  const save = useSavePracticeProfile();
  const zones = useMemo(() => timeZones(profile.timezone), [profile.timezone]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { save.reset(); setForm((f) => ({ ...f, [k]: v })); };
  const nameOk = form.name.trim().length >= 2 && form.name.trim().length <= 80;
  const valid = nameOk && (!form.brandColor || isHex(form.brandColor)) && (!form.accentColor || isHex(form.accentColor));

  const chips = (key: 'specialties' | 'styleTags' | 'languages', label: string, placeholder: string) => (
    <div className="space-y-2">
      <Label htmlFor={`pt-practice-${key}`}>{label}</Label>
      <ChipInput id={`pt-practice-${key}`} value={form[key]} onChange={(v) => set(key, v)} placeholder={placeholder} removeLabel={PCOPY.tags.remove} describedBy="pt-practice-chip-hint" />
    </div>
  );

  return (
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate({
          ...(form.name.trim() !== practiceName ? { name: form.name.trim() } : {}),
          bio: form.bio,
          specialties: form.specialties,
          styleTags: form.styleTags,
          languages: form.languages,
          format: form.format,
          timezone: form.timezone || null,
          brandColor: form.brandColor || null,
          accentColor: form.accentColor || null,
        });
      }}
    >
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pt-practice-name">{T.name}</Label>
          <Input id="pt-practice-name" required minLength={2} maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pt-practice-bio">{T.bio}</Label>
          <Textarea id="pt-practice-bio" rows={4} maxLength={2000} value={form.bio} placeholder={T.bioPlaceholder} onChange={(e) => set('bio', e.target.value)} className="rounded-xl text-sm leading-relaxed" />
        </div>
        {chips('specialties', T.specialties, T.specialtiesPlaceholder)}
        {chips('styleTags', T.styleTags, T.styleTagsPlaceholder)}
        {chips('languages', T.languages, T.languagesPlaceholder)}
        <p id="pt-practice-chip-hint" className="text-xs text-axiom-zinc-500">{T.chipHint}</p>
        <div className="space-y-2">
          <p className="text-[13px] font-semibold">{T.format}</p>
          <SegmentedControl<Format> label={T.format} value={form.format ?? ('' as Format)} onChange={(v) => set('format', v)} options={FORMATS.map((f) => ({ value: f, label: T.formats[f] }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pt-practice-tz">{T.timezone}</Label>
          <select id="pt-practice-tz" className={selectClass} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
            <option value="">{T.timezoneNone}</option>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </section>

      <section className="space-y-4">
        <Eyebrow>{T.branding}</Eyebrow>
        <div className="space-y-2">
          <p className="text-[13px] font-semibold">{T.logo}</p>
          <Logo url={profile.logoUrl} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField id="pt-practice-brand" label={T.brandColor} value={form.brandColor} onChange={(v) => set('brandColor', v)} />
          <ColorField id="pt-practice-accent" label={T.accentColor} value={form.accentColor} onChange={(v) => set('accentColor', v)} />
        </div>
        <div aria-label={T.preview} className="overflow-hidden rounded-2xl border border-border">
          <div className="flex items-center gap-3 px-4 py-3" style={{ background: isHex(form.brandColor) ? form.brandColor : undefined }}>
            {profile.logoUrl && <img src={profile.logoUrl} alt="" className="size-8 rounded-lg bg-background object-contain" />}
            <p className={isHex(form.brandColor) ? 'text-[13px] font-semibold text-white' : 'text-[13px] font-semibold'}>{form.name.trim() || practiceName}</p>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-axiom-zinc-500">{T.preview}</p>
            <span className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: isHex(form.accentColor) ? form.accentColor : 'var(--foreground)' }}>{T.previewButton}</span>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-11 rounded-xl md:h-10" disabled={!valid || save.isPending}>{T.save}</Button>
        {save.isSuccess && <p role="status" className="text-sm text-axiom-success-ink">{T.saved}</p>}
        {save.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{errorText(save.error, T.failed)}</p>}
      </div>
    </form>
  );
}

function Page({ me }: { me: MeResponse }) {
  const profile = usePracticeProfile();
  return (
    <Shell me={me} active="settings" title={T.title} width="narrow">
      <PageTitle sub={T.sub}>{T.title}</PageTitle>
      <SettingsNav active="practice" />
      {profile.isPending ? <div aria-busy="true" className="space-y-3"><SkeletonBlock className="h-10 w-72" /><SkeletonBlock className="h-64 w-full" /></div>
        : profile.isError ? <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => profile.refetch()}>{COPY.roster.retry}</Button>}>{T.loadFailed}</Notice>
        : <Settings profile={profile.data.profile} practiceName={me.practice?.name ?? ''} />}
    </Shell>
  );
}

export default function PracticeSettingsPage() {
  return <Gate>{(me) => <Page me={me} />}</Gate>;
}
