// Short-lived signed links: HMAC-SHA256 over `part1|part2|...|exp`. Used where
// a browser has to open a URL directly (new tab, <a href>) and we must not put
// a long-lived credential in that URL. The signature + expiry IS the
// credential, so keep TTLs short.
//
// Key: derived from the email-link secret (EMAIL_UNSUB_SECRET, else a
// JWT_SECRET derivation — see resolveUnsubSecret) with a purpose label, so a
// signed-link signature can never be replayed as an unsubscribe token or vice
// versa. Throws in production when neither secret is set (via resolveUnsubSecret).
import crypto from 'node:crypto';
import { resolveUnsubSecret } from './emailUnsubscribe.js';

function key(): Buffer {
  return crypto.createHmac('sha256', resolveUnsubSecret()).update('signed-link:v1').digest();
}

function mac(parts: string[], exp: number): string {
  return crypto.createHmac('sha256', key()).update([...parts, String(exp)].join('|')).digest('base64url');
}

/** Sign `parts` for `ttlMs`. Returns the expiry (epoch ms) and the signature. */
export function signLink(parts: string[], ttlMs: number, now: number = Date.now()): { exp: number; sig: string } {
  const exp = now + ttlMs;
  return { exp, sig: mac(parts, exp) };
}

/** True only for an untampered, unexpired signature over exactly these parts. */
export function verifyLink(parts: string[], exp: number | string, sig: string, now: number = Date.now()): boolean {
  const expNum = typeof exp === 'number' ? exp : Number(exp);
  if (!Number.isSafeInteger(expNum) || expNum <= now) return false;
  if (typeof sig !== 'string' || !sig) return false;
  const expected = Buffer.from(mac(parts, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
