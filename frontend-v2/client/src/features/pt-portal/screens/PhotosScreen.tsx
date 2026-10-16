// Progress photos: take or pick one, choose the pose, upload a downscaled
// JPEG. Only the client and their trainer can see them.

import { useRef, useState } from 'react';
import { Camera, ImageOff, Trash2 } from 'lucide-react';
import type { ProgressPhoto } from '@axiom/personal-training-core';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/features/personal-training/components/primitives';
import { errorMessage, isPhotosUnavailable } from '../api';
import { Card, EmptyState, InlineError, LoadFailed, PortalButton, ScreenTitle, SkeletonBlock } from '../components';
import { formatDay, localDateISO } from '../helpers';
import { useAddPhoto, useDeletePhoto, usePhotos } from '../hooks';
import { downscalePhoto } from '../media';

type Pose = ProgressPhoto['pose'];
const POSES: { value: Pose; label: string }[] = [
  { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }, { value: 'back', label: 'Back' }, { value: 'other', label: 'Other' },
];
const POSE_LABEL: Record<Pose, string> = { front: 'Front', side: 'Side', back: 'Back', other: 'Other' };

function Unavailable() {
  return <EmptyState icon={<ImageOff />} title="Photo uploads aren't available yet">Your trainer's practice hasn't switched them on. Everything else here works as normal.</EmptyState>;
}

export function PhotosScreen({ enabled = true }: { enabled?: boolean }) {
  const photos = usePhotos();
  const add = useAddPhoto();
  const del = useDeletePhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ dataUrl: string; base64: string } | null>(null);
  const [pose, setPose] = useState<Pose>('front');
  const [date, setDate] = useState(localDateISO());
  const [prepError, setPrepError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [confirm, setConfirm] = useState<ProgressPhoto | null>(null);
  const unavailable = !enabled || isPhotosUnavailable(add.error) || isPhotosUnavailable(photos.error);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPrepError(null);
    add.reset();
    setPreparing(true);
    try {
      const out = await downscalePhoto(file);
      setDraft(out);
      setDate(localDateISO());
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'That photo could not be read. Try another.');
    } finally {
      setPreparing(false);
    }
  };

  const upload = () => {
    if (!draft) return;
    add.mutate({ imageBase64: draft.base64, pose, date }, { onSuccess: () => setDraft(null) });
  };

  return (
    <div className="space-y-4">
      <ScreenTitle sub="Only you and your trainer can see these.">Progress photos</ScreenTitle>

      {unavailable ? <Unavailable /> : draft ? (
        <Card>
          <h2 className="mb-3 text-[15px] font-semibold">New photo</h2>
          <img src={draft.dataUrl} alt="Preview of the photo you picked" className="mx-auto max-h-80 w-auto rounded-xl object-contain" />
          <div className="mt-4 space-y-3">
            <div>
              <p id="pose-l" className="mb-1.5 text-xs text-axiom-zinc-600">Pose</p>
              <div className="[&>div]:flex [&>div]:w-full [&_button]:h-11 [&_button]:flex-1">
                <SegmentedControl value={pose} onChange={setPose} options={POSES} label="Pose" />
              </div>
            </div>
            <div>
              <Label htmlFor="photo-date" className="mb-1.5 block text-xs text-axiom-zinc-600">Date</Label>
              <Input id="photo-date" type="date" max={localDateISO()} value={date} onChange={(e) => setDate(e.target.value || localDateISO())} className="h-11 rounded-xl text-base md:text-sm" />
            </div>
          </div>
          {add.isError && !unavailable && <div className="mt-3"><InlineError>{errorMessage(add.error, 'That photo could not be uploaded. Try again.')}</InlineError></div>}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <PortalButton variant="secondary" onClick={() => { setDraft(null); add.reset(); }} disabled={add.isPending}>Cancel</PortalButton>
            <PortalButton onClick={upload} disabled={add.isPending}>{add.isPending ? 'Uploading…' : 'Upload'}</PortalButton>
          </div>
        </Card>
      ) : (
        <div>
          <input
            ref={fileRef} id="photo-file" type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPick}
            aria-label="Choose a progress photo"
          />
          <PortalButton className="w-full" onClick={() => fileRef.current?.click()} disabled={preparing}>
            <Camera /> {preparing ? 'Preparing…' : 'Add a photo'}
          </PortalButton>
          {prepError && <div className="mt-3"><InlineError>{prepError}</InlineError></div>}
        </div>
      )}

      {photos.isPending ? (
        <div aria-busy="true" aria-label="Loading photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="aspect-[3/4] w-full rounded-2xl" />)}
        </div>
      ) : photos.isError ? (isPhotosUnavailable(photos.error) ? null : <LoadFailed onRetry={() => photos.refetch()} />) : photos.data.photos.length === 0 ? (
        !unavailable && <EmptyState title="No photos yet">Same spot, same light, every few weeks makes the change easy to see.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.data.photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-border bg-background">
              <img src={p.url} alt={`${POSE_LABEL[p.pose]} photo, ${formatDay(p.date)}`} loading="lazy" className="aspect-[3/4] w-full bg-axiom-zinc-100 object-cover" />
              <div className="flex items-center justify-between gap-1 py-1 pl-3 pr-1">
                <p className="min-w-0 truncate text-xs text-axiom-zinc-600"><span className="font-semibold text-foreground">{POSE_LABEL[p.pose]}</span> · {formatDay(p.date)}</p>
                <button
                  type="button" onClick={() => setConfirm(p)} aria-label={`Delete ${POSE_LABEL[p.pose].toLowerCase()} photo from ${formatDay(p.date)}`}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-axiom-zinc-500 hover:text-axiom-destructive-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {del.isError && <InlineError>{errorMessage(del.error, 'That photo could not be deleted. Try again.')}</InlineError>}

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription>It will be removed for you and your trainer. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-axiom-destructive text-white" onClick={() => { if (confirm) del.mutate(confirm.id); setConfirm(null); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
