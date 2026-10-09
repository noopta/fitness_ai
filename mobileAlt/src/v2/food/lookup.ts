// Typed food with a lookup: the server answers with an estimate at once and,
// for branded items, a lookup job (your scans → verified records → food
// databases → web). We poll the job, hand each check to the screen as it
// happens, and only return once it's done — callers hold Log until then.

import { nutritionApi } from '../../lib/api';

export type LookupStep = { id: string; verb: 'Reading' | 'Searched' | 'Checked'; text: string };

const POLL_MS = 1200;
const GIVE_UP_MS = 60_000;

/**
 * Parse `text`; while branded items are being looked up, `onProgress` gets the
 * estimate and the live steps. Resolves with the final meal (looked-up values
 * folded in), or the estimate if the lookup can't finish.
 */
export async function describeWithLookup(
  text: string,
  onProgress: (p: { estimate: any; steps: LookupStep[]; pending: boolean }) => void,
  signal?: { cancelled: boolean },
): Promise<any> {
  const parsed: any = await nutritionApi.parseMeal(text, { defer: true });
  const job = parsed?.lookup;
  if (!job?.id || job.done) return parsed;
  onProgress({ estimate: parsed, steps: job.steps ?? [], pending: true });
  const until = Date.now() + GIVE_UP_MS;
  let steps: LookupStep[] = job.steps ?? [];
  while (Date.now() < until) {
    if (signal?.cancelled) return parsed;
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const r = await nutritionApi.foodLookup(job.id);
      steps = r.steps ?? steps;
      if (r.done) {
        onProgress({ estimate: parsed, steps, pending: false });
        return r.result ?? parsed;
      }
      onProgress({ estimate: parsed, steps, pending: true });
    } catch (e: any) {
      if (e?.status === 404) break; // expired
    }
  }
  const closed = steps.map((s) => (s.verb === 'Reading' ? { ...s, verb: 'Checked' as const, text: s.text.replace(/ — .*$/, ' — estimated') } : s));
  onProgress({ estimate: parsed, steps: closed, pending: false });
  return parsed;
}

/** Index of the step still running (for ReceiptList's live line), else -1. */
export const liveStep = (steps: { verb: string }[]) => {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].verb === 'Reading') return i;
  return -1;
};
