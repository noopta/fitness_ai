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

function sourcesOf(response: any): WebSource[] {
  const chunks: any[] = response?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return chunks.map((c) => c?.web).filter((w) => w && typeof w.uri === 'string').map((w) => ({ title: typeof w.title === 'string' ? w.title : null, uri: w.uri }));
}

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
  const raw = sourcesOf(response);
  if (!answer || !raw.length) return { kind: 'no_sources', answer: '', sources: [], ms: Date.now() - t0 };
  const resolved = await resolveSources(raw.slice(0, 6), opts.fetchImpl);
  const seen = new Set<string>();
  const sources = resolved
    .map((s) => ({ title: s.title ?? sourceLabel(s) ?? 'Source', url: s.uri && domainOf(s.uri) ? s.uri : null, site: sourceLabel(s) }))
    .filter((s) => !WEAK.test(`${s.title} ${s.site ?? ''}`))
    .filter((s) => { const k = (s.url ?? s.title).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!sources.length) return { kind: 'no_sources', answer: '', sources: [], ms: Date.now() - t0 };
  sources.sort((a, b) => tier(a) - tier(b));
  return { kind: 'answered', answer, sources: sources.slice(0, 5), ms: Date.now() - t0 };
}
