// OpenFoodFacts product lookup — one barcode, one classified outcome.
//
// The v3 API answers a product it doesn't have with HTTP 404 and
// `{ status: "failure", result: { id: "product_not_found" } }`. The route used
// to treat every non-2xx as "OpenFoodFacts unreachable" (502), so an unlisted
// barcode — the common case for regional goods — surfaced as a server error
// and skipped the "scan the label" recovery. Here a miss is a miss, and only a
// real outage (network error, timeout, 5xx, 429) is "unavailable".
//
// Transient failures get one quick retry: OFF sheds load with 503s in bursts,
// and a second attempt usually lands.

export const OFF_BASE = 'https://world.openfoodfacts.org/api/v3/product';
const USER_AGENT = 'Axiom-Fitness/2.0.2 (https://axiomtraining.io)';
const ATTEMPT_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 300;

export type OffLookup =
  | { kind: 'found'; product: any }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; upstream: number | null; reason: string };

type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

async function attempt(code: string, fetchFn: FetchFn): Promise<OffLookup> {
  let r: Response;
  try {
    r = await fetchFn(`${OFF_BASE}/${code}.json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network';
    return { kind: 'unavailable', upstream: null, reason };
  }
  if (isTransient(r.status)) return { kind: 'unavailable', upstream: r.status, reason: 'upstream' };

  const json: any = r.ok ? await r.json().catch(() => null) : null;
  if (json?.product && json.status !== 0 && json.status !== 'failure') {
    return { kind: 'found', product: json.product };
  }
  // v3 404 + result.id "product_not_found", a v2-style status 0, or any other
  // 4xx (a code OFF rejects): not an outage, just not in their database.
  return { kind: 'not_found' };
}

export async function lookupOpenFoodFacts(
  code: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
  retryDelayMs = RETRY_DELAY_MS,
): Promise<OffLookup> {
  const first = await attempt(code, fetchFn);
  if (first.kind !== 'unavailable') return first;
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  return attempt(code, fetchFn);
}
