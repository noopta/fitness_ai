import { describe, it, expect } from 'vitest';
import { formatPodcastContext, type PodcastReference } from '../services/podcast/podcastRagService.js';

const ref = (over: Partial<PodcastReference> = {}): PodcastReference => ({
  speaker: 'Layne Norton',
  guestName: 'Layne Norton',
  episodeTitle: 'The Science of Eating',
  chapterTitle: 'Artificial Sweeteners & Blood Sugar',
  youtubeUrl: 'https://youtu.be/K4Ze-Sp6aUE?t=410',
  startSeconds: 410,
  score: 0.81,
  content: 'Layne Norton: Artificial sweeteners do not meaningfully spike insulin for most people.',
  ...over,
});

describe('formatPodcastContext', () => {
  it('returns empty string when there are no references', () => {
    expect(formatPodcastContext([])).toBe('');
  });

  it('renders speaker + chapter attribution so the coach can cite by name', () => {
    const out = formatPodcastContext([ref()]);
    expect(out).toContain('Huberman Lab');
    expect(out).toContain('Layne Norton');
    expect(out).toContain('Artificial Sweeteners & Blood Sugar');
    expect(out).toContain('cite the speaker by name');
  });

  it('labels solo (no-guest) episodes as Huberman Lab only', () => {
    const out = formatPodcastContext([ref({ guestName: null })]);
    expect(out).toContain('Huberman Lab');
  });

  it('truncates very long chunk content', () => {
    const long = 'x'.repeat(5000);
    const out = formatPodcastContext([ref({ content: long })], 700);
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(2000);
  });
});
