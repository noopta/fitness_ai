// Proactive coach (design "Proactive Coach Flows v3"): the platform-agnostic
// bits of the client — the attach tray's state machine (E1/E2), countdown
// and kind labels (D1/F2), check-in frequency rows (F1), and the receipts a
// history turn carries (A1). Tested here; mobileAlt renders them.

import type { Receipt, ReceiptVerb } from './receipts';

// ── E1/E2 · the attach tray ─────────────────────────────────────────────────

export const MAX_ATTACH = 4;
export type AttachStatus = 'uploading' | 'ready' | 'failed';
export interface AttachItem {
  /** Local file uri — kept on failure so Try again needs no re-pick. */
  localUri: string;
  status: AttachStatus;
  /** Server id once uploaded. */
  id?: string;
  kind?: string;
  private?: boolean;
  error?: string;
}
export interface AttachState { items: AttachItem[] }
export type AttachAction =
  | { type: 'add'; uris: string[] }
  | { type: 'uploaded'; localUri: string; id: string; kind: string; private: boolean }
  | { type: 'failed'; localUri: string; error?: string }
  | { type: 'retry'; localUri: string }
  | { type: 'remove'; localUri: string }
  | { type: 'clear' };

export const EMPTY_ATTACH: AttachState = { items: [] };

/** Pure: up to four photos; failures keep the local file; retry re-enters uploading. */
export function attachReducer(s: AttachState, a: AttachAction): AttachState {
  switch (a.type) {
    case 'add': {
      const room = Math.max(0, MAX_ATTACH - s.items.length);
      const fresh = a.uris.filter((u) => !s.items.some((i) => i.localUri === u)).slice(0, room).map((localUri): AttachItem => ({ localUri, status: 'uploading' }));
      return { items: [...s.items, ...fresh] };
    }
    case 'uploaded': return { items: s.items.map((i) => (i.localUri === a.localUri ? { ...i, status: 'ready', id: a.id, kind: a.kind, private: a.private, error: undefined } : i)) };
    case 'failed': return { items: s.items.map((i) => (i.localUri === a.localUri ? { ...i, status: 'failed', error: a.error ?? 'Didn’t send' } : i)) };
    case 'retry': return { items: s.items.map((i) => (i.localUri === a.localUri ? { ...i, status: 'uploading', error: undefined } : i)) };
    case 'remove': return { items: s.items.filter((i) => i.localUri !== a.localUri) };
    case 'clear': return EMPTY_ATTACH;
  }
}
/** Ids ready to send. A message may go while one upload is still failed — the failed one stays in the tray. */
export const readyPhotoIds = (s: AttachState): string[] => s.items.filter((i) => i.status === 'ready' && i.id).map((i) => i.id!);
export const attachBusy = (s: AttachState): boolean => s.items.some((i) => i.status === 'uploading');
/** The composer's placeholder while photos are attached. */
export function attachPlaceholder(s: AttachState): string | null {
  if (!s.items.length) return null;
  const kinds = s.items.map((i) => i.kind).filter(Boolean);
  if (kinds.every((k) => k === 'meal') && kinds.length) return 'Send me lunch and I’ll log it.';
  if (kinds.includes('program')) return 'Screenshot a program → I’ll import it';
  return 'Say what you want to know about it';
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
