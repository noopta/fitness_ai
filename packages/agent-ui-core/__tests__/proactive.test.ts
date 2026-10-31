// Proactive coach client helpers (v4): the attach tray with intent and a set
// clip (E1/E1b/H1), labels (D1/F1/F2), receipts on history turns (A1), and
// photos/video riding on a sent turn.
import { describe, it, expect } from 'vitest';
import { attachReducer, EMPTY_ATTACH, readyPhotoIds, attachBusy, attachPlaceholder, attachRoom, sendReady, stagedCaption, stagedClip, clipLabel, clipTurnText, liftFromSession, watchingReceipts, MAX_ATTACH, daysOutLabel, FREQUENCY_ROWS, quietHoursLabel, groupPhotos, isPrivatePhoto, historyReceipts, threadReducer, emptyThread, clipRows, CLIP_MIN_S, CLIP_MAX_S } from '../src';

describe('E1/E2 · attach tray — photos', () => {
  it('adds up to four, uploads, fails keeping the file, retries, removes, clears', () => {
    let s = attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['a', 'b', 'c', 'd', 'e'] });
    expect(s.items).toHaveLength(MAX_ATTACH);
    expect(attachBusy(s)).toBe(true);
    expect(attachRoom(s)).toBe(0);
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'meal', private: false });
    s = attachReducer(s, { type: 'failed', localUri: 'b' });
    expect(s.items[1]).toMatchObject({ status: 'failed', error: 'Didn’t send', localUri: 'b' });
    expect(readyPhotoIds(s)).toEqual(['p1']);
    s = attachReducer(s, { type: 'retry', localUri: 'b' });
    expect(s.items[1].status).toBe('uploading');
    s = attachReducer(s, { type: 'remove', localUri: 'c' });
    s = attachReducer(s, { type: 'remove', localUri: 'd' });
    expect(s.items.map((i) => i.localUri)).toEqual(['a', 'b']);
    expect(attachRoom(s)).toBe(2);
    expect(attachReducer(s, { type: 'add', uris: ['a'] }).items).toHaveLength(2); // no duplicates
    expect(attachReducer(s, { type: 'clear' })).toEqual(EMPTY_ATTACH);
  });
  it('E1: Meal / Label / Program set the intent; it shows in the caption and clears with the last photo', () => {
    let s = attachReducer(EMPTY_ATTACH, { type: 'intent', intent: 'meal' });
    s = attachReducer(s, { type: 'add', uris: ['a', 'b'] });
    expect(stagedCaption(s)).toBe('2 photos · Meal · sent with your message');
    s = attachReducer(s, { type: 'remove', localUri: 'a' });
    expect(stagedCaption(s)).toBe('1 photo · Meal · sent with your message');
    s = attachReducer(s, { type: 'remove', localUri: 'b' });
    expect(s.intent).toBeNull();
    expect(stagedCaption(s)).toBeNull();
    expect(stagedCaption(attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['a'] }))).toBe('1 photo · sent with your message');
  });
  it('the placeholder follows the intent, or what the server read', () => {
    expect(attachPlaceholder(EMPTY_ATTACH)).toBeNull();
    let s = attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['a'] });
    expect(attachPlaceholder(s)).toBe('Say what you want to know about it');
    expect(attachPlaceholder(attachReducer(s, { type: 'intent', intent: 'label' }))).toBe('A label → I’ll check it against your targets');
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'meal', private: false });
    expect(attachPlaceholder(s)).toBe('Send me lunch and I’ll log it.');
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'program', private: false });
    expect(attachPlaceholder(s)).toBe('Screenshot a program → I’ll import it');
  });
  it('E1b: send is ready with text, or with anything staged and nothing still uploading', () => {
    expect(sendReady('', EMPTY_ATTACH)).toBe(false);
    expect(sendReady('hi', EMPTY_ATTACH)).toBe(true);
    let s = attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['a'] });
    expect(sendReady('', s)).toBe(false); // still uploading
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'meal', private: false });
    expect(sendReady('', s)).toBe(true);
    expect(sendReady('', s, true)).toBe(false); // Anakin busy
  });
  it('a sent turn carries its photo ids', () => {
    const s = threadReducer(emptyThread(), { type: 'send', id: 'u1', agentId: 'a1', text: 'Lunch', photos: ['p1'] });
    expect(s.turns[0]).toMatchObject({ kind: 'user', text: 'Lunch', photos: ['p1'] });
  });
});

describe('H1 · a set clip in the tray', () => {
  it('a clip stands alone, is ready at once, takes the lift pill, and leaves no room for photos', () => {
    let s = attachReducer(attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['p'] }), { type: 'add', uris: ['v.mp4'], media: 'video', durationSec: 24 });
    expect(s.items).toEqual([{ localUri: 'v.mp4', media: 'video', status: 'ready', durationSec: 24 }]);
    expect(stagedClip(s)?.localUri).toBe('v.mp4');
    expect(attachRoom(s)).toBe(0);
    expect(readyPhotoIds(s)).toEqual([]);
    expect(sendReady('', s)).toBe(true);
    expect(stagedCaption(s)).toBe('Form check · 0:24 · Squat');
    s = attachReducer(s, { type: 'lift', lift: 'Deadlift' });
    expect(stagedCaption(s)).toBe('Form check · 0:24 · Deadlift');
    expect(attachPlaceholder(s)).toBe('Deadlift · top set? Say the weight and reps');
    expect(attachReducer(s, { type: 'clear' }).lift).toBe('Deadlift'); // the pick survives a send
  });
  it('labels: clip length, the user turn\'s caption, the lift from today\'s session', () => {
    expect(clipLabel(24)).toBe('0:24');
    expect(clipLabel(95.4)).toBe('1:35');
    expect(clipLabel(null)).toBe('0:00');
    expect(clipTurnText('Squat', '225 × 5, top set')).toBe('Squat · 225 × 5, top set');
    expect(clipTurnText('Bench', '  ')).toBe('Bench set');
    expect(liftFromSession(['Face pull', 'Chest-supported row', 'Back Squat'])).toBe('Squat');
    expect(liftFromSession(['Incline Bench Press'])).toBe('Bench');
    expect(liftFromSession(['Curl'])).toBe('Squat');
  });
  it('H2: the watching turn\'s receipts, with the last check of that lift when there is one', () => {
    expect(watchingReceipts('Squat', 'Oct 12').map((r) => `${r.verb} — ${r.text}`)).toEqual(['Reading — Video · the set, side view', 'Computed — Depth, bar path and tempo per rep', 'Checked — Your squat check from Oct 12']);
    expect(watchingReceipts('Bench', null)).toHaveLength(2);
    const s = threadReducer(emptyThread(), { type: 'send', id: 'u1', agentId: 'a1', text: 'Squat · 225 × 5', video: { analysisId: 'fa1', lift: 'Squat', seconds: 24 } });
    expect(s.turns[0].video).toEqual({ analysisId: 'fa1', lift: 'Squat', seconds: 24 });
  });
});

describe('labels', () => {
  it('D1 countdown', () => {
    expect(daysOutLabel(23)).toBe('23 days out');
    expect(daysOutLabel(1)).toBe('Tomorrow');
    expect(daysOutLabel(0)).toBe('Today');
  });
  it('F1 rows and quiet hours', () => {
    expect(FREQUENCY_ROWS.map((r) => r.sub)).toEqual(['Up to 2 a week', 'Up to 1 a day', 'Up to 2 a day']);
    expect(quietHoursLabel(22, 7)).toBe('10 PM – 7 AM');
  });
  it('F2 groups: private · meals and labels · program screenshots', () => {
    const g = groupPhotos([{ id: 1, kind: 'injury' }, { id: 2, kind: 'meal' }, { id: 3, kind: 'label' }, { id: 4, kind: 'program' }, { id: 5, kind: 'machine' }]);
    expect(g.private.map((p) => p.id)).toEqual([1]);
    expect(g.meals.map((p) => p.id)).toEqual([2, 3]);
    expect(g.programs.map((p) => p.id)).toEqual([4]);
    expect(g.other.map((p) => p.id)).toEqual([5]);
    expect(isPrivatePhoto('body')).toBe(true);
  });
});

describe('A1 · receipts on a history turn', () => {
  it('maps verb and text with stable ids; an unknown verb reads as Checked', () => {
    expect(historyReceipts([{ verb: 'Checked', text: '6 hard sessions in 6 days' }, { verb: 'Guessed', text: 'x' }], 'h3')).toEqual([
      { id: 'h3r0', verb: 'Checked', text: '6 hard sessions in 6 days', final: true }, { id: 'h3r1', verb: 'Checked', text: 'x', final: true },
    ]);
    expect(historyReceipts(undefined, 'h1')).toEqual([]);
  });
});

describe('H1 · choosing a clip from the library', () => {
  const now = new Date('2026-10-31T07:00:00').getTime();
  it('newest first, within set length, labelled with day and length; landscape gets the side-view nudge', () => {
    const rows = clipRows([
      { id: 'a', duration: 24, creationTime: now - 3600_000, width: 1080, height: 1920 },
      { id: 'b', duration: 95, creationTime: now - 86_400_000 * 2, width: 1920, height: 1080 },
      { id: 'c', duration: 1.5, creationTime: now },
      { id: 'd', duration: 600, creationTime: now },
    ], now);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0].name).toMatch(/^Today \d{1,2}:\d{2} (AM|PM) · 0:24$/);
    expect(rows[0].sub).toBe('portrait');
    expect(rows[1].name).toBe('Oct 29 · 1:35');
    expect(rows[1].sub).toBe('landscape · turn the phone for a side view next time');
    expect(CLIP_MIN_S).toBe(3); expect(CLIP_MAX_S).toBe(180);
  });
  it('caps at eight', () => {
    expect(clipRows(Array.from({ length: 12 }, (_, i) => ({ id: String(i), duration: 20, creationTime: now - i * 1000 })), now)).toHaveLength(8);
  });
});
