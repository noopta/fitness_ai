import { describe, it, expect } from 'vitest';
import { chunkEpisode, isSponsorChapter } from '../services/podcast/podcastChunker.js';
import type { ParsedEpisode } from '../services/podcast/hubermanScraper.js';

describe('isSponsorChapter', () => {
  it('flags ad-read chapters made of sponsor brands', () => {
    expect(isSponsorChapter('LMNT, ROKA, InsideTracker, Momentous')).toBe(true);
    expect(isSponsorChapter('Sponsors: AG1 & Eight Sleep')).toBe(true);
    expect(isSponsorChapter('AG1')).toBe(true);
  });

  it('does not flag real topic chapters', () => {
    expect(isSponsorChapter('Calories & Cellular Energy Production')).toBe(false);
    expect(isSponsorChapter('Artificial Sweeteners & Blood Sugar')).toBe(false);
    expect(isSponsorChapter('Protein Intake & Muscle Growth')).toBe(false);
  });
});

function makeEpisode(overrides: Partial<ParsedEpisode> = {}): ParsedEpisode {
  // 0–100s = sponsor chapter, 100s+ = real topic. Build turns long enough to
  // cross the chunk boundary so we get multiple chunks.
  const turns = [];
  for (let i = 0; i < 40; i++) {
    turns.push({ speaker: i % 2 === 0 ? 'Andrew Huberman' : 'Layne Norton', text: `Sentence number ${i} about protein and training, repeated for length. `.repeat(4) });
  }
  return {
    slug: 'test-ep',
    url: 'http://x',
    title: 'Test Episode',
    youtubeId: 'ABC123',
    guestName: 'Layne Norton',
    guestCredentials: null,
    chapters: [
      { startSeconds: 0, title: 'AG1' }, // sponsor
      { startSeconds: 100, title: 'Protein & Muscle Growth' },
    ],
    transcript: turns,
    durationSeconds: 1000,
    ...overrides,
  };
}

describe('chunkEpisode', () => {
  const chunks = chunkEpisode(makeEpisode(), { subtopic: 'Nutrition' });

  it('produces multiple chunks carrying episode + subtopic metadata', () => {
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.subtopic === 'Nutrition')).toBe(true);
    expect(chunks.every((c) => c.episodeSlug === 'test-ep')).toBe(true);
    expect(chunks.every((c) => c.youtubeId === 'ABC123')).toBe(true);
  });

  it('keeps the speaker prefix inline and assigns a dominant speaker', () => {
    expect(chunks[0].content).toMatch(/^(Andrew Huberman|Layne Norton):/m);
    expect(chunks.every((c) => c.speaker === 'Andrew Huberman' || c.speaker === 'Layne Norton')).toBe(true);
  });

  it('builds an attributive context header with guest + subtopic', () => {
    expect(chunks[0].contextHeader).toContain('Layne Norton');
    expect(chunks[0].contextHeader).toContain('Huberman Lab');
  });

  it('drops chunks that fall in sponsor chapters', () => {
    expect(chunks.every((c) => c.chapterTitle !== 'AG1')).toBe(true);
  });

  it('assigns approximate timestamps within episode duration', () => {
    for (const c of chunks) {
      expect(c.startSeconds).not.toBeNull();
      expect(c.startSeconds!).toBeGreaterThanOrEqual(0);
      expect(c.startSeconds!).toBeLessThanOrEqual(1000);
    }
  });
});
