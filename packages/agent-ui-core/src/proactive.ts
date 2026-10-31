// Proactive coach (design "Proactive Coach Flows v4"): the platform-agnostic
// bits of the client — the attach tray's state machine (E1/E1b/E2 and the
// form-check clip, H1), countdown and kind labels (D1/F2), check-in frequency
// rows (F1), and the receipts a history turn carries (A1). Tested here;
// mobileAlt renders them.

import type { Receipt, ReceiptVerb } from './receipts';

// ── E1/E1b/E2/H1 · the attach tray ──────────────────────────────────────────

export const MAX_ATTACH = 4;
export type AttachStatus = 'uploading' | 'ready' | 'failed';
/** What the user said the picture is (E1 tiles Meal · Label · Program) — Anakin knows what to do with it before reading it. */
export type AttachIntent = 'meal' | 'label' | 'program';
export type Lift = 'Squat' | 'Bench' | 'Deadlift' | 'Other';
export const LIFT_PILLS: Lift[] = ['Squat', 'Bench', 'Deadlift', 'Other'];

export interface AttachItem {
  /** Local file uri — kept on failure so Try again needs no re-pick. */
  localUri: string;
  media: 'photo' | 'video';
  status: AttachStatus;
  /** Server id once uploaded (a photo id, or the form-analysis id for a clip). */
  id?: string;
  kind?: string;
  private?: boolean;
  error?: string;
  /** Clip length, seconds (video). */
  durationSec?: number | null;
}
export interface AttachState {
  items: AttachItem[];
  intent: AttachIntent | null;
  /** The lift a clip is of (H1 pills). Pre-picked from today's session. */
  lift: Lift;
}
export type AttachAction =
  | { type: 'add'; uris: string[]; media?: 'photo' | 'video'; durationSec?: number | null }
  | { type: 'intent'; intent: AttachIntent | null }
  | { type: 'lift'; lift: Lift }
  | { type: 'uploaded'; localUri: string; id: string; kind: string; private: boolean }
  | { type: 'failed'; localUri: string; error?: string }
  | { type: 'retry'; localUri: string }
  | { type: 'remove'; localUri: string }
  | { type: 'clear' };

export const EMPTY_ATTACH: AttachState = { items: [], intent: null, lift: 'Squat' };

/**
 * Pure. Up to four photos, or one clip (a set video stands alone — the lift
 * pills apply to it). Failures keep the local file; retry re-enters
 * uploading. A clip is "ready" the moment it is staged: it uploads on send,
 * through the form-analysis pipeline, not the photo route.
 */
export function attachReducer(s: AttachState, a: AttachAction): AttachState {
  switch (a.type) {
    case 'add': {
      const media = a.media ?? 'photo';
      if (media === 'video') {
        const uri = a.uris[0];
        return uri ? { ...s, items: [{ localUri: uri, media: 'video', status: 'ready', durationSec: a.durationSec ?? null }] } : s;
      }
      const photos = s.items.filter((i) => i.media === 'photo');
      const room = Math.max(0, MAX_ATTACH - photos.length);
      const fresh = a.uris.filter((u) => !photos.some((i) => i.localUri === u)).slice(0, room).map((localUri): AttachItem => ({ localUri, media: 'photo', status: 'uploading' }));
      return { ...s, items: [...photos, ...fresh] };
    }
    case 'intent': return { ...s, intent: a.intent };
    case 'lift': return { ...s, lift: a.lift };
    case 'uploaded': return { ...s, items: s.items.map((i) => (i.localUri === a.localUri ? { ...i, status: 'ready', id: a.id, kind: a.kind, private: a.private, error: undefined } : i)) };
    case 'failed': return { ...s, items: s.items.map((i) => (i.localUri === a.localUri ? { ...i, status: 'failed', error: a.error ?? 'Didn’t send' } : i)) };
    case 'retry': return { ...s, items: s.items.map((i) => (i.localUri === a.localUri ? { ...i, status: 'uploading', error: undefined } : i)) };
    case 'remove': { const items = s.items.filter((i) => i.localUri !== a.localUri); return { ...s, items, intent: items.length ? s.intent : null }; }
    case 'clear': return { ...EMPTY_ATTACH, lift: s.lift };
  }
}
/** Photo ids ready to send. A message may go while one upload is still failed — the failed one stays in the tray. */
export const readyPhotoIds = (s: AttachState): string[] => s.items.filter((i) => i.media === 'photo' && i.status === 'ready' && i.id).map((i) => i.id!);
export const stagedClip = (s: AttachState): AttachItem | null => s.items.find((i) => i.media === 'video') ?? null;
export const attachBusy = (s: AttachState): boolean => s.items.some((i) => i.status === 'uploading');
/** E1b: the send control fills crimson whenever something is staged, even with no text. */
export const sendReady = (text: string, s: AttachState, busy = false): boolean => !busy && !attachBusy(s) && (text.trim().length > 0 || readyPhotoIds(s).length > 0 || !!stagedClip(s));
/** How many more photos the tray takes. */
export const attachRoom = (s: AttachState): number => stagedClip(s) ? 0 : Math.max(0, MAX_ATTACH - s.items.filter((i) => i.media === 'photo').length);

export const INTENT_LABEL: Record<AttachIntent, string> = { meal: 'Meal', label: 'Label', program: 'Program' };

/** "0:24" */
export function clipLabel(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** E1b caption: "2 photos · Meal · sent with your message" · "Form check · 0:24 · Squat". */
export function stagedCaption(s: AttachState): string | null {
  const clip = stagedClip(s);
  if (clip) return `Form check · ${clipLabel(clip.durationSec)} · ${s.lift}`;
  const n = s.items.filter((i) => i.media === 'photo').length;
  if (!n) return null;
  return [`${n} photo${n === 1 ? '' : 's'}`, s.intent ? INTENT_LABEL[s.intent] : null, 'sent with your message'].filter(Boolean).join(' · ');
}

/** The composer's placeholder while something is staged. */
export function attachPlaceholder(s: AttachState): string | null {
  if (stagedClip(s)) return `${s.lift} · top set? Say the weight and reps`;
  if (!s.items.length) return null;
  const intent = s.intent ?? (s.items.every((i) => i.kind === 'meal') && s.items.some((i) => i.kind) ? 'meal' : s.items.some((i) => i.kind === 'program') ? 'program' : null);
  if (intent === 'meal') return 'Send me lunch and I’ll log it.';
  if (intent === 'program') return 'Screenshot a program → I’ll import it';
  if (intent === 'label') return 'A label → I’ll check it against your targets';
  return 'Say what you want to know about it';
}

/** H1: the lift pre-picked from today's session, else Squat. */
export function liftFromSession(exerciseNames: string[]): Lift {
  for (const n of exerciseNames) {
    const x = n.toLowerCase();
    if (/squat/.test(x)) return 'Squat';
    if (/bench/.test(x)) return 'Bench';
    if (/deadlift/.test(x)) return 'Deadlift';
  }
  return 'Squat';
}

/** The user turn's caption for a sent clip: "Squat · 225 × 5, top set" (their words after the lift). */
export function clipTurnText(lift: Lift, typed: string): string {
  const t = typed.trim();
  return t ? `${lift} · ${t}` : `${lift} set`;
}

// ── D1 · countdown ──────────────────────────────────────────────────────────

/** "23 days out" · "Tomorrow" · "Today". */
export function daysOutLabel(n: number): string {
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `${n} days out`;
}

// ── F1 · frequency rows ─────────────────────────────────────────────────────

export type Frequency = 'rarely' | 'normal' | 'often';
export const FREQUENCY_ROWS: { key: Frequency; name: string; sub: string }[] = [
  { key: 'rarely', name: 'Rarely', sub: 'Up to 2 a week' },
  { key: 'normal', name: 'Normal', sub: 'Up to 1 a day' },
  { key: 'often', name: 'Often', sub: 'Up to 2 a day' },
];
export const quietHoursLabel = (start: number, end: number): string => `${hour12(start)} – ${hour12(end)}`;
const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

// ── F2 · photo kinds ────────────────────────────────────────────────────────

export const PHOTO_KIND_LABEL: Record<string, string> = { meal: 'Meal', label: 'Label', program: 'Program', machine: 'Machine', injury: 'Injury', bloodwork: 'Bloodwork', body: 'Body', other: 'Photo' };
export const PRIVATE_PHOTO_KINDS = new Set(['injury', 'bloodwork', 'body']);
export const isPrivatePhoto = (kind: string) => PRIVATE_PHOTO_KINDS.has(kind);
/** F2 groups: private · meals and labels · program screenshots · other. */
export function groupPhotos<T extends { kind: string }>(photos: T[]): { private: T[]; meals: T[]; programs: T[]; other: T[] } {
  return {
    private: photos.filter((p) => isPrivatePhoto(p.kind)),
    meals: photos.filter((p) => p.kind === 'meal' || p.kind === 'label'),
    programs: photos.filter((p) => p.kind === 'program'),
    other: photos.filter((p) => !isPrivatePhoto(p.kind) && !['meal', 'label', 'program'].includes(p.kind)),
  };
}

// ── A1 · receipts on a history turn ─────────────────────────────────────────

const VERBS = new Set<string>(['Reading', 'Read', 'Pulled', 'Searched', 'Computed', 'Checked', 'Heard', 'Delegated', 'Logged', 'Adjusted', 'Proposed', 'Noted', 'Saved', 'Drafted', 'Sent', 'Posted', 'Deleted', 'Corrected', 'Started', 'Opened', 'Forgot', 'Removed']);
/** History receipts → the thread's Receipt shape (final, with ids). Unknown verbs fall back to Checked. */
export function historyReceipts(raw: { verb: string; text: string }[] | undefined, turnId: string): Receipt[] {
  return (raw ?? []).map((r, i) => ({ id: `${turnId}r${i}`, verb: (VERBS.has(r.verb) ? r.verb : 'Checked') as ReceiptVerb, text: r.text, final: true } as Receipt));
}

// ── H2 · the watching turn, before the server's result lands ────────────────

/** Receipts shown while a set is being read. The server's result turn replaces this when it arrives. */
export function watchingReceipts(lift: Lift, previousDate: string | null): { verb: ReceiptVerb; text: string }[] {
  return [
    { verb: 'Reading', text: 'Video · the set, side view' },
    { verb: 'Computed', text: 'Depth, bar path and tempo per rep' },
    ...(previousDate ? [{ verb: 'Checked' as ReceiptVerb, text: `Your ${lift.toLowerCase()} check from ${previousDate}` }] : []),
  ];
}

// ── H1 · choosing a clip from the library (our own list, not the system picker) ──

export interface LibraryClip { id: string; duration: number; creationTime: number; width?: number; height?: number }
export interface ClipRow { id: string; name: string; sub: string; seconds: number }
/** A set is 3 s to 3 min; longer is a whole session, shorter is nothing. */
export const CLIP_MIN_S = 3;
export const CLIP_MAX_S = 180;
/** Pure: the recent-clips rows — newest first, within the set length, labelled "Oct 31 · 0:24 · portrait". */
export function clipRows(assets: LibraryClip[], now = Date.now(), max = 8): ClipRow[] {
  return [...assets]
    .filter((a) => a.duration >= CLIP_MIN_S && a.duration <= CLIP_MAX_S)
    .sort((a, b) => b.creationTime - a.creationTime)
    .slice(0, max)
    .map((a) => {
      const d = new Date(a.creationTime);
      const sameDay = new Date(now).toDateString() === d.toDateString();
      const when = sameDay ? `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const shape = a.width && a.height ? (a.height > a.width ? 'portrait' : 'landscape') : null;
      return { id: a.id, name: `${when} · ${clipLabel(a.duration)}`, sub: [shape, shape === 'landscape' ? 'turn the phone for a side view next time' : null].filter(Boolean).join(' · ') || 'Side view works best', seconds: a.duration };
    });
}
