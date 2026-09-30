// Password reset by emailed 6-digit code (ACC-07). Same shape as the
// verification OTP: only a SHA-256 of the code is stored, 15-minute expiry,
// 5 attempts, 60 s resend cooldown. requestReset never says whether an
// account exists, so it can't be used to enumerate emails.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './mailService.js';

const prisma = new PrismaClient();
export const RESET_TTL_MINUTES = 15;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_COOLDOWN_SECONDS = 60;

const hash = (code: string) => crypto.createHash('sha256').update(code).digest('hex');
const norm = (email: string) => email.trim().toLowerCase();

export async function requestReset(email: string): Promise<{ accepted: true; cooldownRemainingSec?: number }> {
  const e = norm(email);
  const user = await prisma.user.findFirst({ where: { email: e }, select: { id: true, hashedPassword: true } });
  const existing = await prisma.passwordResetCode.findUnique({ where: { email: e } });
  if (existing) {
    const since = Date.now() - existing.lastSentAt.getTime();
    if (since < RESET_COOLDOWN_SECONDS * 1000) return { accepted: true, cooldownRemainingSec: Math.ceil((RESET_COOLDOWN_SECONDS * 1000 - since) / 1000) };
  }
  // No account, or a Google/Apple-only account with no password: answer the
  // same way, send nothing.
  if (!user) return { accepted: true };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
  await prisma.passwordResetCode.upsert({
    where: { email: e },
    create: { email: e, codeHash: hash(code), expiresAt, attempts: 0, lastSentAt: new Date() },
    update: { codeHash: hash(code), expiresAt, attempts: 0, lastSentAt: new Date(), consumedAt: null },
  });
  const text = [`Your Axiom password reset code is: ${code}`, '', `It expires in ${RESET_TTL_MINUTES} minutes. If you didn't ask to reset your password, ignore this email — nothing changes.`, '', '— The Axiom team'].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f0f0f"><h2 style="margin:0 0 16px">Reset your password</h2><p style="margin:0 0 12px">Enter this code in the app:</p><div style="font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;background:#f4f4f5;padding:16px;border-radius:8px;font-family:'SF Mono',Menlo,monospace">${code}</div><p style="margin:16px 0 0;font-size:13px;color:#555">It expires in ${RESET_TTL_MINUTES} minutes. If you didn't ask to reset your password, ignore this email — nothing changes.</p></div>`;
  await sendEmail({ to: e, subject: `Your Axiom reset code: ${code}`, html, text });
  return { accepted: true };
}

export type ResetFailure = 'no_code' | 'expired' | 'too_many_attempts' | 'mismatch' | 'weak_password';
export async function resetPassword(email: string, code: string, newPassword: string): Promise<{ ok: true; userId: string } | { ok: false; reason: ResetFailure }> {
  if (newPassword.length < 8) return { ok: false, reason: 'weak_password' };
  const e = norm(email);
  const row = await prisma.passwordResetCode.findUnique({ where: { email: e } });
  if (!row || row.consumedAt) return { ok: false, reason: 'no_code' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= RESET_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (hash(code.trim()) !== row.codeHash) {
    await prisma.passwordResetCode.update({ where: { email: e }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: 'mismatch' };
  }
  const user = await prisma.user.findFirst({ where: { email: e }, select: { id: true } });
  if (!user) return { ok: false, reason: 'no_code' };
  await prisma.user.update({ where: { id: user.id }, data: { hashedPassword: await bcrypt.hash(newPassword, 12) } });
  await prisma.passwordResetCode.update({ where: { email: e }, data: { consumedAt: new Date() } });
  return { ok: true, userId: user.id };
}
