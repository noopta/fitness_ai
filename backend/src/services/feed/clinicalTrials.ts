/**
 * ClinicalTrials.gov v2 API adapter.
 *
 * Surfaces actively-recruiting and recently-completed studies relevant to
 * each fitness tag. Free, no auth.
 *
 *   API:   https://clinicaltrials.gov/api/v2/studies
 *   URL:   https://clinicaltrials.gov/study/{NCT_ID}
 *
 * Why include trials: peer-reviewed papers lag the trial by 1-3 years. Pulling
 * trials lets curious users see what's *being measured right now* — useful
 * complement to PubMed/OpenAlex which only reflect published work.
 */

import {
  type FeedTag,
  type FeedItemDraft,
  summarize,
  isFallbackRefusal,
  persistFeedItem,
} from './shared.js';

const TRIAL_QUERIES: Record<FeedTag, string> = {
  strength:    'resistance training AND strength',
  hypertrophy: 'resistance training AND muscle',
  fat_loss:    'weight loss AND exercise',
  nutrition:   'protein supplementation AND athletes',
  recovery:    'sleep AND exercise recovery',
  cardio:      'aerobic exercise AND cardiovascular',
  lifestyle:   'physical activity AND health',
  general:     'exercise AND health outcomes',
};

interface CtgStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    descriptionModule?: { briefSummary?: string };
    statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
  };
}

export async function fetchClinicalTrials(tag: FeedTag, maxResults = 4): Promise<void> {
  const query = encodeURIComponent(TRIAL_QUERIES[tag]);
  const url =
    `https://clinicaltrials.gov/api/v2/studies?query.term=${query}` +
    `&filter.overallStatus=RECRUITING,COMPLETED` +
    `&pageSize=${maxResults * 3}` +
    `&sort=LastUpdatePostDate:desc`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return;
  }
  if (!res.ok) return;
  const data = await res.json() as { studies?: CtgStudy[] };
  const studies = data.studies ?? [];

  let kept = 0;
  for (const study of studies) {
    if (kept >= maxResults) break;
    const draft = await draftFromStudy(study, tag);
    if (!draft) continue;
    const created = await persistFeedItem(draft);
    if (created) kept++;
  }
}

async function draftFromStudy(study: CtgStudy, tag: FeedTag): Promise<FeedItemDraft | null> {
  const id = study.protocolSection?.identificationModule?.nctId;
  const title =
    (study.protocolSection?.identificationModule?.briefTitle ??
     study.protocolSection?.identificationModule?.officialTitle ?? '').trim();
  const briefSummary = (study.protocolSection?.descriptionModule?.briefSummary ?? '').trim();
  if (!id || !title || briefSummary.length < 100) return null;

  let summary: string;
  try {
    summary = await summarize(title, briefSummary, 'research');
  } catch {
    return null;
  }
  if (isFallbackRefusal(summary)) return null;

  let publishedAt: Date | null = null;
  const startStr = study.protocolSection?.statusModule?.startDateStruct?.date;
  if (startStr) {
    const d = new Date(startStr);
    if (!isNaN(d.getTime())) publishedAt = d;
  }

  const status = study.protocolSection?.statusModule?.overallStatus;
  const statusLabel = status === 'RECRUITING' ? 'Recruiting' : status === 'COMPLETED' ? 'Completed' : null;

  return {
    externalId: `ctg:${id}`,
    type: 'research',
    title,
    summary,
    url: `https://clinicaltrials.gov/study/${id}`,
    source: statusLabel ? `ClinicalTrials.gov (${statusLabel})` : 'ClinicalTrials.gov',
    tags: [tag],
    publishedAt,
  };
}
