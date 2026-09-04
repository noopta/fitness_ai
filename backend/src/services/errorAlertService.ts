import twilio from 'twilio';

const ALERT_PHONE = '+15199938342';
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per unique error fingerprint

let twilioClient: ReturnType<typeof twilio> | null = null;
if (
  process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER
) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch { /* disabled */ }
}

// Fingerprint → last alerted timestamp (in-process dedup)
const lastAlerted = new Map<string, number>();

function fingerprint(label: string, route?: string): string {
  return `${label}|${route ?? 'unknown'}`;
}

function shouldSend(fp: string): boolean {
  const last = lastAlerted.get(fp) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  lastAlerted.set(fp, Date.now());
  return true;
}

async function sendSMS(body: string): Promise<void> {
  if (!twilioClient) return;
  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: ALERT_PHONE,
    });
  } catch (e) {
    console.error('[errorAlert] SMS send failed:', e);
  }
}

export async function alertServerError(
  err: unknown,
  route: string,
  method: string,
  statusCode: number,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack?.split('\n')[1]?.trim() ?? '') : '';
  const fp = fingerprint(message.slice(0, 60), route);

  if (!shouldSend(fp)) return;

  const body = [
    `🚨 Axiom API Error`,
    `${method} ${route} → ${statusCode}`,
    `Msg: ${message.slice(0, 120)}`,
    stack ? `At: ${stack.slice(0, 100)}` : '',
  ].filter(Boolean).join('\n');

  await sendSMS(body);
}

// ── Validation watchdog ─────────────────────────────────────────────────────
// 4xx validation failures are usually noise (scanners, bad input) and never
// alert — but REPEATED failures on a core product flow are a product bug
// wearing a client-error costume (2026-07-29: a new user failed meal logging
// twice on a schema bug and nobody was told). Track per-endpoint counts in a
// rolling hour; alert once past the threshold, then cool down.
const validationHits = new Map<string, number[]>();
const VALIDATION_THRESHOLD = 2;      // failures within the window
const VALIDATION_WINDOW_MS = 60 * 60 * 1000;

export function trackValidationFailure(route: string, detail: string): void {
  const now = Date.now();
  const hits = (validationHits.get(route) ?? []).filter((t) => now - t < VALIDATION_WINDOW_MS);
  hits.push(now);
  validationHits.set(route, hits);
  if (hits.length >= VALIDATION_THRESHOLD && shouldSend(fingerprint('validation', route))) {
    void sendSMS(
      `⚠️ Axiom validation failures: ${hits.length}x on ${route} in the last hour — ` +
      `users may be blocked by a schema bug. Latest: ${detail.slice(0, 180)}`,
    );
  }
}

export async function alertUncaughtException(type: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const fp = fingerprint(`${type}:${message.slice(0, 60)}`);

  if (!shouldSend(fp)) return;

  const body = [
    `🔴 Axiom ${type}`,
    `Msg: ${message.slice(0, 140)}`,
  ].join('\n');

  await sendSMS(body);
}


// ── Content-safety escalation ───────────────────────────────────────────────
//
// Deliberately separate from alertServerError, for three reasons that all
// matter:
//
//  1. NO COOLDOWN DEDUP. alertServerError suppresses a repeat fingerprint for
//     10 minutes, which is right for a crashing route and wrong here: two
//     quarantines ten seconds apart are two incidents, not one noisy error,
//     and silently dropping the second could drop the one that mattered.
//  2. NO CONTENT, NO OBJECT PATH. The SMS is a summons, not a report. Routing
//     an evidence pointer through Twilio would put it in a third party's logs.
//     The message says where to look; it never says what was seen.
//  3. IT IS TIME-BOUND. The GCS bucket's 1-day lifecycle rule reaps preserved
//     objects, so an unactioned alert becomes an expired legal obligation in
//     24 hours. The deadline is in the message because a reviewer who reads
//     it tomorrow needs to know it is already too late.
export async function alertContentQuarantine(opts: {
  flagId: string;
  concern: string;
}): Promise<void> {
  const body = [
    '\u26A0\uFE0F Axiom CONTENT QUARANTINE',
    `Flag: ${opts.flagId}`,
    `Reason: ${opts.concern}`,
    'A video was withheld from deletion for human review.',
    'ACT WITHIN 24H — the storage lifecycle rule deletes it after that.',
    'Review: ContentFlag table, then the referenced object.',
  ].join('\n');

  // Bypasses shouldSend on purpose — see (1) above.
  await sendSMS(body);
  // Always leave the durable trace too, so the incident is recoverable even
  // when Twilio is unconfigured, over quota, or silently failing.
  console.error(`[errorAlert] CONTENT QUARANTINE flag=${opts.flagId} concern=${opts.concern}`);
}

/**
 * Fire a harmless test escalation so the on-call path can be verified without
 * waiting for a real incident. An alert that has never fired is one nobody
 * knows is broken — and this one is expected to fire approximately never.
 */
export async function testQuarantineAlert(): Promise<void> {
  await alertContentQuarantine({ flagId: 'TEST-no-real-incident', concern: 'synthetic_test' });
}
