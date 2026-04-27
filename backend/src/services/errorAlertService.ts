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
