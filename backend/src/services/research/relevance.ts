// What counts as a relevant research source (Nov 2026). Before this, the library
// tool showed whatever came back: textbook passages that barely matched, a fat-loss
// podcast for a tendon question, and research-feed items that shared one word with
// the query ("after", "recovery"), most of them ClinicalTrials.gov registrations of
// studies that have no results yet. Every rule here was checked against real
// questions (scratchpad rag_probe.mjs); all of it is pure.

/** Textbook passages (text-embedding-3-small) below this were only loosely related. */
export const BOOK_MIN = 0.52;
/** Podcast passages (Vertex embeddings) below this were off topic: 0.604 matched a fat-loss episode to a micronutrient question. */
export const POD_MIN = 0.66;

const STOP = new Set([
  'about', 'after', 'again', 'also', 'before', 'being', 'best', 'between', 'does', 'doing', 'during', 'each', 'early', 'effect', 'effects',
  'from', 'have', 'help', 'into', 'just', 'latest', 'like', 'make', 'many', 'more', 'most', 'much', 'need', 'over', 'should', 'some',
  'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'while', 'with', 'work',
  'works', 'would', 'your', 'research', 'study', 'studies', 'evidence', 'current', 'protocol', 'protocols', 'recovery', 'training', 'versus',
]);

/** The words in a question that carry its subject. */
export function contentWords(q: string): string[] {
  const words = String(q ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  return [...new Set(words)];
}

/** A registration of a study (planned, recruiting, or done with no results posted) is not evidence. */
export const isTrialRegistration = (source: string | null | undefined) => /clinicaltrials\.gov/i.test(String(source ?? ''));

/**
 * A feed item is relevant only when it names at least two of the question's subject
 * words in its title, or every one when the question has fewer than two.
 */
export function feedItemRelevant(item: { title: string; source?: string | null }, question: string): boolean {
  if (isTrialRegistration(item.source)) return false;
  const words = contentWords(question);
  if (!words.length) return false;
  const title = item.title.toLowerCase();
  const hits = words.filter((w) => title.includes(w)).length;
  return hits >= Math.min(2, words.length);
}

/** "NCSF — Anaerobic Resistance Training", or "NASM textbook" when the chapter heading is a fragment. */
export function libraryTitle(source: string | null | undefined, chapter: string | null | undefined): string {
  const raw = String(source ?? '').replace(/_/g, ' ').trim() || 'Library';
  const science = /^NUTRITION SCIENCE$/i.test(raw);
  const name = science ? 'Nutrition science' : raw;
  const label = science ? 'Nutrition science notes' : `${name} textbook`;
  const ch = String(chapter ?? '').replace(/\s+/g, ' ').trim();
  // A real heading is a chapter/section label or Title Case ("Understanding Nutrition"); chunk
  // headings are often a sentence's first line ("One advantage to this method is…") or an exercise name.
  const labelled = /^(chapter|section|part|unit|module)\b/i.test(ch);
  const titleCase = ch.split(' ').filter((w) => w.length > 3).every((w) => /^[A-Z0-9]/.test(w));
  const fragment = !ch || ch.split(' ').length < 2 || ch.length > 70 || /[:,;]$/.test(ch) || !(labelled || (titleCase && ch.split(' ').length <= 7));
  return fragment ? label : `${name} — ${ch}`;
}

export interface WebSourceIn { title: string | null; uri: string }

/**
 * The grounding chunks the answer actually leans on. Gemini returns every page it
 * opened as a chunk; only the ones a grounding support points at back a sentence.
 * With no supports in the response, every chunk is kept.
 */
export function supportedChunks<T>(chunks: T[], supports: unknown): T[] {
  const list = Array.isArray(supports) ? supports : [];
  const used = new Set<number>();
  for (const s of list) for (const i of (s as any)?.groundingChunkIndices ?? []) if (Number.isInteger(i)) used.add(i);
  if (!used.size) return chunks;
  return chunks.filter((_, i) => used.has(i));
}

/**
 * Which source backs which sentence: Gemini's grounding supports point a
 * segment of the answer at chunk indices; `urlOfChunk` maps a chunk index to
 * its resolved URL, `finalUrls` is the list shown to the user. Sources are
 * numbered from 1 in that list. Claims no shown source backs are dropped.
 */
export function claimsFrom(supports: unknown, urlOfChunk: Map<number, string | null>, finalUrls: (string | null)[], max = 8): { claim: string; sources: number[] }[] {
  const out: { claim: string; sources: number[] }[] = [];
  for (const s of Array.isArray(supports) ? supports : []) {
    const text = String((s as any)?.segment?.text ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 12) continue;
    const nums = [...new Set(((s as any)?.groundingChunkIndices ?? [])
      .map((i: number) => urlOfChunk.get(i))
      .map((u: string | null | undefined) => (u ? finalUrls.indexOf(u) : -1))
      .filter((n: number) => n >= 0)
      .map((n: number) => n + 1))] as number[];
    if (nums.length) out.push({ claim: text.slice(0, 220), sources: nums.sort((a, b) => a - b) });
    if (out.length >= max) break;
  }
  return out;
}

/** "Doctor&#x27;s Note" → "Doctor's Note". */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/**
 * A store's page, not evidence: Shopify blogs (/blogs/<blog>/<post>), product
 * and collection pages, and shop or supplement-brand hosts. (Nov 2026: a
 * vitamin C question came back sourced to one supplement brand's blog.)
 */
export function isMarketingPage(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (/(\.gov|\.edu|nih|who\.int|\.ac\.)/i.test(u.hostname)) return false;
  if (/\/(blogs\/[^/]+\/|products?\/|collections\/|shop\/|store\/)/i.test(u.pathname)) return true;
  return /(shop|store|supplement|vitamins?\b|nutrition(?:store|shop)|labs?\.com$)/i.test(u.hostname.replace(/^www\./, ''));
}

/** The page's own title from the first part of its HTML: citation_title, og:title, then <title>. */
export function pageTitleFrom(html: string): string | null {
  const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1];
  const raw = meta('citation_title') ?? meta('og:title') ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  if (!raw) return null;
  const t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (t.length < 8 || /^(just a moment|access denied|attention required|error|403|404|page not found)/i.test(t)) return null;
  return t.slice(0, 160);
}

/**
 * Research and public bodies first. When at least two trusted sources back the
 * answer, the rest (clinic blogs, supplement shops) are dropped.
 */
export function preferTrusted<T>(sources: T[], trusted: (s: T) => boolean): T[] {
  const good = sources.filter(trusted);
  return good.length >= 2 ? good : [...good, ...sources.filter((s) => !trusted(s))];
}
