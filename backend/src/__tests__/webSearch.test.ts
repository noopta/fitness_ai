// Coach web search: an answer only with real, non-social sources, links
// resolved to the actual page.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));

import { searchWeb, buildSearchPrompt } from '../services/webSearch.js';

const chunk = (title: string, uri: string) => ({ web: { title, uri } });
const resp = (text: string, chunks: unknown[]) => ({ text, candidates: [{ groundingMetadata: { groundingChunks: chunks } }] });
const redirect = (to: string) => ({ headers: { get: () => to } });

describe('searchWeb', () => {
  it('returns the answer with sources resolved to real pages', async () => {
    const generate = vi.fn().mockResolvedValue(resp('Bottom line: 15 g collagen with 50 mg vitamin C an hour before loading raised collagen synthesis in one small study.', [
      chunk('pubmed.ncbi.nlm.nih.gov', 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/a'),
      chunk('reddit.com', 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/b'),
    ]));
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect('https://pubmed.ncbi.nlm.nih.gov/27852613/')).mockResolvedValueOnce(redirect('https://www.reddit.com/r/x'));
    const r = await searchWeb('collagen before rehab', { generate, fetchImpl: fetchImpl as any });
    expect(r.kind).toBe('answered');
    expect(r.sources).toEqual([{ title: 'pubmed.ncbi.nlm.nih.gov', url: 'https://pubmed.ncbi.nlm.nih.gov/27852613/', site: 'pubmed.ncbi.nlm.nih.gov' }]);
    expect(generate.mock.calls[0][0].config.tools).toEqual([{ googleSearch: {} }]);
  });

  it('refuses an answer with no sources, or only social ones', async () => {
    expect((await searchWeb('q', { generate: vi.fn().mockResolvedValue(resp('From memory…', [])) })).kind).toBe('no_sources');
    const social = vi.fn().mockResolvedValue(resp('…', [chunk('youtube.com', 'https://www.youtube.com/watch?v=1')]));
    expect((await searchWeb('q', { generate: social })).kind).toBe('no_sources');
  });

  it('gives up at the time limit', async () => {
    const r = await searchWeb('q', { generate: vi.fn(() => new Promise(() => {})), timeoutMs: 20 });
    expect(r.kind).toBe('unavailable');
  });

  it('asks for evidence-first answers and keeps client context out of the reply', () => {
    const p = buildSearchPrompt('creatine for tendon healing?', 'post-op Achilles, 93 kg');
    expect(p).toMatch(/systematic review/);
    expect(p).toMatch(/do not repeat it/);
  });
});
