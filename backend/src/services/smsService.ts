// Owner-notification SMS via Twilio. Extracted from routes/coach.ts so
// schedulers (e.g. the monthly affiliate payout run) can notify without
// importing a route module. Silently no-ops when Twilio isn't configured.
import twilio from 'twilio';

let twilioClient: ReturnType<typeof twilio> | null = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try { twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }
  catch { /* disabled */ }
}

/** Text the owner's NOTIFICATION_PHONE. Fire-and-forget; never throws. */
export async function sendCoachSMS(body: string): Promise<void> {
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER || !process.env.NOTIFICATION_PHONE) return;
  try {
    await twilioClient.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: process.env.NOTIFICATION_PHONE });
  } catch (e) {
    console.error('Owner SMS failed:', e);
  }
}
