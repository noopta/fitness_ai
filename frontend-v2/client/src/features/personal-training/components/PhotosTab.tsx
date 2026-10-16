// The dossier's Photos tab: progress photos by date and pose. Uploads are
// downscaled in the browser to 1600px JPEG before they leave the page, so a
// phone's 12-megapixel original never travels. Photo URLs are short-lived.

import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { COPY, shortDate, type ProgressPhoto } from '@axiom/personal-training-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PCOPY } from '../copyPlatform';
import { downscaleImage, localDate } from '../platform';
import { isStorageOff, usePhotoActions, usePhotos } from '../platformHooks';
import { errorText, selectClass } from './ChipInput';
import { Eyebrow, Notice, SkeletonBlock } from './primitives';

const P = PCOPY.photos;
const POSES: ProgressPhoto['pose'][] = ['front', 'side', 'back', 'other'];
const day = (iso: string) => shortDate(new Date(`${iso}T12:00:00`));

function Upload({ clientId }: { clientId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [pose, setPose] = useState<ProgressPhoto['pose']>('front');
  const [date, setDate] = useState(localDate());
  const [note, setNote] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { add } = usePhotoActions(clientId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLocalError(null);
    setPreparing(true);
    let imageBase64: string;
    try {
      imageBase64 = await downscaleImage(file, { max: 1600, type: 'image/jpeg', quality: 0.85 });
    } catch {
      setPreparing(false);
      setLocalError(P.notImage);
      return;
    }
    setPreparing(false);
    add.mutate({ imageBase64, pose, date, ...(note.trim() ? { note: note.trim() } : {}) }, {
      onSuccess: () => { setFile(null); setNote(''); if (input.current) input.current.value = ''; },
    });
  }

  if (add.isError && isStorageOff(add.error)) return <Notice>{P.storageOff}</Notice>;

  return (
    <form className="rounded-2xl border border-border p-4" onSubmit={submit}>
      <Eyebrow className="mb-3">{P.add}</Eyebrow>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="pt-photo-file">{P.choose}</Label>
          <Input
            ref={input} id="pt-photo-file" type="file" accept="image/*" required className="h-10 rounded-xl text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setLocalError(f && !f.type.startsWith('image/') ? P.notImage : null);
              setFile(f && f.type.startsWith('image/') ? f : null);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-photo-pose">{P.pose}</Label>
          <select id="pt-photo-pose" className={selectClass} value={pose} onChange={(e) => setPose(e.target.value as ProgressPhoto['pose'])}>
            {POSES.map((p) => <option key={p} value={p}>{P.poses[p]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-photo-date">{P.date}</Label>
          <Input id="pt-photo-date" type="date" max={localDate()} required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-4">
          <Label htmlFor="pt-photo-note">{P.note}</Label>
          <Input id="pt-photo-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {(localError || add.isError) && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{localError ?? errorText(add.error, P.failed)}</p>}
      <Button type="submit" variant="secondary" className="mt-4 h-10 rounded-xl" disabled={!file || preparing || add.isPending}>
        <span aria-live="polite">{preparing ? P.preparing : P.upload}</span>
      </Button>
    </form>
  );
}

export function PhotosTab({ clientId }: { clientId: string }) {
  const photos = usePhotos(clientId);
  const { remove } = usePhotoActions(clientId);

  return (
    <div className="space-y-6">
      {photos.isPending ? (
        <div aria-busy="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="aspect-[3/4] w-full" />)}</div>
      ) : photos.isError ? (
        isStorageOff(photos.error) ? <Notice>{P.storageOff}</Notice>
          : <Notice alert action={<Button variant="secondary" className="h-10 rounded-xl" onClick={() => photos.refetch()}>{COPY.roster.retry}</Button>}>{P.loadFailed}</Notice>
      ) : photos.data.photos.length === 0 ? (
        <Notice>{P.empty}</Notice>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.data.photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-border">
              <img src={p.url} alt={P.alt(P.poses[p.pose], day(p.date))} loading="lazy" className="aspect-[3/4] w-full bg-axiom-zinc-100 object-cover" />
              <div className="flex items-start gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{P.poses[p.pose]}</p>
                  <p className="text-xs tabular-nums text-axiom-zinc-500">{day(p.date)}{p.source === 'client' ? ` · ${P.byClient}` : ''}</p>
                  {p.note && <p className="mt-0.5 break-words text-xs text-axiom-zinc-600">{p.note}</p>}
                </div>
                <Button variant="ghost" className="size-9 shrink-0 rounded-xl p-0 text-axiom-zinc-500" aria-label={`${P.remove}: ${P.poses[p.pose]}, ${day(p.date)}`} disabled={remove.isPending}
                  onClick={() => { if (window.confirm(P.removeConfirm)) remove.mutate(p.id); }}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {remove.isError && <p role="alert" className="text-xs text-axiom-destructive-ink">{errorText(remove.error, P.failed)}</p>}
      <Upload clientId={clientId} />
    </div>
  );
}
