/**
 * PubMed Central adapter.
 *
 * PMC is the NIH's open-access subset of PubMed. Same NCBI E-utilities,
 * different `db` parameter (`pmc` vs `pubmed`). The win over plain PubMed:
 * PMC items reliably have a full-text body the user can read for free —
 * not just the abstract behind a publisher paywall. We still surface the
 * abstract for our own summariser; the URL points the user at the free
 * full-text landing page.
 */

import {
  type FeedTag,
  type FeedItemDraft,
  summarize,
  isFallbackRefusal,
  persistFeedItem,
  prisma,
} from './shared.js';

const PMC_QUERIES: Record<FeedTag, string> = {
  strength:    'resistance training strength gain[tiab] AND free fulltext[filter]',
  hypertrophy: 'muscle hypertrophy resistance training[tiab] AND free fulltext[filter]',
  fat_loss:    'fat loss body recomposition resistance training[tiab] AND free fulltext[filter]',
  nutrition:   'sports nutrition protein intake athletes[tiab] AND free fulltext[filter]',
  recovery:    'exercise recovery sleep muscle repair[tiab] AND free fulltext[filter]',
  cardio:      'cardiovascular fitness aerobic exercise health[tiab] AND free fulltext[filter]',
  lifestyle:   'physical activity health outcomes wellness[tiab] AND free fulltext[filter]',
  general:     'exercise training health benefits[tiab] AND free fulltext[filter]',
};

interface PmcSummary {
  uid: string;
  title: string;
  source: string;
  pubdate: string;
  articleids?: Array<{ idtype: string; value: string }>;
}

export async function fetchPubMedCentral(tag: FeedTag, maxResults = 3): Promise<void> {
  const query = encodeURIComponent(PMC_QUERIES[tag]);
  const searchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
    `?db=pmc&term=${query}&retmax=${maxResults * 3}&retmode=json` +
    `&sort=relevance&mindate=2022&datetype=pdat`;

  let searchRes: Response;
  try {
    searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return;
  }
  if (!searchRes.ok) return;
  const searchData = await searchRes.json() as { esearchresult?: { idlist?: string[] } };
  const ids = searchData.esearchresult?.idlist ?? [];
  if (ids.length === 0) return;

  const summaryUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
    `?db=pmc&id=${ids.join(',')}&retmode=json`;
  let summaryRes: Response;
  try {
    summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return;
  }
  if (!summaryRes.ok) return;
  const summaryData = await summaryRes.json() as { result?: Record<string, PmcSummary> };
  const result = summaryData.result ?? {};

  let kept = 0;
  for (const pmcId of ids) {
    if (kept >= maxResults) break;
    const item = result[pmcId];
    if (!item?.title) continue;

    const externalId = `pmc:${pmcId}`;
    const exists = await prisma.feedItem.findUnique({ where: { externalId } });
    if (exists) continue;

    // PMC delivers abstracts through the same efetch endpoint as PubMed.
    let abstract = '';
    try {
      const abstractRes = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcId}&rettype=abstract&retmode=text`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (abstractRes.ok) abstract = await abstractRes.text();
    } catch { /* skip */ }
    if (!abstract || abstract.trim().length < 100) continue;

    let summary = '';
    try {
      summary = await summarize(item.title, abstract, 'research');
    } catch {
      continue;
    }
    if (isFallbackRefusal(summary)) continue;

    let publishedAt: Date | null = null;
    if (item.pubdate) {
      const d = new Date(item.pubdate);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    const draft: FeedItemDraft = {
      externalId,
      type: 'research',
      title: item.title,
      summary,
      // PMC URLs are stable and always free; never paywall.
      url: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/`,
      source: 'PubMed Central',
      tags: [tag],
      publishedAt,
    };
    const created = await persistFeedItem(draft);
    if (created) kept++;
  }
}
