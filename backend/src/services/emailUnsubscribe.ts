// Signed links for email: unsubscribe (broadcast/update mail) and double
// opt-in confirmation (BlogSubscriber). Each token is an HMAC over the id with
// a purpose prefix, so a link can't be forged for someone else and an
// unsubscribe token can't be replayed as a confirmation token. Unsubscribe
// tokens carry no expiry: a link in an old email has to keep working.
//
// Key resolution (no literal fallback anywhere):
//   1. EMAIL_UNSUB_SECRET when set (recommended: a dedicated random secret).
//   2. Otherwise a key derived from JWT_SECRET (sha256(JWT_SECRET + 'unsub')),
//      never the JWT secret itself.
//   3. Neither set: in production the module throws at import (i.e. server
//      startup) instead of signing with something guessable; outside
//      production a random per-process key is used (links stop verifying on
//      restart, which is fine for dev/test).
//
// Legacy links: before 2026-10 the key was the raw JWT_SECRET. Verification
// still accepts that key so unsubscribe links in already-sent emails keep
// working; new links are only ever signed with the current key.
import crypto from 'node:crypto';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'https://api.airthreads.ai:4009/api';

export class EmailUnsubConfigError extends Error {}

/** Random per-process key for dev/test when no secret is configured. Never used in production. */
const EPHEMERAL_KEY = crypto.randomBytes(32).toString('hex');

/** Resolve the signing key; throws in production when neither secret is set. Exported for tests. */
export function resolveUnsubSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EMAIL_UNSUB_SECRET) return env.EMAIL_UNSUB_SECRET;
  if (env.JWT_SECRET) return crypto.createHash('sha256').update(`${env.JWT_SECRET}unsub`).digest('hex');
  if (env.NODE_ENV === 'production') {
    throw new EmailUnsubConfigError('EMAIL_UNSUB_SECRET or JWT_SECRET must be set in production (signs email unsubscribe/confirm links)');
  }
  return EPHEMERAL_KEY;
}

// Fail fast at startup in production.
if (process.env.NODE_ENV === 'production') resolveUnsubSecret();

function secret(): string {
  return resolveUnsubSecret();
}

function sign(key: string, purpose: 'unsub' | 'confirm', id: string): string {
  return crypto.createHmac('sha256', key).update(`${purpose}:${id}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function unsubscribeToken(userId: string): string {
  return sign(secret(), 'unsub', userId);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!userId || !token) return false;
  if (safeEqual(unsubscribeToken(userId), token)) return true;
  // Links sent before the key change were signed with the raw JWT_SECRET.
  const legacy = process.env.JWT_SECRET;
  return !!legacy && safeEqual(sign(legacy, 'unsub', userId), token);
}

/** `category` turns off just that email (e.g. 'weekly'); without it, all updates. */
export function unsubscribeUrl(userId: string, category?: 'weekly'): string {
  return `${API_PUBLIC_URL}/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(unsubscribeToken(userId))}${category ? `&c=${category}` : ''}`;
}

// ─── Double opt-in (BlogSubscriber) ──────────────────────────────────────────

export function confirmToken(subscriberId: string): string {
  return sign(secret(), 'confirm', subscriberId);
}

export function verifyConfirmToken(subscriberId: string, token: string): boolean {
  if (!subscriberId || !token) return false;
  return safeEqual(confirmToken(subscriberId), token);
}

export function confirmSubscriptionUrl(subscriberId: string): string {
  return `${API_PUBLIC_URL}/email/confirm?s=${encodeURIComponent(subscriberId)}&t=${encodeURIComponent(confirmToken(subscriberId))}`;
}

export { FRONTEND_URL };
