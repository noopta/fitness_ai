// Speak instead of type: records, sends the clip for transcription, and hands
// the text back to the caller to put in a box the client can still edit. It
// never submits anything on its own. Hidden where the browser cannot record.

import { useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { errorMessage } from './api';
import { PortalButton } from './components';
import { useTranscribe } from './hooks';
import { blobToBase64, canRecordAudio, useRecorder } from './media';

export function MicButton({
  onTranscript, label, disabled, compact,
}: { onTranscript: (text: string) => void; label: string; disabled?: boolean; compact?: boolean }) {
  const recorder = useRecorder();
  const transcribe = useTranscribe();
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState(false);
  if (!canRecordAudio()) return null;

  const toggle = async () => {
    setError(null);
    setHeard(false);
    if (recorder.state !== 'recording') return recorder.start();
    const clip = await recorder.stop();
    if (!clip) return setError("We didn't catch anything. Try again.");
    try {
      const { text } = await transcribe.mutateAsync({ audioBase64: await blobToBase64(clip.blob), mimeType: clip.mimeType });
      const spoken = text.trim();
      if (!spoken) return setError("We couldn't make that out. Try again or type it.");
      onTranscript(spoken);
      setHeard(true);
    } catch (err) {
      setError(errorMessage(err, "We couldn't make that out. Try again or type it."));
    }
  };

  const recording = recorder.state === 'recording';
  const status = recording ? 'Listening… tap Stop when you are done.' : heard ? 'Check the text, then send.' : '';
  return (
    <div className={compact ? 'contents' : 'mt-2'}>
      <div className={compact ? 'contents' : 'flex items-center gap-3'}>
        <PortalButton
          variant={recording ? 'accent' : 'secondary'} onClick={toggle} disabled={disabled || transcribe.isPending}
          aria-pressed={recording} aria-label={recording ? 'Stop recording' : label}
          className={compact ? 'size-11 shrink-0 px-0' : undefined}
        >
          {transcribe.isPending ? <Loader2 className="motion-safe:animate-spin" /> : recording ? <Square /> : <Mic />}
          {!compact && (transcribe.isPending ? 'Writing it down…' : recording ? 'Stop' : 'Speak')}
        </PortalButton>
        {!compact && <p aria-live="polite" className="text-xs text-axiom-zinc-500">{status}</p>}
      </div>
      {compact && <span aria-live="polite" className="sr-only">{transcribe.isPending ? 'Writing it down' : status}</span>}
      {recorder.state === 'denied' && <p role="alert" className="mt-2 basis-full text-xs text-axiom-destructive-ink">Microphone access was blocked. You can type instead.</p>}
      {error && <p role="alert" className="mt-2 basis-full text-xs text-axiom-destructive-ink">{error}</p>}
    </div>
  );
}

/** Add spoken text after whatever is already typed. */
export function appendSpoken(current: string, spoken: string): string {
  return current.trim() ? `${current.trimEnd()} ${spoken}` : spoken;
}
