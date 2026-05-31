// Email-verification OTP service. Generates a 6-digit code, mails it via
// the shared mailer, persists a SHA-256 of the digits (never the digits
// themselves) with an expiry + attempt counter, and verifies on submission.
//
// Surface area is intentionally tiny: requestCode / verifyCode / canResend.
// The route layer enforces auth-flow semantics (login/register response
// shape, JWT issuance after success) — this service only owns the OTP
// lifecycle and message body.

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './mailService.js';

const prisma = new PrismaClient();

// Tuned so a human has time to switch apps + read the email, but not so
// long that an intercepted code is useful days later.
export const CODE_TTL_MINUTES = 15;
// Five wrong attempts on one code invalidates it. Users can request a new
// one (subject to the resend cooldown).
export const MAX_ATTEMPTS = 5;
// Resend rate limit: a fresh code can only be sent every 60 seconds.
export const RESEND_COOLDOWN_SECONDS = 60;

function hash(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generate6Digit(): string {
  // crypto.randomInt is uniform — Math.random is not, and would skew low.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildEmail(code: string): { subject: string; html: string; text: string } {
  const subject = `Your Axiom verification code: ${code}`;
  const text = [
    `Welcome to Axiom!`,
    ``,
    `Your verification code is: ${code}`,
    ``,
    `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore the email.`,
    ``,
    `— The Axiom team`,
  ].join('\n');
  // Plain-text-style HTML — high deliverability, no images, no tracking
  // pixels. Code is monospaced + visually centred so it's easy to copy.
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #0f0f0f;">
      <h2 style="margin: 0 0 16px;">Welcome to Axiom</h2>
      <p style="margin: 0 0 12px;">Use this code to finish signing up:</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; text-align: center; background: #f4f4f5; padding: 16px; border-radius: 8px; font-family: 'SF Mono', Menlo, monospace;">${code}</div>
      <p style="margin: 16px 0 0; font-size: 13px; color: #555;">It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore the email.</p>
      <p style="margin: 24px 0 0; font-size: 13px; color: #888;">— The Axiom team</p>
    </div>
  `;
  return { subject, html, text };
}

/**
 * Create-or-replace a verification code for `email` and email it to the
 * user. Returns the freshly-stored row id so callers can correlate logs.
 * Enforces the 60s resend cooldown when `respectCooldown` is true.
 */
export async function requestCode(
  email: string,
  opts: { respectCooldown?: boolean } = {},
): Promise<{ sent: boolean; cooldownRemainingSec?: number; reason?: string }> {
  const normEmail = normalizeEmail(email);
  const existing = await prisma.emailVerificationCode.findUnique({ where: { email: normEmail } });

  if (opts.respectCooldown && existing) {
    const sinceLastMs = Date.now() - existing.lastSentAt.getTime();
    const cooldownMs = RESEND_COOLDOWN_SECONDS * 1000;
    if (sinceLastMs < cooldownMs) {
      return { sent: false, cooldownRemainingSec: Math.ceil((cooldownMs - sinceLastMs) / 1000), reason: 'cooldown' };
    }
  }

  const code = generate6Digit();
  const codeHash = hash(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  // Upsert keeps a single active code per email — sending a new one always
  // supersedes the previous (resets attempts so a stuck count doesn't
  // outlive the code that earned it).
  await prisma.emailVerificationCode.upsert({
    where: { email: normEmail },
    create: { email: normEmail, codeHash, expiresAt, attempts: 0, lastSentAt: new Date(), consumedAt: null },
    update: { codeHash, expiresAt, attempts: 0, lastSentAt: new Date(), consumedAt: null },
  });

  const msg = buildEmail(code);
  const res = await sendEmail({ to: normEmail, subject: msg.subject, html: msg.html, text: msg.text });
  if (!res.sent) {
    // If the send failed, we leave the row in place — the user can hit
    // resend without burning the cooldown they don't realise applies.
    return { sent: false, reason: res.reason ?? 'send_failed' };
  }
  return { sent: true };
}

/**
 * Validate a submitted code. Increments attempts on failure. Marks consumed
 * + returns ok=true on success. Returns granular reasons so the UI can show
 * "wrong code", "expired", "too many attempts" etc.
 */
export async function verifyCode(
  email: string,
  submitted: string,
): Promise<{ ok: true } | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'mismatch' }> {
  const normEmail = normalizeEmail(email);
  const row = await prisma.emailVerificationCode.findUnique({ where: { email: normEmail } });
  if (!row || row.consumedAt) return { ok: false, reason: 'no_code' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const ok = hash(submitted.trim()) === row.codeHash;
  if (!ok) {
    await prisma.emailVerificationCode.update({
      where: { email: normEmail },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: 'mismatch' };
  }

  await prisma.emailVerificationCode.update({
    where: { email: normEmail },
    data: { consumedAt: new Date() },
  });
  return { ok: true };
}

/** Convenience for the resend route — returns how long until a resend is allowed. */
export async function getResendCooldown(email: string): Promise<number> {
  const normEmail = normalizeEmail(email);
  const row = await prisma.emailVerificationCode.findUnique({ where: { email: normEmail } });
  if (!row) return 0;
  const sinceLastMs = Date.now() - row.lastSentAt.getTime();
  const cooldownMs = RESEND_COOLDOWN_SECONDS * 1000;
  return sinceLastMs >= cooldownMs ? 0 : Math.ceil((cooldownMs - sinceLastMs) / 1000);
}
