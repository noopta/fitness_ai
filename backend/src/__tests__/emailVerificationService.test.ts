// Email-verification service tests — verify the OTP lifecycle in isolation
// (hashing, expiry, attempt cap, resend cooldown, upsert semantics).
// Prisma is mocked; the shared mailer is stubbed to a spy so we can assert
// on what would have been sent without hitting SendGrid.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  emailVerificationCode: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  sendEmail: vi.fn(async () => ({ sent: true, provider: 'sendgrid' as const })),
}));

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    Object.assign(this, { emailVerificationCode: mocks.emailVerificationCode });
  });
  return { PrismaClient };
});

vi.mock('../services/mailService.js', () => ({
  sendEmail: mocks.sendEmail,
  isMailConfigured: () => true,
}));

import {
  requestCode, verifyCode, getResendCooldown,
  RESEND_COOLDOWN_SECONDS, MAX_ATTEMPTS, CODE_TTL_MINUTES,
} from '../services/emailVerificationService.js';
import crypto from 'crypto';

const EMAIL = 'test@example.com';
const hash = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

beforeEach(() => {
  mocks.emailVerificationCode.findUnique.mockReset();
  mocks.emailVerificationCode.upsert.mockReset();
  mocks.emailVerificationCode.update.mockReset();
  mocks.sendEmail.mockReset();
  mocks.sendEmail.mockResolvedValue({ sent: true, provider: 'sendgrid' });
});

describe('requestCode', () => {
  it('upserts a hashed code with a 15-minute expiry and mails the user', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(null);
    mocks.emailVerificationCode.upsert.mockResolvedValue({});

    const r = await requestCode(EMAIL);

    expect(r.sent).toBe(true);
    expect(mocks.emailVerificationCode.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);

    const upsertArg = mocks.emailVerificationCode.upsert.mock.calls[0][0];
    expect(upsertArg.where.email).toBe(EMAIL);
    // Stored as a SHA-256 hex (64 chars) — never the digits themselves.
    expect(upsertArg.create.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(upsertArg.update.codeHash).toMatch(/^[0-9a-f]{64}$/);
    // Expiry is ~15 minutes out.
    const ttlMs = upsertArg.create.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan((CODE_TTL_MINUTES - 1) * 60_000);
    expect(ttlMs).toBeLessThan((CODE_TTL_MINUTES + 1) * 60_000);

    // The mail body must contain the 6-digit code in plain form.
    const mailArg = mocks.sendEmail.mock.calls[0][0];
    expect(mailArg.to).toBe(EMAIL);
    expect(mailArg.subject).toMatch(/\d{6}/);
  });

  it('respects the 60s cooldown when asked', async () => {
    // A row that was sent 10s ago — within cooldown.
    mocks.emailVerificationCode.findUnique.mockResolvedValue({
      lastSentAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      codeHash: 'x',
      consumedAt: null,
    });

    const r = await requestCode(EMAIL, { respectCooldown: true });

    expect(r.sent).toBe(false);
    expect(r.reason).toBe('cooldown');
    expect(r.cooldownRemainingSec).toBeGreaterThan(40);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.emailVerificationCode.upsert).not.toHaveBeenCalled();
  });

  it('ignores cooldown when respectCooldown is false', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue({
      lastSentAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 3,
      codeHash: 'x',
      consumedAt: null,
    });
    mocks.emailVerificationCode.upsert.mockResolvedValue({});

    const r = await requestCode(EMAIL, { respectCooldown: false });

    expect(r.sent).toBe(true);
    // Attempts must reset when a fresh code is issued.
    expect(mocks.emailVerificationCode.upsert.mock.calls[0][0].update.attempts).toBe(0);
  });

  it('reports send_failed without blowing up when the mailer is down', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(null);
    mocks.emailVerificationCode.upsert.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValueOnce({ sent: false, provider: null, reason: 'No email provider configured' });

    const r = await requestCode(EMAIL);

    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/provider/i);
  });
});

describe('verifyCode', () => {
  function row(overrides: Partial<{ codeHash: string; expiresAt: Date; attempts: number; consumedAt: Date | null }>) {
    return {
      email: EMAIL,
      codeHash: hash('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
      ...overrides,
    };
  }

  it('marks consumed and returns ok on a correct code', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(row({}));
    mocks.emailVerificationCode.update.mockResolvedValue({});
    const r = await verifyCode(EMAIL, '123456');
    expect(r.ok).toBe(true);
    expect(mocks.emailVerificationCode.update.mock.calls[0][0].data.consumedAt).toBeInstanceOf(Date);
  });

  it('increments attempts and returns mismatch on a wrong code', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(row({}));
    mocks.emailVerificationCode.update.mockResolvedValue({});
    const r = await verifyCode(EMAIL, '999999');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('mismatch');
    expect(mocks.emailVerificationCode.update.mock.calls[0][0].data.attempts.increment).toBe(1);
  });

  it('returns expired when the code TTL has passed', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    const r = await verifyCode(EMAIL, '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
    expect(mocks.emailVerificationCode.update).not.toHaveBeenCalled();
  });

  it('returns too_many_attempts after MAX_ATTEMPTS without consuming', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(row({ attempts: MAX_ATTEMPTS }));
    const r = await verifyCode(EMAIL, '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_many_attempts');
    expect(mocks.emailVerificationCode.update).not.toHaveBeenCalled();
  });

  it('returns no_code when nothing is on file or it was already consumed', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValueOnce(null);
    let r = await verifyCode(EMAIL, '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_code');

    mocks.emailVerificationCode.findUnique.mockResolvedValueOnce(row({ consumedAt: new Date() }));
    r = await verifyCode(EMAIL, '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_code');
  });

  it('normalizes email casing on lookup', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(row({}));
    mocks.emailVerificationCode.update.mockResolvedValue({});
    await verifyCode('TEST@Example.COM', '123456');
    expect(mocks.emailVerificationCode.findUnique.mock.calls[0][0].where.email).toBe('test@example.com');
  });
});

describe('getResendCooldown', () => {
  it('returns 0 when no code on file', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue(null);
    expect(await getResendCooldown(EMAIL)).toBe(0);
  });

  it('returns remaining seconds when within cooldown', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue({
      lastSentAt: new Date(Date.now() - 20_000),
    });
    const left = await getResendCooldown(EMAIL);
    expect(left).toBeGreaterThan(30);
    expect(left).toBeLessThanOrEqual(RESEND_COOLDOWN_SECONDS);
  });

  it('returns 0 when cooldown elapsed', async () => {
    mocks.emailVerificationCode.findUnique.mockResolvedValue({
      lastSentAt: new Date(Date.now() - 120_000),
    });
    expect(await getResendCooldown(EMAIL)).toBe(0);
  });
});
