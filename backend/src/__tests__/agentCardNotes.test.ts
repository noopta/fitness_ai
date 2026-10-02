// Card notes: the model is told what is on screen without ever being shown
// (or allowed to send) a "[card …]" line. Pure functions — no mocks needed.

import { describe, it, expect } from 'vitest';
import { CardNoteFilter, stripCardNotes, splitStored, appNote, cardRef } from '../agent/cardNotes.js';

const ID = 'aa481a9e-0b5b-4f89-ae99-5751dc1522b4';
const NOTE = `[card SCH-04 glance id=${ID}: Today · Session · 62 min]`;

/** Feed text to the filter in chunks of `n` characters, as a token stream would. */
function streamed(text: string, n: number): string {
  const f = new CardNoteFilter();
  let out = '';
  for (let i = 0; i < text.length; i += n) out += f.push(text.slice(i, i + n));
  return out + f.flush();
}

describe('CardNoteFilter', () => {
  it('drops a note however the stream splits it', () => {
    const text = `Just follow the loads on the card.\n${NOTE}`;
    for (const n of [1, 2, 3, 5, 7, 13, 50, 500]) {
      expect(streamed(text, n).trim()).toBe('Just follow the loads on the card.');
    }
  });

  it('drops several notes and a made-up id', () => {
    const text = `Put it up.\n[card WK-04 proposal id=pending: Move it]\n${NOTE} Tap Apply.`;
    for (const n of [1, 4, 9]) expect(streamed(text, n).replace(/\s+/g, ' ').trim()).toBe('Put it up. Tap Apply.');
  });

  it('passes ordinary brackets through untouched', () => {
    for (const text of ['Sets [1] and [2] were heavy.', 'RPE [7-8], see [cardio] notes', 'a [c', 'ends with [car', '[cards] are fine']) {
      for (const n of [1, 3, 100]) expect(streamed(text, n)).toBe(text);
    }
  });

  it('does not hold text back once it cannot be a note', () => {
    const f = new CardNoteFilter();
    expect(f.push('Bench [')).toBe('Bench ');
    expect(f.push('2x')).toBe('[2x');
  });

  it('drops a note the reply ended in the middle of', () => {
    expect(streamed('Done.\n[card SCH-04 glance id=', 4).trim()).toBe('Done.');
  });
});

describe('stripCardNotes', () => {
  it('removes notes and an echoed app note, keeps the prose', () => {
    expect(stripCardNotes(`Follow the card.\n${NOTE}`)).toBe('Follow the card.');
    expect(stripCardNotes(`<app_note>\nThe app showed…\n</app_note>\n\nFollow the card.`)).toBe('Follow the card.');
    expect(stripCardNotes('Sets [1] and [2].')).toBe('Sets [1] and [2].');
  });
});

describe('splitStored', () => {
  it('uses stored cards and ignores ids that are not card ids', () => {
    const r = splitStored({ text: `Hi.\n[card WK-04 proposal id=pending: x]\n${NOTE}`, cards: [{ id: 'c1', fn: 'NTP-01', pattern: 'glance', what: 'Daily targets' }] });
    expect(r.text).toBe('Hi.');
    expect(r.cards.map((c) => c.id)).toEqual(['c1', ID]);
  });

  it('does not list a card twice', () => {
    const r = splitStored({ text: `Hi.\n${NOTE}\n${NOTE}` });
    expect(r.cards).toHaveLength(1);
  });
});

describe('appNote', () => {
  it('describes cards without ids, codes or bracket tags', () => {
    const note = appNote([{ id: ID, fn: 'SCH-04', pattern: 'glance', what: 'Today · Session · 62 min' }]);
    expect(note).toContain('- glance: Today · Session · 62 min');
    expect(note).not.toContain(ID);
    expect(note).not.toContain('SCH-04');
    expect(note).not.toContain('[card');
    expect(appNote([])).toBe('');
  });
});

describe('cardRef', () => {
  it('summarises a change, a diff, or falls back to the label', () => {
    expect(cardRef({ id: '1', fn: 'F', pattern: 'receipt', change: { key: 'Bench', from: '185', to: '190' } } as any).what).toBe('Bench: 185 → 190');
    expect(cardRef({ id: '2', fn: 'F', pattern: 'proposal', diff: [{ key: 'Calories', from: '2992', to: '2500' }] } as any).what).toBe('Calories: 2992 → 2500');
    expect(cardRef({ id: '3', fn: 'F', pattern: 'glance', meta: { label: 'Today' } } as any).what).toBe('Today');
  });
});
