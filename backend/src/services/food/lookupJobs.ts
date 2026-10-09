// Lookup jobs for the describe screens. Parsing answers in a few seconds with
// an estimate; resolving branded items can take up to ~30 s when the web is
// needed. So parse-meal (with defer) returns the estimate plus a job id at
// once, the job resolves in the background, and the app polls it — showing
// each check as it happens and holding the Log button until it's done.
//
// In memory: a job lives for 10 minutes and belongs to one user.

import { randomUUID } from 'node:crypto';
import type { ParsedMealDetail } from '../llmService.js';
import type { ResolveEvent, ResolvedItem, ResolveCtx } from './foodResolver.js';
import type { BrandedItem } from './brandedLookup.js';

export interface JobStep { id: string; verb: 'Reading' | 'Searched' | 'Checked'; text: string }

export interface LookupJob {
  id: string;
  userId: string;
  createdAt: number;
  done: boolean;
  steps: JobStep[];
  /** The meal with looked-up values folded in, once done. */
  result: ParsedMealDetail | null;
}

const TTL_MS = 10 * 60 * 1000;
const jobs = new Map<string, LookupJob>();

function sweep(now = Date.now()) {
  for (const [id, j] of jobs) if (now - j.createdAt > TTL_MS) jobs.delete(id);
}

/** Map a resolver event onto the job's step list (one live line per item). */
export function applyEvent(steps: JobStep[], e: ResolveEvent): JobStep[] {
  const id = `item-${e.item}`;
  const verb: JobStep['verb'] = e.state === 'checking' ? 'Reading' : e.state === 'found' ? 'Searched' : 'Checked';
  const next = steps.filter((s) => s.id !== id);
  next.push({ id, verb, text: e.text });
  return next.sort((a, b) => a.id.localeCompare(b.id));
}

export function startLookupJob(
  userId: string,
  detail: ParsedMealDetail,
  resolve: (items: BrandedItem[], ctx: Pick<ResolveCtx, 'onEvent'>) => Promise<ResolvedItem[]>,
  finish: (detail: ParsedMealDetail, items: BrandedItem[], resolved: ResolvedItem[]) => ParsedMealDetail,
): LookupJob {
  sweep();
  const items = detail.brandedItems ?? [];
  const job: LookupJob = {
    id: randomUUID(), userId, createdAt: Date.now(), done: false,
    steps: items.map((it, i) => ({ id: `item-${i}`, verb: 'Reading' as const, text: `${it.brand} ${it.product} — checking` })),
    result: null,
  };
  jobs.set(job.id, job);
  resolve(items, { onEvent: (e) => { job.steps = applyEvent(job.steps, e); } })
    .then((resolved) => { job.result = finish(detail, items, resolved); })
    .catch(() => { job.result = { ...detail, lookups: items.map((it) => ({ brand: it.brand, product: it.product, size: it.size, status: 'estimated' as const, step: 'estimate' as const, sourceDomain: null, sourceUrl: null, calories: Math.round(it.estimate.calories) })) }; })
    .finally(() => {
      job.done = true;
      // Whatever is still "checking" when the job ends was abandoned: say so.
      job.steps = job.steps.map((s) => (s.verb === 'Reading' ? { ...s, verb: 'Checked' as const, text: s.text.replace(/ — .*$/, ' — estimated') } : s));
    });
  return job;
}

export function getLookupJob(id: string, userId: string): LookupJob | null {
  sweep();
  const j = jobs.get(id);
  return j && j.userId === userId ? j : null;
}

export function _resetLookupJobsForTests() { jobs.clear(); }
