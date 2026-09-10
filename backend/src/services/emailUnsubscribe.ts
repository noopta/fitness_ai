// Signed unsubscribe links for broadcast (blog/update) email. The token is an
// HMAC over the userId so the link can't be forged for someone else, and it
// carries no expiry — an unsubscribe link in an old email must keep working.
import crypto from 'node:crypto';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'https://api.airthreads.ai:4009/api';

function secret(): string {
  return process.env.EMAIL_UNSUB_SECRET || process.env.JWT_SECRET || 'dev-unsub-secret';
}

export function unsubscribeToken(userId: string): string {
  return crypto.createHmac('sha256', secret()).update(`unsub:${userId}`).digest('base64url');
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!userId || !token) return false;
  const expected = unsubscribeToken(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubscribeUrl(userId: string): string {
  return `${API_PUBLIC_URL}/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(unsubscribeToken(userId))}`;
}

export { FRONTEND_URL };
