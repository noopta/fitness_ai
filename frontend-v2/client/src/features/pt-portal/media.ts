// Browser-side media for the portal: shrinking a phone photo before upload and
// recording a spoken check-in answer. The sizing maths lives in helpers.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fitWithin, PHOTO_JPEG_QUALITY, PHOTO_MAX_EDGE, stripDataUrl } from './helpers';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return stripDataUrl(await blobToDataUrl(blob));
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can read')); };
    img.src = url;
  });
}

/**
 * Scale a photo to at most 1600px on its long edge and re-encode as JPEG.
 * Returns a data URL (for the preview) and the bare base64 (for the upload).
 * Browsers apply EXIF orientation when decoding into an <img>, so the result is upright.
 */
export async function downscalePhoto(file: Blob): Promise<{ dataUrl: string; base64: string; width: number; height: number }> {
  const img = await loadImage(file);
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, PHOTO_MAX_EDGE);
  if (!width || !height) throw new Error('That file is not an image we can read');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare the photo');
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
  return { dataUrl, base64: stripDataUrl(dataUrl), width, height };
}

/** True when this browser can record from the microphone. */
export function canRecordAudio(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as any).MediaRecorder === 'function'
    && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function pickMimeType(): string | undefined {
  const MR = (window as any).MediaRecorder;
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return typeof MR?.isTypeSupported === 'function' ? options.find((t) => MR.isTypeSupported(t)) : undefined;
}

export type RecorderState = 'idle' | 'recording' | 'denied';

/** Hold one microphone recording at a time; `stop()` resolves with the audio. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const done = useRef<((b: { blob: Blob; mimeType: string } | null) => void) | null>(null);

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  };

  useEffect(() => () => { try { recorder.current?.stop(); } catch { /* already stopped */ } release(); }, []);

  const start = useCallback(async () => {
    if (recorder.current) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mimeType = pickMimeType();
      const r = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.current.push(e.data); };
      r.onstop = () => {
        const type = (r.mimeType || mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks.current, { type });
        release();
        setState('idle');
        done.current?.(blob.size > 0 ? { blob, mimeType: type } : null);
        done.current = null;
      };
      recorder.current = r;
      r.start();
      setState('recording');
    } catch {
      release();
      setState('denied');
    }
  }, []);

  const stop = useCallback(() => new Promise<{ blob: Blob; mimeType: string } | null>((resolve) => {
    const r = recorder.current;
    if (!r || r.state === 'inactive') return resolve(null);
    done.current = resolve;
    r.stop();
  }), []);

  return { state, start, stop };
}
