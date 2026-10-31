// Proactive coach client helpers: the attach tray (E1/E2), labels (D1/F1/F2),
// receipts on history turns (A1), and photos riding on a sent turn.
import { describe, it, expect } from 'vitest';
import { attachReducer, EMPTY_ATTACH, readyPhotoIds, attachBusy, attachPlaceholder, MAX_ATTACH, daysOutLabel, FREQUENCY_ROWS, quietHoursLabel, groupPhotos, isPrivatePhoto, historyReceipts, threadReducer, emptyThread } from '../src';

describe('E1/E2 · attach tray', () => {
  it('adds up to four, uploads, fails keeping the file, retries, removes, clears', () => {
    let s = attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['a', 'b', 'c', 'd', 'e'] });
    expect(s.items).toHaveLength(MAX_ATTACH);
    expect(attachBusy(s)).toBe(true);
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'meal', private: false });
    s = attachReducer(s, { type: 'failed', localUri: 'b' });
    expect(s.items[1]).toMatchObject({ status: 'failed', error: 'Didn’t send', localUri: 'b' });
    expect(readyPhotoIds(s)).toEqual(['p1']);
    s = attachReducer(s, { type: 'retry', localUri: 'b' });
    expect(s.items[1].status).toBe('uploading');
    s = attachReducer(s, { type: 'remove', localUri: 'c' });
    s = attachReducer(s, { type: 'remove', localUri: 'd' });
    expect(s.items.map((i) => i.localUri)).toEqual(['a', 'b']);
    expect(attachReducer(s, { type: 'add', uris: ['a'] }).items).toHaveLength(2); // no duplicates
    expect(attachReducer(s, { type: 'clear' })).toEqual(EMPTY_ATTACH);
  });
  it('the placeholder follows what was attached', () => {
    expect(attachPlaceholder(EMPTY_ATTACH)).toBeNull();
    let s = attachReducer(EMPTY_ATTACH, { type: 'add', uris: ['a'] });
    expect(attachPlaceholder(s)).toBe('Say what you want to know about it');
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'meal', private: false });
    expect(attachPlaceholder(s)).toBe('Send me lunch and I’ll log it.');
    s = attachReducer(s, { type: 'uploaded', localUri: 'a', id: 'p1', kind: 'program', private: false });
    expect(attachPlaceholder(s)).toBe('Screenshot a program → I’ll import it');
  });
  it('a sent turn carries its photo ids', () => {
    const s = threadReducer(emptyThread(), { type: 'send', id: 'u1', agentId: 'a1', text: 'Lunch', photos: ['p1'] });
    expect(s.turns[0]).toMatchObject({ kind: 'user', text: 'Lunch', photos: ['p1'] });
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
