import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseSubtopicEpisodes,
  parseEpisode,
  isEssentials,
} from '../services/podcast/hubermanScraper.js';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parseSubtopicEpisodes', () => {
  it('extracts exactly the 11 subtopic episodes (not recommended/sidebar links)', () => {
    const eps = parseSubtopicEpisodes(fx('huberman-subtopic-sample.html'));
    expect(eps).toHaveLength(11);
    expect(eps.every((e) => e.url.startsWith('https://www.hubermanlab.com/episode/'))).toBe(true);
    expect(eps.map((e) => e.slug)).toContain('dr-rhonda-patrick-micronutrients-for-health-and-longevity');
    // recommended links from other subtopics must NOT be included
    expect(eps.map((e) => e.slug)).not.toContain('goals-toolkit-how-to-set-achieve-your-goals');
  });

  it('throws (fails loud) when no episode cards are found', () => {
    expect(() => parseSubtopicEpisodes('<html><body>nothing</body></html>')).toThrow();
  });
});

describe('parseEpisode — transcript formats', () => {
  it('parses format A (inline "SPEAKER: text" + continuation paragraphs)', () => {
    const ep = parseEpisode(fx('huberman-episode-sample.html'), 'layne-the-science', 'http://x');
    expect(ep.guestName).toBe('Layne Norton');
    expect(ep.youtubeId).toBe('K4Ze-Sp6aUE');
    expect(ep.transcript.length).toBeGreaterThan(400);
    expect([...new Set(ep.transcript.map((t) => t.speaker))].sort()).toEqual([
      'Andrew Huberman',
      'Layne Norton',
    ]);
    expect(ep.chapters.length).toBeGreaterThan(10);
  });

  it('parses format B (<strong>Name</strong> text)', () => {
    const ep = parseEpisode(fx('huberman-episode-formatB.html'), 'alan-aragon', 'http://x');
    expect(ep.guestName).toBe('Alan Aragon');
    expect(ep.transcript.length).toBeGreaterThan(400);
    expect(ep.transcript.some((t) => t.speaker === 'Alan Aragon')).toBe(true);
  });

  it('parses format C (label-only <p> then body <p>s)', () => {
    const ep = parseEpisode(fx('huberman-episode-formatC.html'), 'rhonda-patrick', 'http://x');
    expect(ep.guestName).toBe('Rhonda Patrick');
    expect(ep.transcript.length).toBeGreaterThan(400);
  });

  it('returns an empty transcript for Premium-gated episodes (no throw)', () => {
    const ep = parseEpisode(fx('huberman-episode-gated.html'), 'andy-galpin', 'http://x');
    expect(ep.transcript).toHaveLength(0);
  });

  it('derives the guest from the non-host speaker, not the title', () => {
    const ep = parseEpisode(fx('huberman-episode-sample.html'), 'x', 'http://x');
    expect(ep.guestName).not.toBe('Andrew Huberman');
  });
});

describe('isEssentials', () => {
  it('flags Essentials by slug or title', () => {
    expect(isEssentials('essentials-the-science-of-eating', '')).toBe(true);
    expect(isEssentials('x', 'Essentials: The Science of Eating')).toBe(true);
    expect(isEssentials('dr-layne-norton-the-science', 'Dr. Layne Norton')).toBe(false);
  });
});
