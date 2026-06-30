import { describe, it, expect } from 'vitest';
import { classifyChunkSections, buildProgramSources } from '../services/ragService.js';

// Minimal RetrievedChunk shape (ragService's internal type isn't exported).
const chunk = (over: Partial<{ id: string; source: string; chapter: string | null; content: string; score: number }> = {}) => ({
  id: over.id ?? 'k1',
  source: over.source ?? 'NASM Essentials',
  chapter: over.chapter ?? null,
  content: over.content ?? '',
  score: over.score ?? 0.9,
});

describe('classifyChunkSections', () => {
  it('tags periodization content', () => {
    expect(classifyChunkSections({ chapter: 'Periodization Models', content: 'mesocycle and macrocycle planning' }))
      .toContain('periodization');
  });

  it('tags nutrition content', () => {
    expect(classifyChunkSections({ chapter: null, content: 'daily protein intake and caloric balance' }))
      .toContain('nutrition');
  });

  it('tags volume/intensity content', () => {
    const s = classifyChunkSections({ chapter: 'Training Variables', content: 'optimal sets per muscle and RPE-based load' });
    expect(s).toContain('volume');
  });

  it('returns multiple sections when content spans themes', () => {
    const s = classifyChunkSections({
      chapter: 'Program Design',
      content: 'periodization phases drive exercise selection and training volume',
    });
    expect(s).toEqual(expect.arrayContaining(['periodization', 'exercise', 'volume']));
  });

  it('returns no sections for unrelated content (still belongs in bibliography)', () => {
    expect(classifyChunkSections({ chapter: 'History of Fitness', content: 'a brief overview of gyms in antiquity' }))
      .toEqual([]);
  });
});

describe('buildProgramSources', () => {
  it('assigns stable sequential ids in retrieval order', () => {
    const sources = buildProgramSources([
      chunk({ source: 'A', chapter: 'Ch1', content: 'periodization' }),
      chunk({ source: 'B', chapter: 'Ch2', content: 'protein' }),
    ]);
    expect(sources.map(s => s.id)).toEqual(['src-1', 'src-2']);
    expect(sources[0].source).toBe('A');
  });

  it('dedupes by source + chapter and merges their sections', () => {
    const sources = buildProgramSources([
      chunk({ source: 'A', chapter: 'Ch1', content: 'periodization phases' }),
      chunk({ source: 'A', chapter: 'Ch1', content: 'protein and calories' }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0].sections).toEqual(expect.arrayContaining(['periodization', 'nutrition']));
  });

  it('keeps distinct chapters of the same source separate', () => {
    const sources = buildProgramSources([
      chunk({ source: 'A', chapter: 'Ch1', content: 'periodization' }),
      chunk({ source: 'A', chapter: 'Ch2', content: 'nutrition' }),
    ]);
    expect(sources).toHaveLength(2);
  });

  it('truncates long snippets with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const [s] = buildProgramSources([chunk({ content: long })], 100);
    expect(s.snippet!.length).toBeLessThanOrEqual(101);
    expect(s.snippet!.endsWith('…')).toBe(true);
  });

  it('returns an empty list for no chunks (omit-don\'t-fake)', () => {
    expect(buildProgramSources([])).toEqual([]);
  });
});
