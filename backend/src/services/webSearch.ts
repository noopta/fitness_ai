// Web search for the coach: a question goes to Gemini with Google Search
// grounding, and comes back as a short evidence-focused answer plus the pages
// it actually read. Same engine as the branded-food lookup (on GCP credits).
//
// The answer is only as good as its sources, so:
//   - no cited pages → no answer (the model must have searched),
//   - grounding redirects are resolved to the real page (they expire),
//   - social media / forum-only answers are dropped,
//   - sources are returned for the user to open, never hidden.
//
// Model: gemini-3-flash-preview at LOW thinking. Benchmarked 11 Oct 2026
// against gemini-3.8-flash on verified lookups: same accuracy, ~3× faster
// (median 5.1 s vs 16.6 s). WEB_SEARCH_MODEL overrides.

import { GoogleGenAI } from '@google/genai';
import { resolveSources, sourceLabel, domainOf, type WebSource } from './food/brandedLookup.js';
import { claimsFrom, decodeEntities, isMarketingPage, pageTitleFrom, preferTrusted, supportedChunks } from './research/relevance.js';

const MODEL = process.env.WEB_SEARCH_MODEL || 'gemini-3-flash-preview';
const THINKING = process.env.WEB_SEARCH_THINKING_LEVEL || 'LOW';
const TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS) || 25_000;
const WEAK = /\b(facebook|instagram|tiktok|reddit|youtube|pinterest|twitter|x\.com|threads|quora|scribd)\b/i;
// Research and public bodies first when listing sources.
const TRUSTED = /(\.gov\b|\.gc\.ca|\.edu\b|nih\.gov|pubmed|ncbi|who\.int|cochrane|nature\.com|sciencedirect|springer|wiley|bmj\.com|thelancet|jamanetwork|nejm|frontiersin|mdpi|plos|tandfonline|sagepub|journals\.|acsm|nsca|issn|jissn|eatright|dietitians\.ca|mayoclinic|clevelandclinic|hopkinsmedicine|harvard)/i;
const tier = (s: { url: string | null; site: string | null; title: string }) => (TRUSTED.test(`${s.url ?? ''} ${s.site ?? ''} ${s.title}`) ? 0 : 1);

export interface WebAnswer {
  kind: 'answered' | 'no_sources' | 'unavailable';
  answer: string;
  sources: Array<{ title: string; url: string | null; site: string | null }>;
  /** Which numbered source (1-based, in `sources`) backs which sentence of the answer. */
  claims?: { claim: string; sources: number[] }[];
  ms: number;
}

type Generate = (args: { model: string; contents: string; config: any }) => Promise<any>;
let client: GoogleGenAI | null = null;
const defaultGenerate = (): Generate => {
  client ??= new GoogleGenAI({ vertexai: true, project: process.env.GCP_PROJECT_NUMBER ?? '656267185967', location: process.env.GCP_LOCATION ?? 'global' });
  return (args) => client!.models.generateContent(args);
};

export function buildSearchPrompt(question: string, context?: string | null): string {
  return `Use Google Search to answer this for a strength & nutrition coach talking to their client.
Question: ${question}
${context ? `Context about the client (for relevance only — do not repeat it): ${context}\n` : ''}
Rules:
- Search for the research itself: include terms like "systematic review", "meta-analysis", "randomized trial" or "PubMed" in your searches, and look for clinical guidelines and government/medical bodies.
- Base the answer on those. Don't rely on blogs, clinics' marketing pages or anyone selling the supplement or product in question.
- Lead with the bottom line, then the key numbers (doses, timing, effect sizes) the sources support.
- Say plainly where evidence is weak, mixed or only in animals, and anything safety-relevant (interactions, who should check with a doctor).
- 120–200 words. No markdown headings.`;
}

/** The pages the answer's sentences lean on (grounding supports), not every page the model opened — with each one's chunk index. */
function sourcesOf(response: any): { sources: WebSource[]; chunkIdx: number[] } {
  const meta = response?.candidates?.[0]?.groundingMetadata;
  const all: any[] = meta?.groundingChunks ?? [];
  const indexed = supportedChunks(all.map((c, i) => ({ c, i })), meta?.groundingSupports)
    .filter(({ c }) => c?.web && typeof c.web.uri === 'string');
  return {
    sources: indexed.map(({ c }) => ({ title: typeof c.web.title === 'string' ? c.web.title : null, uri: c.web.uri })),
    chunkIdx: indexed.map(({ i }) => i),
  };
}

const TITLE_MS = 2500;
const TITLE_BYTES = 96_000;
/** A title that is only a domain ("nih.gov") tells the user nothing; read the page's own. Falls back to null. */
export async function fetchPageTitle(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TITLE_MS);
  try {
    const r = await fetchImpl(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; AxiomResearch/1.0)', accept: 'text/html' } });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') ?? 'text/html')) return null;
    const reader = r.body?.getReader?.();
    if (!reader) return pageTitleFrom((await r.text()).slice(0, TITLE_BYTES));
    let html = '';
    const dec = new TextDecoder();
    while (html.length < TITLE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return pageTitleFrom(html);
  } catch { return null; } finally { clearTimeout(t); }
}
const domainOnly = (t: string | null | undefined) => !t || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t.trim());

export async function searchWeb(question: string, opts: { context?: string | null; generate?: Generate; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<WebAnswer> {
  const t0 = Date.now();
  let response: any;
  try {
    response = await Promise.race([
      (opts.generate ?? defaultGenerate())({
        model: MODEL,
        contents: buildSearchPrompt(question, opts.context),
        config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: THINKING } },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), opts.timeoutMs ?? TIMEOUT_MS)),
    ]);
  } catch {
    return { kind: 'unavailable', answer: '', sources: [], ms: Date.now() - t0 };
  }
  const answer = String(response?.text ?? '').trim();
  const { sources: raw, chunkIdx } = sourcesOf(response);
  if (!answer || !raw.length) return { kind: 'no_sources', answer: '', sources: [], ms: Date.now() - t0 };
  const resolved = await resolveSources(raw.slice(0, 6), opts.fetchImpl);
  const urlOfChunk = new Map<number, string | null>(resolved.map((s, k) => [chunkIdx[k], s.uri && domainOf(s.uri) ? s.uri : null]));
  const titled = await Promise.all(resolved.map(async (s) => (domainOnly(s.title) && s.uri && domainOf(s.uri)
    ? { ...s, pageTitle: await fetchPageTitle(s.uri, opts.fetchImpl) }
    : { ...s, pageTitle: null as string | null })));
  const seen = new Set<string>();
  const sources = titled
    .map((s) => ({ title: decodeEntities(s.pageTitle ?? s.title ?? sourceLabel(s) ?? 'Source'), url: s.uri && domainOf(s.uri) ? s.uri : null, site: sourceLabel(s) }))
    .filter((s) => !WEAK.test(`${s.title} ${s.site ?? ''}`))
    // Store pages aren't evidence. With only those, it's "no reliable sources".
    .filter((s) => !isMarketingPage(s.url))
    .filter((s) => { const k = (s.url ?? s.title).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!sources.length) return { kind: 'no_sources', answer: '', sources: [], ms: Date.now() - t0 };
  sources.sort((a, b) => tier(a) - tier(b));
  const shown = preferTrusted(sources, (s) => tier(s) === 0).slice(0, 5);
  const claims = claimsFrom(response?.candidates?.[0]?.groundingMetadata?.groundingSupports, urlOfChunk, shown.map((s) => s.url));
  return { kind: 'answered', answer, sources: shown, ...(claims.length ? { claims } : {}), ms: Date.now() - t0 };
}
