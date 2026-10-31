import { Router, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { requestReset, resetPassword } from '../services/passwordResetService.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireExportToken, EXPORT_TOKEN_TTL_SEC } from '../middleware/requireAuth.js';
import { invalidateAuthCache } from '../middleware/authSessionCache.js';
import { isAdminEmail } from '../middleware/requireAdmin.js';
import { scheduleWelcomeEmail } from '../services/welcomeEmailService.js';
import { onboardingHookAvailableFor, diagnosticFirstAvailableFor, liftConversationAvailableFor, directEntryPaywallEnabled, isOnboardingTestAccount, uiV2AvailableFor, personalTrainingAvailableFor, freestyleAvailableFor, logAdaptationAvailableFor, phaseInferenceAvailableFor, mealPhotoV2AvailableFor, webFoodSearchAvailableFor, wearablesAvailableFor, logReviewAvailableFor, awayDigestAvailableFor, swapV2AvailableFor, proactiveAvailableFor } from '../services/featureFlags.js';
import { resetOnboardingTestAccount } from '../services/onboardingTestReset.js';
import { resizeAvatarBase64 } from '../services/avatarImage.js';
import { cancelActiveSubscriptions, liveSubscriptionEnd } from '../services/stripeService.js';
import twilio from 'twilio';
import appleSignin from 'apple-signin-auth';
import posthog from '../services/posthogClient.js';
import { detectUnitPreference, normalizePreference } from '../services/weightUnits.js';
import {
  requestCode as requestEmailVerification,
  verifyCode as verifyEmailCode,
  getResendCooldown,
  RESEND_COOLDOWN_SECONDS,
} from '../services/emailVerificationService.js';
import {
  bounded,
  implausibilityWarning,
  validateDateOfBirth,
} from '../validation/physiologicalBounds.js';
import { moderateText, moderateImageBase64, checkReservedName } from '../services/moderationService.js';
import { authLimiter, otpLimiter, registerLimiter, outboundNotifyLimiter } from '../middleware/rateLimiter.js';
import { buildUserDataExport } from '../services/dataExportService.js';

const router = Router();
const prisma = new PrismaClient();

// Twilio for sign-in/register notifications
let twilioClient: ReturnType<typeof twilio> | null = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch { /* disabled */ }
}

async function sendAuthSMS(body: string) {
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER || !process.env.NOTIFICATION_PHONE) return;
  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.NOTIFICATION_PHONE,
    });
  } catch (e) {
    console.error('Auth SMS failed:', e);
  }
}

// Emails that always receive pro tier (complimentary access)
// Gmail ignores dots in the local part, so both spellings reach the same
// inbox and either can arrive from Google sign-in. The lookup is a literal
// string match, so comped Gmail addresses list both forms.
const PRO_TIER_EMAILS = new Set([
  'brian62888@gmail.com',
  'safia.alif.sa@gmail.com',
  'saeedabiissa@gmail.com',   // Saeed Abi-Issa (affiliate, UGC) — comped pro
  'saeed.abiissa@gmail.com',
]);

function tierForEmail(email: string | null | undefined): string {
  return email && PRO_TIER_EMAILS.has(email.toLowerCase().trim()) ? 'pro' : 'free';
}

// Master gate for the email+password OTP flow. Default OFF so a fresh deploy
// doesn't strand users on builds without the verify-email screen, or break
// signups while the mailer is misconfigured. Flip EMAIL_VERIFICATION_ENABLED
// in .env to 'true' once (a) SendGrid (or fallback) is working, and (b) the
// mobile OTA with the verify screen is on every relevant build.
const EMAIL_VERIFICATION_ENABLED = process.env.EMAIL_VERIFICATION_ENABLED === 'true';

const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: (IS_PROD ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

function issueToken(user: { id: string; email: string | null; tier: string; tokenVersion?: number | null }) {
  // A token is issued when session state may just have changed (sign-in, tier
  // upgrade, reset), so drop requireAuth's cached view of this user.
  invalidateAuthCache(user.id);
  return jwt.sign(
    // tv: User.tokenVersion at issue time; requireAuth rejects older tokens.
    { id: user.id, email: user.email, tier: user.tier, tv: (user as any).tokenVersion ?? 0 },
    process.env.JWT_SECRET!,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '30d') as any }
  );
}

/**
 * Revoke every session this user holds (all devices). Tokens carry the
 * tokenVersion they were issued under; requireAuth refuses older ones.
 */
async function bumpTokenVersion(userId: string): Promise<number> {
  const u = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } } as any,
    select: { tokenVersion: true } as any,
  }) as any;
  invalidateAuthCache(userId);
  return u?.tokenVersion ?? 0;
}

// ─── Consent ─────────────────────────────────────────────────────────────────
// Version of the Terms/Privacy text a user accepts. Bump when the documents
// change materially; clients compare consent.termsVersion with this.
export { CURRENT_TERMS_VERSION } from '../services/termsVersion.js';
import { CURRENT_TERMS_VERSION } from '../services/termsVersion.js';

const consentSchema = z.object({
  acceptedTerms: z.boolean().optional(),
  healthConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
});

/** Prisma data for the consent fields a request supplied (absent = unchanged). */
export function consentData(c: z.infer<typeof consentSchema>, now = new Date()): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  // Accepting is recorded; "false" is not a withdrawal of the Terms (that is
  // account deletion), so it changes nothing.
  if (c.acceptedTerms === true) { d.acceptedTermsAt = now; d.termsVersion = CURRENT_TERMS_VERSION; }
  // Health-data and marketing consent can be withdrawn at any time.
  if (c.healthConsent !== undefined) d.healthConsentAt = c.healthConsent ? now : null;
  if (c.marketingConsent !== undefined) d.marketingConsentAt = c.marketingConsent ? now : null;
  return d;
}

function consentView(u: any) {
  return {
    acceptedTermsAt: u?.acceptedTermsAt ?? null,
    termsVersion: u?.termsVersion ?? null,
    currentTermsVersion: CURRENT_TERMS_VERSION,
    healthConsentAt: u?.healthConsentAt ?? null,
    marketingConsentAt: u?.marketingConsentAt ?? null,
  };
}

/** Display names are fanned out to other users; same rules as /auth/profile. */
export const DISPLAY_NAME_MAX = 60;

/** Under 13 by a valid, non-future DOB (the COPPA line), as opposed to a typo. */
function isUnderage(dobStr: string): boolean {
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime()) || dob.getTime() > Date.now()) return false;
  return (Date.now() - dob.getTime()) / (365.25 * 86400000) < 13;
}

// Age gate. Delegates to the shared validator, which additionally rejects
// future dates and impossible ages — the previous check verified only the 13+
// floor, so a DOB in the year 1200 or next century passed and then produced a
// nonsense age everywhere it was consumed.
const validateAge = validateDateOfBirth;

// ── Password reset (ACC-07) ────────────────────────────────────────────────
// POST /api/auth/forgot-password { email } — always 200 so it can't be used to
// probe which emails have accounts. POST /api/auth/reset-password { email,
// code, password } sets the new password and signs the user in.
router.post('/auth/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const r = await requestReset(email);
    res.json({ ok: true, ...(r.cooldownRemainingSec ? { cooldownRemainingSec: r.cooldownRemainingSec } : {}) });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Enter a valid email.' });
    console.error('[auth] forgot-password failed:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn’t send a reset code. Try again.' });
  }
});

router.post('/auth/reset-password', otpLimiter, async (req, res) => {
  try {
    const { email, code, password } = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/), password: z.string().min(8).max(200) }).parse(req.body);
    const r = await resetPassword(email, code, password);
    if (!r.ok) {
      const msg: Record<string, string> = {
        no_code: 'Request a new code first.', expired: 'That code expired. Request a new one.',
        too_many_attempts: 'Too many tries. Request a new code.', mismatch: 'That code isn’t right.', weak_password: 'Use at least 8 characters.',
      };
      return res.status(400).json({ error: msg[r.reason], reason: r.reason });
    }
    // resetPassword bumped tokenVersion (every other session is now dead);
    // this token carries the new version.
    invalidateAuthCache(r.userId);
    const user = await prisma.user.findUnique({ where: { id: r.userId }, select: { id: true, email: true, tier: true, tokenVersion: true } as any }) as any;
    const token = issueToken(user!);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    res.json({ ok: true, token });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Enter your email, the 6-digit code and a new password of 8+ characters.' });
    console.error('[auth] reset-password failed:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn’t reset your password. Try again.' });
  }
});

// POST /api/auth/register
const registerSchema = z.object({
  name: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  referralCode: z.string().optional(),
  // Optional explicit unit preference from the client (e.g. mobile passing its
  // device locale's choice). When omitted we infer from the Accept-Language
  // header. 'metric' | 'imperial'.
  unitPreference: z.enum(['metric', 'imperial']).optional(),
  // Consent captured on the signup screen. Optional so older builds still
  // register; clients prompt via POST /auth/consent when it's missing.
  acceptedTerms: z.boolean().optional(),
  healthConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
});

// GET /api/auth/user-count — total registered users, used as social proof on
// the signup screen ("Join 2,847 strength athletes"). Cached in-memory for
// 60s so a viral spike on the auth screen doesn't hammer Prisma. Public,
// auth-not-required by design — these are aggregate non-PII counts.
let _userCountCache: { value: number; expiresAt: number } | null = null;
router.get('/auth/user-count', async (_req, res) => {
  try {
    const now = Date.now();
    if (_userCountCache && _userCountCache.expiresAt > now) {
      return res.json({ count: _userCountCache.value, cached: true });
    }
    const count = await prisma.user.count();
    _userCountCache = { value: count, expiresAt: now + 60_000 };
    return res.json({ count, cached: false });
  } catch (err: any) {
    console.error('[auth/user-count] failed:', err?.message ?? err);
    return res.json({ count: 0, error: true });
  }
});

router.post('/auth/register', registerLimiter, async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

    const ageError = validateAge(data.dateOfBirth);
    if (ageError) return res.status(400).json({ error: ageError });

    // Was unbounded and unmoderated — the one way past /auth/profile's rules.
    const reservedName = checkReservedName(data.name);
    if (reservedName) return res.status(400).json({ error: reservedName });
    const nameVerdict = await moderateText(data.name, 'display_name', null);
    if (!nameVerdict.allowed) return res.status(400).json({ error: nameVerdict.message });

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      // With the flag OFF, behave like the old route — any existing email
      // is a 409. With the flag ON, allow unverified rows to recover via a
      // resend so a user who closed the app mid-flow can still finish.
      if (!EMAIL_VERIFICATION_ENABLED || existing.emailVerified) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      await requestEmailVerification(data.email, { respectCooldown: false });
      return res.status(200).json({
        requiresVerification: true,
        email: data.email,
        message: 'A new verification code has been sent to your email.',
      });
    }

    // Default the display unit: explicit client choice wins, else infer from the
    // signup locale (EU/metric regions → metric, US/unknown → imperial). Storage
    // stays canonical kg regardless; this only sets what the user sees first.
    // Location first: the phone's timezone (North America → lb), then its language region.
    const unitPreference = data.unitPreference
      ?? detectUnitPreference({ timezone: req.headers['x-timezone'] as string | undefined, acceptLanguage: req.headers['accept-language'] });

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        hashedPassword,
        dateOfBirth: new Date(data.dateOfBirth),
        unitPreference,
        tier: tierForEmail(data.email),
        // When the flag is OFF (default), treat new signups as verified so
        // they pass the login gate later — preserves the original behavior
        // for mobile builds that don't yet have the verify-email screen.
        emailVerified: !EMAIL_VERIFICATION_ENABLED,
        emailVerifiedAt: EMAIL_VERIFICATION_ENABLED ? null : new Date(),
        ...(data.referralCode ? { referredByCode: data.referralCode.toUpperCase().trim() } : {}),
        ...consentData({ acceptedTerms: data.acceptedTerms, healthConsent: data.healthConsent, marketingConsent: data.marketingConsent }),
      } as any
    });

    // Fire-and-forget signup analytics — we still want to know they
    // started, even if they bail before verifying.
    sendAuthSMS(`🆕 New Axiom signup${EMAIL_VERIFICATION_ENABLED ? ' (pending verify)' : ''}: ${data.name} (${data.email})`);
    posthog.identify({
      distinctId: user.id,
      properties: {
        $set: { name: user.name, email: user.email, tier: user.tier },
        $set_once: { created_at: new Date().toISOString() },
      },
    });
    posthog.capture({
      distinctId: user.id,
      event: 'user_signed_up',
      properties: { login_method: 'email', tier: user.tier, verification_required: EMAIL_VERIFICATION_ENABLED },
    });

    if (!EMAIL_VERIFICATION_ENABLED) {
      // Legacy fast-path: issue the JWT immediately, same shape the mobile
      // app already expects. No mail call, no risk of SendGrid quota stranding.
      const token = issueToken(user);
      res.cookie('liftoff_jwt', token, COOKIE_OPTS);
      scheduleWelcomeEmail(user.id);
      return res.json({
        user: { id: user.id, name: user.name, email: user.email, tier: user.tier },
        token,
      });
    }

    // Verification-required path. Mail the 6-digit code; the client routes
    // to the verify-email screen and we issue a JWT only after the user
    // submits the right code.
    const sendResult = await requestEmailVerification(data.email, { respectCooldown: false });
    res.status(202).json({
      requiresVerification: true,
      email: data.email,
      // Surface a deliverability problem so the client can show "couldn't
      // send code — try Resend" instead of pretending it worked.
      codeSent: sendResult.sent,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    posthog.captureException(err);
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-email — submit the 6-digit code; on success, mark
// the user verified and issue a JWT (same shape as a successful login so
// the client can route into the app exactly the same way).
const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

router.post('/auth/verify-email', otpLimiter, async (req, res) => {
  try {
    const { email, code } = verifyEmailSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'No signup found for this email.' });

    // The code is ALWAYS checked. An earlier "idempotent" branch issued a
    // session for any already-verified email without looking at the code,
    // which made this route a passwordless login for ~every account. A user
    // whose code is still valid (double-tap, retry after a flaky network)
    // still succeeds below; one whose code was consumed is sent to sign in.
    const result = await verifyEmailCode(email, code);
    if (!result.ok && user.emailVerified) {
      return res.status(409).json({
        error: 'This email is already verified — sign in with your password.',
        reason: 'already_verified',
      });
    }
    if (!result.ok) {
      const status = result.reason === 'mismatch' ? 400 : 400;
      const message =
        result.reason === 'expired' ? 'That code has expired — tap Resend for a new one.'
        : result.reason === 'too_many_attempts' ? 'Too many attempts on this code. Tap Resend.'
        : result.reason === 'no_code' ? 'No active code for this email. Tap Resend.'
        : 'That code didn\'t match. Try again.';
      return res.status(status).json({ error: message, reason: result.reason });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });

    const token = issueToken(updated);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    scheduleWelcomeEmail(updated.id);
    sendAuthSMS(`✅ Verified: ${updated.name || 'User'} (${updated.email}) [${updated.tier}]`);
    posthog.capture({
      distinctId: updated.id,
      event: 'user_email_verified',
      properties: { login_method: 'email' },
    });

    res.json({
      user: { id: updated.id, name: updated.name, email: updated.email, tier: updated.tier },
      token,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('verify-email error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/resend-verification — re-send a fresh 6-digit code,
// subject to a 60s cooldown so the resend button can't be machine-gunned.
// Returns 200 with `cooldownRemainingSec` when on cooldown so the UI can
// show a countdown without us pretending we sent something.
const resendSchema = z.object({ email: z.string().email() });

router.post('/auth/resend-verification', outboundNotifyLimiter, async (req, res) => {
  try {
    const { email } = resendSchema.parse(req.body);
    // No existence-leak guard: registration already returns 409 on a known
    // email, and login flushes through a 401 — so resend doesn't add new
    // info to an attacker. Keep the response shape consistent regardless.
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(200).json({ sent: false, reason: 'no_user' });
    }
    if (user.emailVerified) {
      return res.status(200).json({ sent: false, reason: 'already_verified' });
    }
    const cooldownLeft = await getResendCooldown(email);
    if (cooldownLeft > 0) {
      // 200 (not 429) so the mobile apiFetch returns the body — the UI uses
      // cooldownRemainingSec to show "Resend in 45s" instead of catching.
      return res.status(200).json({
        sent: false,
        reason: 'cooldown',
        cooldownRemainingSec: cooldownLeft,
        cooldownTotalSec: RESEND_COOLDOWN_SECONDS,
      });
    }
    const r = await requestEmailVerification(email, { respectCooldown: false });
    res.json({ sent: r.sent, reason: r.sent ? undefined : (r.reason ?? 'send_failed') });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('resend-verification error:', err);
    res.status(500).json({ error: 'Resend failed' });
  }
});

// POST /api/auth/login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

router.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);

    let user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.hashedPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(data.password, user.hashedPassword);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Email+password users who never finished verifying don't get a JWT —
    // re-send the OTP (cooldown-respected so a click-spam doesn't blow our
    // SendGrid quota) and route the client back to the verify screen.
    // 200 (not 403) so the mobile apiFetch returns the body instead of
    // throwing — the client switches screens based on `requiresVerification`.
    // Skipped entirely when the master flag is off so existing builds
    // continue to log in as before.
    if (EMAIL_VERIFICATION_ENABLED && !user.emailVerified) {
      await requestEmailVerification(user.email!, { respectCooldown: true });
      return res.status(200).json({
        requiresVerification: true,
        email: user.email,
        message: 'Verify your email to finish signing in.',
      });
    }

    // Silently upgrade whitelisted emails that registered before the whitelist existed
    if (user.tier === 'free' && tierForEmail(user.email) === 'pro') {
      await prisma.user.update({ where: { id: user.id }, data: { tier: 'pro' } });
      user = { ...user, tier: 'pro' };
    }

    // Onboarding test accounts restart the funnel on every sign-in. The
    // allowlist check lives inside the helper, so this is a no-op for every
    // real user and a forgotten guard here cannot wipe one.
    await resetOnboardingTestAccount(user.id, user.email);

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    scheduleWelcomeEmail(user.id);
    sendAuthSMS(`🔑 Axiom login: ${user.name || 'User'} (${user.email}) [${user.tier}]`);
    posthog.identify({
      distinctId: user.id,
      properties: { $set: { name: user.name, email: user.email, tier: user.tier } },
    });
    posthog.capture({
      distinctId: user.id,
      event: 'user_logged_in',
      properties: { login_method: 'email', tier: user.tier },
    });
    res.json({ user: { id: user.id, name: user.name, email: user.email, tier: user.tier }, token });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    posthog.captureException(err);
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── OAuth redirect allowlist ────────────────────────────────────────────────
//
// `redirect_uri` arrives from the query string on /auth/google, rides through
// the OAuth round-trip inside `state`, and the callback appends a 30-day JWT to
// it. Without an allowlist that is a full account takeover in one link:
//
//   /api/auth/google?redirect_uri=https://evil.tld
//
// The victim sees the genuine Google consent screen for the genuine Axiom app,
// approves it, and their token is handed to the attacker's host. No phishing
// page, no credential theft, nothing for the user to notice.
//
// So: custom schemes must match one we actually ship, and https targets must be
// on a host we control. Anything else falls back to the web login page.

/** Custom schemes registered by our own mobile builds. */
const ALLOWED_APP_SCHEMES = ['axiom://', 'com.clubscentra.app://', 'exp://'];

/** Hosts permitted as https redirect targets. */
const ALLOWED_REDIRECT_HOSTS = new Set([
  'axiomtraining.io',
  'www.axiomtraining.io',
  'liftoffmvp.io',
  'www.liftoffmvp.io',
  ...(IS_PROD ? [] : ['localhost', '127.0.0.1']),
  // Specific preview/deploy hosts (e.g. a Replit deploy) go in env, one per
  // entry. Suffix wildcards are deliberately NOT supported: `*.replit.app` is
  // a host anyone can register, which turns the allowlist into a token sink.
  ...(process.env.EXTRA_ALLOWED_REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
]);

/**
 * True when `target` is a redirect destination we're willing to attach a token
 * to. Exported for tests.
 */
export function isAllowedRedirectTarget(target: string | null | undefined): boolean {
  if (!target || typeof target !== 'string') return false;

  // Custom app schemes: prefix match against the schemes we register. Expo dev
  // clients (exp://) are only honoured outside production.
  for (const scheme of ALLOWED_APP_SCHEMES) {
    if (!target.toLowerCase().startsWith(scheme)) continue;
    if (scheme === 'exp://' && IS_PROD) return false;
    return true;
  }

  // Everything else must be a well-formed http(s) URL on an allowlisted host.
  // Parsing (rather than string matching) is what stops
  // `https://axiomtraining.io.evil.tld` and `https://evil.tld#axiomtraining.io`.
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !IS_PROD)) return false;
  if (ALLOWED_REDIRECT_HOSTS.has(url.hostname.toLowerCase())) return true;

  return false;
}

// ─── OAuth state ─────────────────────────────────────────────────────────────
//
// `state` carries the mobile redirect across the Google round-trip. It is
// HMAC-signed so the browser can't rewrite the redirect, stamped so it can't be
// replayed days later, and bound to a nonce cookie so a callback URL lifted from
// one browser can't complete a login in another (login-CSRF). The cookie check
// is enforced when OAUTH_STATE_STRICT=1; until then a missing cookie is logged
// and allowed, so in-app browsers that drop cookies don't lock users out
// before we've seen it in the logs.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_COOKIE = 'liftoff_oauth_nonce';
const OAUTH_STATE_STRICT = process.env.OAUTH_STATE_STRICT === '1';

function signState(payload: string): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
}

export function encodeOAuthState(mobileRedirect: string | null, nonce: string): string {
  const payload = Buffer.from(JSON.stringify({ r: mobileRedirect, n: nonce, t: Date.now() })).toString('base64url');
  return `${payload}.${signState(payload)}`;
}

export function decodeOAuthState(raw: string | undefined, cookieNonce: string | undefined): { mobileRedirect: string | null; ok: boolean; reason?: string } {
  if (!raw) return { mobileRedirect: null, ok: true };
  const [payload, sig] = String(raw).split('.');
  if (!payload || !sig) return { mobileRedirect: null, ok: false, reason: 'malformed' };
  const expected = signState(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { mobileRedirect: null, ok: false, reason: 'bad_signature' };
  }
  let decoded: { r?: string | null; n?: string; t?: number };
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return { mobileRedirect: null, ok: false, reason: 'malformed' }; }
  if (typeof decoded.t !== 'number' || Date.now() - decoded.t > OAUTH_STATE_TTL_MS) return { mobileRedirect: null, ok: false, reason: 'expired' };
  const mobileRedirect = safeRedirectTarget(decoded.r);
  if (!cookieNonce || cookieNonce !== decoded.n) {
    if (OAUTH_STATE_STRICT) return { mobileRedirect, ok: false, reason: 'nonce_mismatch' };
    console.warn(`[auth] oauth state nonce ${cookieNonce ? 'mismatch' : 'cookie missing'} (non-strict, allowed)`);
  }
  return { mobileRedirect, ok: true };
}

/**
 * Resolve a client-supplied redirect into one that's safe to use, or null.
 * Rejections are logged — an attempt here is a targeted attack, not a typo, and
 * it's worth being able to see it in the logs.
 */
export function safeRedirectTarget(target: string | null | undefined): string | null {
  if (isAllowedRedirectTarget(target)) return target as string;
  if (target) console.warn(`[auth] rejected redirect_uri (not allowlisted): ${String(target).slice(0, 200)}`);
  return null;
}

/**
 * Hand the browser back to a mobile app via a custom scheme (axiom://…).
 *
 * Chrome on Android refuses to follow a server-issued 302 whose Location is a
 * non-http(s) scheme — external-protocol navigations require a user gesture on
 * the page. The Custom Tab is left holding an unresolvable intent, Android
 * falls back to the Play Store ("Checking for updates…"), and the user is
 * stranded mid-sign-in with no token.
 *
 * iOS never hit this: ASWebAuthenticationSession intercepts the redirect at the
 * network layer, so the custom scheme is never actually navigated.
 *
 * So for custom schemes we serve a real HTML page that both auto-attempts the
 * deep link on load and renders a tappable link — the tap supplies the gesture
 * Chrome requires. http(s) targets (the web flow) keep the plain 302.
 */
export function redirectToApp(res: Response, target: string) {
  if (/^https?:\/\//i.test(target)) {
    return res.redirect(target);
  }

  // The target embeds a JWT, so it must never be reflected unescaped.
  const htmlAttr = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const jsString = JSON.stringify(target).replace(/</g, '\\u003c');

  res.set('Content-Type', 'text/html; charset=utf-8');
  // A token in the URL must not be cached by any intermediary.
  res.set('Cache-Control', 'no-store');
  return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signing you in…</title>
<style>
  html,body{height:100%;margin:0}
  body{background:#000;color:#fff;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
  .w{padding:24px;max-width:20rem}
  h1{font-size:1.05rem;font-weight:600;margin:0 0 .5rem}
  p{font-size:.875rem;color:#a1a1aa;margin:0 0 1.5rem}
  a{display:inline-block;background:#fff;color:#000;text-decoration:none;font-weight:600;
    padding:.85rem 1.5rem;border-radius:999px}
</style>
</head>
<body>
  <div class="w">
    <h1>Signing you in…</h1>
    <p>If Axiom doesn't open automatically, tap below.</p>
    <a id="go" href="${htmlAttr}">Return to Axiom</a>
  </div>
  <script>
    // Auto-attempt first; the button is the fallback when Chrome blocks it.
    try { window.location.replace(${jsString}); } catch (e) {}
  </script>
</body>
</html>`);
}

// GET /api/auth/google — redirect to Google OAuth consent
router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const callbackUrl = encodeURIComponent(process.env.GOOGLE_CALLBACK_URL!);
  const scope = encodeURIComponent('openid email profile');
  // Encode mobile redirect_uri in state so it survives the OAuth round-trip.
  // Validated here as well as on the callback so a bad target fails before the
  // user is ever sent to Google, rather than after they've approved consent.
  const mobileRedirect = safeRedirectTarget(req.query.redirect_uri as string | undefined);
  const nonce = crypto.randomBytes(16).toString('base64url');
  res.cookie(OAUTH_STATE_COOKIE, nonce, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: OAUTH_STATE_TTL_MS, path: '/api/auth' });
  const stateParam = `&state=${encodeURIComponent(encodeOAuthState(mobileRedirect, nonce))}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=${scope}&access_type=offline${stateParam}`;
  res.redirect(url);
});

// GET /api/auth/google/callback — handle OAuth code exchange
router.get('/auth/google/callback', async (req, res) => {
  // Parse mobile redirect_uri from state early so errors can redirect back to the app
  const stateResult = decodeOAuthState(req.query.state as string | undefined, req.cookies?.[OAUTH_STATE_COOKIE]);
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth' });
  const mobileRedirect = stateResult.mobileRedirect;

  const errorRedirect = mobileRedirect
    ? `${mobileRedirect}?auth=error`
    : `${process.env.FRONTEND_URL}/login?auth=error`;

  if (!stateResult.ok) {
    console.warn(`[auth] rejected oauth callback: state ${stateResult.reason}`);
    return redirectToApp(res, errorRedirect);
  }

  const code = req.query.code as string;
  if (!code) {
    return redirectToApp(res, errorRedirect);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json() as any;
    if (!tokens.id_token) {
      return res.redirect(errorRedirect);
    }

    // Decode id_token (JWT, no need to verify signature for profile data since we trust Google's response)
    const [, payload] = tokens.id_token.split('.');
    const profile = JSON.parse(Buffer.from(payload, 'base64url').toString());

    const { sub: googleId, email, email_verified: emailVerifiedClaim } = profile;
    const name: string | null = typeof profile.name === 'string' ? profile.name.trim().slice(0, DISPLAY_NAME_MAX) || null : null;

    // Upsert user. Matching an existing row by email is only safe when Google
    // vouches for the address; otherwise an attacker-controlled Google account
    // with an unverified email could be attached to someone else's account.
    let existingUser = await prisma.user.findUnique({ where: { googleId } });
    if (!existingUser && email && emailVerifiedClaim === true) {
      existingUser = await prisma.user.findUnique({ where: { email } });
    }
    const isNewUser = !existingUser;

    let user;
    if (existingUser) {
      const upgradeData: Record<string, unknown> = {
        googleId,
        name: name || existingUser.name,
        email: email || existingUser.email,
        // Google has verified this email — mark it so the OTP gate never
        // fires for an OAuth user who happens to have an unverified row.
        ...(existingUser.emailVerified ? {} : { emailVerified: true, emailVerifiedAt: new Date() }),
        // A row that was registered with a password but never verified may
        // have been created by someone else squatting this email. The real
        // owner is signing in now via Google, so drop the unproven password
        // instead of silently sharing the account with whoever set it.
        ...(!existingUser.emailVerified && existingUser.hashedPassword ? { hashedPassword: null } : {}),
      };
      // Silently upgrade whitelisted emails
      const resolvedEmail = email || existingUser.email;
      if (existingUser.tier === 'free' && tierForEmail(resolvedEmail) === 'pro') {
        upgradeData.tier = 'pro';
      }
      user = await prisma.user.update({ where: { id: existingUser.id }, data: upgradeData });
    } else {
      user = await prisma.user.create({
        data: {
          googleId, email, name,
          tier: tierForEmail(email),
          unitPreference: detectUnitPreference({ timezone: req.headers['x-timezone'] as string | undefined, acceptLanguage: req.headers['accept-language'] }),
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Onboarding test accounts restart the funnel on every sign-in. The
    // allowlist check lives inside the helper, so this is a no-op for every
    // real user and a forgotten guard here cannot wipe one.
    await resetOnboardingTestAccount(user.id, user.email);

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    scheduleWelcomeEmail(user.id);
    sendAuthSMS(`${isNewUser ? '🆕 New Google signup' : '🔑 Google login'}: ${user.name || 'User'} (${user.email || 'no email'}) [${user.tier}]`);
    posthog.identify({
      distinctId: user.id,
      properties: {
        $set: { name: user.name, email: user.email, tier: user.tier },
        ...(isNewUser ? { $set_once: { created_at: new Date().toISOString() } } : {}),
      },
    });
    posthog.capture({
      distinctId: user.id,
      event: 'user_google_oauth_completed',
      properties: { is_new_user: isNewUser, tier: user.tier },
    });

    if (mobileRedirect) {
      const needsDob = isNewUser && !user.dateOfBirth ? '&needsDob=1' : '';
      redirectToApp(res, `${mobileRedirect}?token=${token}${needsDob}`);
    } else {
      // The web frontend uses the token as a Bearer fallback (cross-domain
      // cookies may be blocked). It rides in the URL FRAGMENT: fragments are
      // never sent to a server, so the token stays out of access logs, Referer
      // headers and analytics' $current_url. login.tsx reads location.hash.
      res.set('Cache-Control', 'no-store');
      res.redirect(`${process.env.FRONTEND_URL}/login#auth=success&token=${encodeURIComponent(token)}`);
    }
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    redirectToApp(res, errorRedirect);
  }
});

// POST /api/auth/apple — Sign in with Apple (mobile)
router.post('/auth/apple', authLimiter, async (req, res) => {
  const { identityToken, fullName } = req.body;
  if (!identityToken || typeof identityToken !== 'string') {
    return res.status(400).json({ error: 'identityToken required' });
  }

  // Decode token without verifying to log the actual aud claim
  try {
    const [, payloadB64] = identityToken.split('.');
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    console.log('[Apple] token aud:', decoded.aud, '| exp:', new Date(decoded.exp * 1000).toISOString());
  } catch { /* ignore decode errors, real verification below will catch them */ }

  try {
    // Verify the Apple identity token against Apple's public keys
    const applePayload = await appleSignin.verifyIdToken(identityToken, {
      // host.exp.Exponent is the audience Apple stamps on tokens minted inside
      // Expo Go — for EVERY project, not just ours — so accepting it in prod
      // would let any Expo Go app's Sign-in-with-Apple tokens log into Axiom.
      audience: IS_PROD
        ? ['io.axiomtraining.app', 'com.clubscentra.app']
        : ['io.axiomtraining.app', 'com.clubscentra.app', 'host.exp.Exponent'],
      ignoreExpiration: false,
    }) as any;

    const appleId: string = applePayload.sub;
    // Apple only sends email on first sign-in; may be null on subsequent logins
    const email: string | null = applePayload.email ?? null;
    // fullName is sent by the device only on first auth — use it if provided
    // Arrives in the request body, so it gets the display-name rules: capped,
    // reserved names refused, moderated. A name that fails is dropped (the user
    // can set one later) rather than failing the sign-in.
    let name: string | null = null;
    const given = typeof fullName?.givenName === 'string' ? fullName.givenName : '';
    const family = typeof fullName?.familyName === 'string' ? fullName.familyName : '';
    const rawName = [given, family].map((p) => p.trim()).filter(Boolean).join(' ').slice(0, DISPLAY_NAME_MAX).trim();
    if (rawName && !checkReservedName(rawName)) {
      const verdict = await moderateText(rawName, 'display_name', null);
      if (verdict.allowed) name = rawName;
    }

    // Upsert: find by appleId first, then by email — but only when Apple
    // vouches for the address (the claim arrives as true or the string "true").
    const appleEmailVerified = applePayload.email_verified === true || applePayload.email_verified === 'true';
    let existingUser = await prisma.user.findUnique({ where: { appleId } });
    if (!existingUser && email && appleEmailVerified) {
      existingUser = await prisma.user.findUnique({ where: { email } });
    }
    const isNewUser = !existingUser;

    let user;
    if (existingUser) {
      const resolvedEmail = email || existingUser.email;
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          appleId,
          ...(name && !existingUser.name ? { name } : {}),
          ...(email && !existingUser.email ? { email } : {}),
          // Apple has verified this email — bypass the OTP gate.
          ...(existingUser.emailVerified ? {} : { emailVerified: true, emailVerifiedAt: new Date() }),
          // See the Google path: never inherit a password nobody proved.
          ...(!existingUser.emailVerified && existingUser.hashedPassword ? { hashedPassword: null } : {}),
          ...(existingUser.tier === 'free' && tierForEmail(resolvedEmail) === 'pro' ? { tier: 'pro' } : {}),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          appleId, email, name,
          tier: tierForEmail(email),
          unitPreference: detectUnitPreference({ timezone: req.headers['x-timezone'] as string | undefined, acceptLanguage: req.headers['accept-language'] }),
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Onboarding test accounts restart the funnel on every sign-in. The
    // allowlist check lives inside the helper, so this is a no-op for every
    // real user and a forgotten guard here cannot wipe one.
    await resetOnboardingTestAccount(user.id, user.email);

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    scheduleWelcomeEmail(user.id);
    sendAuthSMS(`${isNewUser ? '🆕 New Apple signup' : '🔑 Apple login'}: ${user.name || 'User'} (${user.email || 'no email'}) [${user.tier}]`);
    posthog.identify({
      distinctId: user.id,
      properties: {
        $set: { name: user.name, email: user.email, tier: user.tier },
        ...(isNewUser ? { $set_once: { created_at: new Date().toISOString() } } : {}),
      },
    });
    posthog.capture({
      distinctId: user.id,
      event: 'user_apple_signin_completed',
      properties: { is_new_user: isNewUser, tier: user.tier },
    });
    res.json({ user: { id: user.id, name: user.name, email: user.email, tier: user.tier }, token, accessToken: token, needsDobCheck: isNewUser && !user.dateOfBirth });
  } catch (err: any) {
    posthog.captureException(err);
    console.error('Apple auth error:', err);
    res.status(401).json({ error: 'Apple identity token verification failed' });
  }
});

// POST /api/auth/set-dob — age verification for OAuth new users
router.post('/auth/set-dob', requireAuth, async (req, res) => {
  try {
    const { dateOfBirth } = req.body;
    if (!dateOfBirth || typeof dateOfBirth !== 'string') {
      return res.status(400).json({ error: 'dateOfBirth required' });
    }
    const ageError = validateAge(dateOfBirth);
    if (ageError) {
      // Under 13 (COPPA): we may not keep the account at all. This route is
      // the age gate for OAuth sign-ups, which create the row before asking,
      // so the row goes now. Only when no DOB is on file — an existing
      // account's stored DOB is not overwritten by a single request.
      if (isUnderage(dateOfBirth)) {
        const current = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { dateOfBirth: true } });
        if (current && !current.dateOfBirth) {
          const r = await deleteUserAccount(req.user!.id, 'underage');
          if (r.ok) {
            res.clearCookie('liftoff_jwt', { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? 'none' : 'lax' });
            return res.status(400).json({ error: ageError, reason: 'underage', accountDeleted: true });
          }
          console.error(`[set-dob] underage account ${req.user!.id} could not be deleted: ${r.error}`);
        }
        return res.status(400).json({ error: ageError, reason: 'underage' });
      }
      return res.status(400).json({ error: ageError });
    }
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { dateOfBirth: new Date(dateOfBirth) },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('set-dob error:', err);
    res.status(500).json({ error: 'Could not save date of birth' });
  }
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie('liftoff_jwt', { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? 'none' : 'lax' });
  res.json({ success: true });
});

// POST /api/auth/logout-all — sign out every device, this one included.
router.post('/auth/logout-all', requireAuth, async (req, res) => {
  try {
    await bumpTokenVersion(req.user!.id);
    res.clearCookie('liftoff_jwt', { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? 'none' : 'lax' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('logout-all error:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn\'t sign out other devices. Try again.' });
  }
});

// POST /api/auth/consent — record Terms / health-data / marketing consent for
// an existing account (OAuth sign-ups never see the register form). Accepting
// is timestamped with CURRENT_TERMS_VERSION; health and marketing consent can
// be withdrawn by sending false.
router.post('/auth/consent', requireAuth, async (req, res) => {
  try {
    const c = consentSchema.parse(req.body ?? {});
    const data = consentData(c);
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to record.' });
    const u = await prisma.user.update({
      where: { id: req.user!.id },
      data: data as any,
      select: { acceptedTermsAt: true, termsVersion: true, healthConsentAt: true, marketingConsentAt: true } as any,
    });
    res.json({ consent: consentView(u) });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    console.error('consent error:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn\'t save that. Try again.' });
  }
});

// GET /api/auth/me
router.get('/auth/me', requireAuth, async (req, res) => {
  // Per-account payload (user + feature flags) behind a Bearer token on a URL
  // that never changes. Without this, iOS's URL cache answered a sign-in's
  // /auth/me with the PREVIOUS account's response — flags included — so a
  // freshly allowlisted tester was routed as if every flag were off.
  res.set('Cache-Control', 'no-store, private');
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        tier: true,
        heightCm: true,
        weightKg: true,
        goalWeightKg: true,
        unitPreference: true,
        foodRegion: true,
        trainingAge: true,
        equipment: true,
        constraintsText: true,
        dateOfBirth: true,
        coachGoal: true,
        coachBudget: true,
        coachOnboardingDone: true,
        coachProfile: true,
        savedProgram: true,
        programStartDate: true,
        username: true,
        avatarBase64: true,
        subtractWorkoutBurnFromCalories: true,
        referredByCode: true,
        tokenVersion: true,
        acceptedTermsAt: true,
        termsVersion: true,
        healthConsentAt: true,
        marketingConsentAt: true,
        institutionMemberships: {
          where: { active: true },
          include: {
            institution: { select: { id: true, name: true, slug: true, logoUrl: true } },
          },
        },
      } as any
    }) as any;
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Re-issue JWT so tier changes (e.g. Stripe upgrades) take effect immediately
    const freshToken = issueToken({ id: user.id, email: user.email, tier: user.tier, tokenVersion: user.tokenVersion });
    res.cookie('liftoff_jwt', freshToken, COOKIE_OPTS);

    // Shape institution memberships for frontend consumption
    const institutions = (user as any).institutionMemberships.map((m: any) => ({
      role: m.role,
      joinedAt: m.joinedAt,
      institution: m.institution,
    }));

    const {
      institutionMemberships: _, tokenVersion: _tv,
      acceptedTermsAt: _a, termsVersion: _t, healthConsentAt: _h, marketingConsentAt: _m,
      ...userFields
    } = user as any;
    // OAuth sign-ups have no DOB until the client asks; it must keep asking.
    const needsDob = !user.dateOfBirth;
    // Server-owned feature flags the client must not guess at. The onboarding
    // form hook ships behind a kill switch, and without telling the client we
    // would still show the whole capture flow and only fail on upload — the
    // user films a set for nothing. Sent as a flag rather than inferred from
    // a probe so the decision has one owner.
    res.json({
      user: { ...userFields, institutions, isAdmin: isAdminEmail(user.email), needsDob },
      needsDob,
      consent: consentView(user),
      features: {
        onboardingFormHook: onboardingHookAvailableFor(user.id, user.email),
        diagnosticFirstOnboarding: diagnosticFirstAvailableFor(user.id, user.email),
        liftDiagnosticConversation: liftConversationAvailableFor(user.id, user.email),
        // Classic paywall: straight into the app, coach tab Pro-only.
        directEntryPaywall: directEntryPaywallEnabled(),
        // Disposable onboarding-test account. The client clears its own
        // device-local first-run keys when this is set — the server reset
        // alone is invisible, because the gates that skip the cold start
        // live in AsyncStorage, not in this payload.
        onboardingTestAccount: isOnboardingTestAccount(user.id, user.email),
        // Agent-first v2 mobile shell (app/(v2)/). Allow-listed dogfood first.
        uiV2: uiV2AvailableFor(user.id, user.email),
        wearables: wearablesAvailableFor(user.id, user.email),
        proactive: proactiveAvailableFor(user.id, user.email),
        // Personal-training (human trainer) dashboard at /personal-training.
        personalTraining: personalTrainingAvailableFor(user.id, user.email),
        // Freestyle release kill switches (services/featureFlags.ts).
        freestyle: freestyleAvailableFor(user.id, user.email),
        logAdaptation: logAdaptationAvailableFor(user.id, user.email),
        phaseInference: phaseInferenceAvailableFor(user.id, user.email),
        mealPhotoV2: mealPhotoV2AvailableFor(user.id, user.email),
        webFoodSearch: webFoodSearchAvailableFor(user.id, user.email),
        logReview: logReviewAvailableFor(user.id, user.email),
        awayDigest: awayDigestAvailableFor(user.id, user.email),
        swapV2: swapV2AvailableFor(user.id, user.email),
      },
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PUT /api/auth/profile
const profileSchema = z.object({
  // Was unbounded. The display name renders in every feed row, comment and push
  // notification, so it needs both a length cap and (below) a moderation pass.
  name: z.string().min(1).max(60).optional(),
  // Were bare z.number(). Bodyweight feeds TDEE which feeds the whole macro
  // plan; height feeds the same chain. A 900 cm user poisons every downstream
  // calculation, so these are now bounded to the physically possible.
  heightCm: bounded('heightCm', 'Height').optional(),
  weightKg: bounded('bodyWeightKg', 'Weight').optional(),
  unitPreference: z.enum(['metric', 'imperial']).optional(),
  // Which food-composition data and prompt vocabulary meal logging should use.
  foodRegion: z.enum(['global', 'ng', 'gm', 'wa']).optional(),
  trainingAge: z.string().optional(),
  equipment: z.string().optional(),
  constraintsText: z.string().optional(),
  dateOfBirth: z.string().optional(),
  coachGoal: z.string().max(500).optional(),
  coachBudget: z.string().max(100).optional(),
  coachOnboardingDone: z.boolean().optional(),
  coachProfile: z.string().optional(), // JSON stringified full interview answers
  // Subtract estimated workout calorie burn from the daily calorie display.
  // Default true; off for users whose nutrition plan already assumes a high
  // activity multiplier.
  subtractWorkoutBurnFromCalories: z.boolean().optional(),
});

router.put('/auth/profile', requireAuth, async (req, res) => {
  try {
    const data = profileSchema.parse(req.body);

    // The display name is fanned out to other users (feed, comments, pushes),
    // so it goes through the same checks as any other user-visible text.
    if (data.name !== undefined) {
      const reserved = checkReservedName(data.name);
      if (reserved) return res.status(400).json({ error: reserved });
      const verdict = await moderateText(data.name, 'display_name', req.user!.id);
      if (!verdict.allowed) return res.status(400).json({ error: verdict.message });
    }

    // Same age gate as /auth/set-dob — this route used to accept any date.
    if (data.dateOfBirth) {
      const ageError = validateAge(data.dateOfBirth);
      if (ageError) return res.status(400).json({ error: ageError });
    }

    // Values inside the hard bounds but outside the plausible band are saved
    // and reported back, never rejected. A 180 kg powerlifter is real; a hard
    // gate there would be a bug, not a safeguard.
    const warnings = [
      implausibilityWarning('heightCm', data.heightCm, 'Height'),
      implausibilityWarning('bodyWeightKg', data.weightKg, 'Weight'),
    ].filter((w): w is string => w !== null);

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...data,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined
      },
      select: {
        id: true, name: true, email: true, tier: true,
        heightCm: true, weightKg: true, unitPreference: true, foodRegion: true, trainingAge: true,
        equipment: true, constraintsText: true,
        coachGoal: true, coachBudget: true, coachOnboardingDone: true, coachProfile: true, savedProgram: true,
        subtractWorkoutBurnFromCalories: true,
      }
    });
    // The cached strength profile bakes the unit into its server-rendered
    // text (AI insights, recovery notes) — rebuild it when the unit flips
    // so the Strength page doesn't serve lbs strings to a kg user.
    // Dynamic import: strength.ts transitively constructs an OpenAI client
    // at module load, which auth's test suite (and any keyless env) can't.
    if (data.unitPreference !== undefined) {
      // The Settings toggle (and Anakin's preference tool) land here: it's their choice now, never auto-switched.
      void import('../services/autoUnits.js').then(({ markUnitsManual }) => markUnitsManual(req.user!.id)).catch(() => {});
      import('./strength.js')
        .then(({ recomputeStrengthProfileInBackground }) => recomputeStrengthProfileInBackground(req.user!.id))
        .catch((err) => console.error('[auth] strength recompute after unit change failed:', err));
    }
    res.json({ user, ...(warnings.length ? { warnings } : {}) });
  } catch (err: any) {
    // Bounds failures are the user's to fix, so they need the specific message
    // rather than the generic 500 this used to return for everything.
    if (err?.name === 'ZodError') {
      return res.status(400).json({
        error: err.errors?.[0]?.message ?? 'Invalid profile data',
        details: err.errors,
      });
    }
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/auth/push-token — store Expo push token for the authenticated user
router.put('/auth/push-token', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token required' });
    }
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { expoPushToken: token },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Push token update error:', err);
    res.status(500).json({ error: 'Failed to save push token' });
  }
});

// PUT /api/auth/reengagement-opt-out — toggle re-engagement notifications
router.put('/auth/reengagement-opt-out', requireAuth, async (req, res) => {
  try {
    const { optOut } = req.body;
    if (typeof optOut !== 'boolean') {
      return res.status(400).json({ error: 'optOut (boolean) required' });
    }
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { reengagementOptOut: optOut },
    });
    res.json({ success: true, reengagementOptOut: optOut });
  } catch (err) {
    console.error('Reengagement opt-out error:', err);
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

// GET /api/auth/check-username?username=X
router.get('/auth/check-username', requireAuth, async (req, res) => {
  try {
    const username = (req.query.username as string)?.trim();
    if (!username || username.length < 3) return res.status(400).json({ error: 'Username too short' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores' });
    const existing = await prisma.user.findUnique({ where: { username } });
    res.json({ available: !existing || existing.id === req.user!.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check username' });
  }
});

// PUT /api/auth/username
router.put('/auth/username', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== 'string') return res.status(400).json({ error: 'username required' });
    const cleaned = username.trim();
    if (cleaned.length < 3 || cleaned.length > 30) return res.status(400).json({ error: 'Username must be 3-30 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores' });

    // Impersonation ("AxiomSupport" DMing users for their password) is a
    // structural check the classifier can't make; slurs are one it can.
    const reserved = checkReservedName(cleaned);
    if (reserved) return res.status(400).json({ error: reserved });
    const verdict = await moderateText(cleaned, 'username', req.user!.id);
    if (!verdict.allowed) return res.status(400).json({ error: verdict.message });

    try {
      const user = await prisma.user.update({ where: { id: req.user!.id }, data: { username: cleaned } });
      res.json({ username: user.username });
    } catch (e: any) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
      throw e;
    }
  } catch (err: any) {
    if (err.status) throw err;
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// PUT /api/auth/avatar
router.put('/auth/avatar', requireAuth, async (req, res) => {
  try {
    const { avatarBase64 } = req.body;
    if (typeof avatarBase64 !== 'string') return res.status(400).json({ error: 'avatarBase64 required' });
    // Limit the raw upload to ~2MB base64.
    if (avatarBase64.length > 2_800_000) return res.status(413).json({ error: 'Image too large (max ~2MB)' });

    // Avatars are the highest-leverage image on the platform: one explicit
    // upload renders beside every post, comment and DM the user touches, with
    // no way for anyone else to opt out of seeing it. Checked before the write.
    const verdict = await moderateImageBase64(avatarBase64, 'image/jpeg', 'avatar', req.user!.id);
    if (!verdict.allowed) return res.status(400).json({ error: verdict.message });

    // Downscale to a thumbnail before storing. Avatars render at ~36px but were
    // being stored at full camera resolution and embedded per user in every
    // social-feed response. If the image can't be decoded (corrupt, oversized,
    // decompression bomb) the upload is REJECTED — never store bytes we could
    // not decode ourselves.
    let toStore: string;
    try {
      toStore = await resizeAvatarBase64(avatarBase64);
    } catch (e: any) {
      console.warn('[avatar] rejected:', e?.message || e);
      return res.status(typeof e?.status === 'number' ? e.status : 400).json({ error: 'That image could not be processed. Try a smaller JPEG or PNG.' });
    }
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarBase64: toStore } });
    res.json({ success: true });
  } catch (err) {
    console.error('Avatar update error:', err);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// DELETE /api/auth/account — permanently delete the authenticated user's account
// Required by Apple App Store guidelines (June 2022).
// Manually cascade child records in dependency order since not all relations
// have onDelete: Cascade defined in the schema.
// GET /api/auth/export — self-serve data export (GDPR Art. 15/20, CCPA/CPRA).
//
// The privacy policy has always promised both Access and Portability; this is
// the mechanism behind those sentences. Rate-limited because assembling the
// document touches ~20 tables.
// A browser opening the export can't send the app's bearer token (the v2
// "Download my data" row 401'd). /auth/export-link returns a URL carrying a
// 5-minute, single-use, export-only token; /auth/export accepts it via ?t=.
const EXPORT_BASE = process.env.PUBLIC_API_URL || 'https://api.airthreads.ai';
router.get('/auth/export-link', requireAuth, async (req, res) => {
  // Scoped (purpose:'export' — refused everywhere but /auth/export), short
  // (5 min), single-use (jti, consumed by requireExportToken) and bound to the
  // current tokenVersion, so it can't outlive a logout-all.
  const v = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { tokenVersion: true } as any }).catch(() => null) as any;
  const t = jwt.sign(
    { id: req.user!.id, purpose: 'export', tv: v?.tokenVersion ?? 0, jti: crypto.randomUUID() },
    process.env.JWT_SECRET!,
    { expiresIn: EXPORT_TOKEN_TTL_SEC },
  );
  res.set('Cache-Control', 'no-store');
  res.json({ url: `${EXPORT_BASE}/api/auth/export?t=${encodeURIComponent(t)}`, expiresInSec: EXPORT_TOKEN_TTL_SEC });
});

router.get('/auth/export', requireExportToken, outboundNotifyLimiter, async (req, res) => {
  try {
    const data = await buildUserDataExport(req.user!.id);

    // Content-Disposition so browsers save rather than render it, and
    // no-store so the export doesn't linger in an intermediary cache.
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="axiom-data-export-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('[auth/export] failed:', err?.message ?? err);
    res.status(500).json({ error: 'Could not build your data export. Please try again.' });
  }
});

// GET /api/auth/account/deletion-preview — what deleting the account removes,
// and what happens to billing, for the confirm screen (v2 A-03). Read-only.
router.get('/auth/account/deletion-preview', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const count = async (fn: () => Promise<number>) => { try { return await fn(); } catch { return 0; } };
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, stripeCustomerId: true, stripeSubStatus: true, appleOriginalTransactionId: true, googlePurchaseToken: true } });
    const [workouts, meals, weighIns, posts, messages, friends] = await Promise.all([
      count(() => prisma.workoutLog.count({ where: { userId } })),
      count(() => prisma.mealEntry.count({ where: { userId } })),
      count(() => prisma.bodyWeightLog.count({ where: { userId } })),
      count(() => (prisma as any).sharedItem.count({ where: { sharerId: userId } })),
      count(() => (prisma as any).message.count({ where: { senderId: userId } })),
      count(() => (prisma as any).friendship.count({ where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] } })),
    ]);
    const stripeLive = !!u?.stripeCustomerId && ['active', 'trialing', 'past_due'].includes(u?.stripeSubStatus ?? '');
    const rail = stripeLive ? 'stripe' : u?.appleOriginalTransactionId ? 'apple' : u?.googlePurchaseToken ? 'google' : 'none';
    let renewsOn: string | null = null;
    if (stripeLive && process.env.STRIPE_SECRET_KEY) renewsOn = await liveSubscriptionEnd(u!.stripeCustomerId!).catch(() => null);
    res.json({
      counts: { workouts, meals, weighIns, posts, messages, friends },
      billing: { pro: u?.tier === 'pro' || u?.tier === 'enterprise', rail, renewsOn,
        // Stripe is cancelled for them on delete; the stores can't be cancelled from here.
        cancelledOnDelete: rail === 'stripe' },
    });
  } catch (err: any) {
    console.error('deletion-preview error:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn\'t load that. Try again.' });
  }
});

// Account deletion, shared by DELETE /auth/account and the under-13 path of
// /auth/set-dob. Manually cascades child records in dependency order since not
// all relations have onDelete: Cascade defined in the schema.
type DeleteResult = { ok: true; warnings: string[] } | { ok: false; status: number; error: string };
async function deleteUserAccount(userId: string, reason: 'user_request' | 'underage'): Promise<DeleteResult> {
  // Deleting a relation that doesn't exist in this build (a model added on a
  // branch that hasn't been pushed to this DB yet) must not abort the whole
  // transaction and strand the user with a half-deleted account. Each step is
  // therefore best-effort; the final user.delete is the one that must succeed,
  // and it will fail loudly if any FK is genuinely still pointing at the row.
  // Every skipped step is logged at error level and returned as a warning:
  // a silently skipped table is personal data we said we erased.
  const warnings: string[] = [];
  const tryDelete = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e: any) {
      warnings.push(label);
      console.error(`[account-delete] step ${label} failed for ${userId}: ${e?.message ?? e}`);
    }
  };

  const account = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, stripeCustomerId: true } });
  if (!account) return { ok: false, status: 404, error: 'Account not found.' };
  const email = account.email ?? null;

  // Stop billing first. A web (Stripe) subscriber who deletes their account
  // would otherwise keep being charged with no account left to cancel from.
  // If Stripe can't be reached, nothing is deleted — they can try again.
  // App Store / Google Play subscriptions can't be cancelled by us; the app
  // tells those users to cancel in their store before deleting.
  if (account.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
    try {
      const n = await cancelActiveSubscriptions(account.stripeCustomerId);
      if (n) console.log(`[account-delete] cancelled ${n} Stripe subscription(s) for ${userId}`);
    } catch (e: any) {
      console.error(`[account-delete] Stripe cancel failed for ${userId}:`, e?.message ?? e);
      return { ok: false, status: 502, error: 'We couldn\'t cancel your subscription, so nothing was deleted. Try again in a minute.' };
    }
  }

  // Practices this user was the LAST active coach of. Once they go, nobody can
  // see or manage what was imported there about prospects, so that data is
  // orphaned personal data about third parties and goes with them. Computed
  // before the transaction removes the memberships.
  let solePractices: string[] = [];
  try {
    const coached = await prisma.institutionMember.findMany({ where: { userId, role: 'coach', active: true }, select: { institutionId: true } });
    for (const { institutionId } of coached) {
      const others = await prisma.institutionMember.count({ where: { institutionId, role: 'coach', active: true, NOT: { userId } } });
      if (others === 0) solePractices.push(institutionId);
    }
  } catch (e: any) {
    warnings.push('ptImported:solePractices');
    console.error(`[account-delete] sole-practice lookup failed for ${userId}: ${e?.message ?? e}`);
    solePractices = [];
  }

  await prisma.$transaction(async (tx) => {
    const t = tx as any;

    // 1. Leaf records with no further children
    await tryDelete('diagnosticMessage', () => t.diagnosticMessage.deleteMany({ where: { session: { userId } } }));
    await tryDelete('exerciseSnapshot', () => t.exerciseSnapshot.deleteMany({ where: { session: { userId } } }));
    await tryDelete('generatedPlan', () => t.generatedPlan.deleteMany({ where: { session: { userId } } }));
    await tryDelete('mealEntry', () => t.mealEntry.deleteMany({ where: { userId } }));
    await tryDelete('nutritionLog', () => t.nutritionLog.deleteMany({ where: { userId } }));
    await tryDelete('nutritionPlan', () => t.nutritionPlan.deleteMany({ where: { userId } }));
    await tryDelete('bodyWeightLog', () => t.bodyWeightLog.deleteMany({ where: { userId } }));
    await tryDelete('progressMoment', () => t.progressMoment.deleteMany({ where: { userId } }));
    await tryDelete('wellnessCheckin', () => t.wellnessCheckin.deleteMany({ where: { userId } }));
    await tryDelete('activityLog', () => t.activityLog.deleteMany({ where: { userId } }));
    await tryDelete('savedFood', () => t.savedFood.deleteMany({ where: { userId } }));
    await tryDelete('recipe', () => t.recipe.deleteMany({ where: { userId } }));
    await tryDelete('workoutLog', () => t.workoutLog.deleteMany({ where: { userId } }));
    await tryDelete('scheduleOverride', () => t.scheduleOverride.deleteMany({ where: { userId } }));
    await tryDelete('completedProgram', () => t.completedProgram.deleteMany({ where: { userId } }));
    await tryDelete('formAnalysis', () => t.formAnalysis.deleteMany({ where: { userId } }));
    await tryDelete('featureUsage', () => t.featureUsage.deleteMany({ where: { userId } }));
    await tryDelete('savedArticle', () => t.savedArticle.deleteMany({ where: { userId } }));
    await tryDelete('userFeedView', () => t.userFeedView.deleteMany({ where: { userId } }));
    await tryDelete('agentMemory', () => t.agentMemory.deleteMany({ where: { userId } }));
    await tryDelete('agentConversation', () => t.agentConversation.deleteMany({ where: { userId } }));

    // 2. Sessions (after their children are gone)
    await tryDelete('session', () => t.session.deleteMany({ where: { userId } }));

    // 3. Social / messaging — both directions of every relation
    await tryDelete('postComment', () => t.postComment.deleteMany({ where: { authorId: userId } }));
    await tryDelete('postReaction', () => t.postReaction.deleteMany({ where: { userId } }));
    await tryDelete('message', () => t.message.deleteMany({
      where: { OR: [{ senderId: userId }, { conversation: { OR: [{ participantAId: userId }, { participantBId: userId }] } }] },
    }));
    await tryDelete('directConversation', () => t.directConversation.deleteMany({
      where: { OR: [{ participantAId: userId }, { participantBId: userId }] },
    }));
    // Comments and reactions by *other* users on this user's posts have to go
    // before the posts themselves, or the FK blocks the delete.
    await tryDelete('postComment:onOwnPosts', () => t.postComment.deleteMany({ where: { post: { sharerId: userId } } }));
    await tryDelete('postReaction:onOwnPosts', () => t.postReaction.deleteMany({ where: { post: { sharerId: userId } } }));
    await tryDelete('sharedItem', () => t.sharedItem.deleteMany({
      where: { OR: [{ sharerId: userId }, { recipientId: userId }] },
    }));
    await tryDelete('friendship', () => t.friendship.deleteMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    }));
    await tryDelete('userInvite', () => t.userInvite.deleteMany({
      where: { OR: [{ inviterId: userId }, { usedByUserId: userId }] },
    }));

    // 4. Groups, institutions, partner workouts
    await tryDelete('groupMessage', () => t.groupMessage.deleteMany({ where: { senderId: userId } }));
    await tryDelete('groupMember', () => t.groupMember.deleteMany({ where: { userId } }));
    // GroupChat.createdById is RESTRICT, so chats this user created block
    // the delete. Members and messages both cascade from GroupChat, so
    // removing the chat is enough. This orphans the other members' history
    // — the same outcome as the creator deleting the chat by hand.
    // Reassigning ownership instead would be a product decision, not a
    // deletion one.
    await tryDelete('groupChat', () => t.groupChat.deleteMany({ where: { createdById: userId } }));
    await tryDelete('institutionMember', () => t.institutionMember.deleteMany({ where: { userId } }));
    await tryDelete('partnerWorkoutMember', () => t.partnerWorkoutMember.deleteMany({ where: { userId } }));
    await tryDelete('partnerWorkout', () => t.partnerWorkout.deleteMany({ where: { creatorId: userId } }));

    // 4b. Adaptive progression. AdaptationProposal.userId is RESTRICT, so a
    //     user who was ever offered a progression change cannot be deleted
    //     until these go. Missing this is what made account deletion fail
    //     with an unnamed P2003 (SQLite reports constraint: null) for every
    //     user who had one.
    await tryDelete('adaptationProposal', () => t.adaptationProposal.deleteMany({ where: { userId } }));
    // 4c. Personal-training dashboard. These tables hold plain ids rather
    //     than FKs, so nothing cascades: what a trainer's dashboard stored
    //     about this person as a CLIENT (check-in answers, drafted
    //     messages, briefing cards, reports, notifications) has to be
    //     removed here, and so does what they stored as a TRAINER.
    await tryDelete('ptCheckIn', () => t.ptCheckIn.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptCheckInSchedule', () => t.ptCheckInSchedule.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptBriefingItem', () => t.ptBriefingItem.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptBriefing', () => t.ptBriefing.deleteMany({ where: { trainerId: userId } }));
    await tryDelete('ptDraft', () => t.ptDraft.deleteMany({ where: { OR: [{ clientId: userId }, { trainerId: userId }] } }));
    await tryDelete('ptReport', () => t.ptReport.deleteMany({ where: { OR: [{ clientId: userId }, { trainerId: userId }] } }));
    await tryDelete('ptNotification', () => t.ptNotification.deleteMany({ where: { OR: [{ clientId: userId }, { trainerId: userId }] } }));
    await tryDelete('ptNotificationSettings', () => t.ptNotificationSettings.deleteMany({ where: { trainerId: userId } }));
    await tryDelete('ptAnakinThread', () => t.ptAnakinThread.deleteMany({ where: { trainerId: userId } }));
    await tryDelete('ptScheduledQuestion', () => t.ptScheduledQuestion.deleteMany({ where: { trainerId: userId } }));
    await tryDelete('ptNote', () => t.ptNote.deleteMany({ where: { OR: [{ clientId: userId }, { trainerId: userId }] } }));
    // What a trainer imported about this person before they joined goes with them.
    await tryDelete('ptImported', async () => {
      const linked = await t.ptProspect.findMany({ where: { userId }, select: { id: true } });
      const ids = linked.map((p: { id: string }) => p.id);
      await t.ptImportedWorkout.deleteMany({ where: { prospectId: { in: ids } } });
      await t.ptImportedWeight.deleteMany({ where: { prospectId: { in: ids } } });
      await t.ptProspect.deleteMany({ where: { id: { in: ids } } });
    });
    // As a TRAINER: the prospects, workouts and weigh-ins they imported from
    // spreadsheets would otherwise outlive both the trainer and the import
    // row that explains them.
    await tryDelete('ptImported:asTrainer', async () => {
      const imports = await t.ptImport.findMany({ where: { trainerId: userId }, select: { id: true } });
      const importIds = imports.map((i: { id: string }) => i.id);
      if (!importIds.length) return;
      const prospects = await t.ptProspect.findMany({ where: { importId: { in: importIds } }, select: { id: true } });
      const prospectIds = prospects.map((p: { id: string }) => p.id);
      const scope = { OR: [{ importId: { in: importIds } }, { prospectId: { in: prospectIds } }] };
      await t.ptImportedWorkout.deleteMany({ where: scope });
      await t.ptImportedWeight.deleteMany({ where: scope });
      await t.ptProspect.deleteMany({ where: { id: { in: prospectIds } } });
    });
    await tryDelete('ptImport', () => t.ptImport.deleteMany({ where: { trainerId: userId } }));
    if (solePractices.length) {
      await tryDelete('ptImported:orphanPractice', async () => {
        const where = { practiceId: { in: solePractices } };
        await t.ptImportedWorkout.deleteMany({ where });
        await t.ptImportedWeight.deleteMany({ where });
        await t.ptProspect.deleteMany({ where });
        await t.ptImport.deleteMany({ where });
      });
    }
    // The coach-platform dossier: what a practice recorded about this person as a client.
    await tryDelete('ptClientProfile', () => t.ptClientProfile.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptClientLink', () => t.ptClientLink.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptContraindication', () => t.ptContraindication.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptGoal', () => t.ptGoal.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptMeasurement', () => t.ptMeasurement.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptProgressPhoto', () => t.ptProgressPhoto.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptIntake', () => t.ptIntake.deleteMany({ where: { clientId: userId } }));
    await tryDelete('ptNutritionTarget', () => t.ptNutritionTarget.deleteMany({ where: { clientId: userId } }));
    // The audit trail keeps that an action happened, not what was written to or about this person.
    await tryDelete('ptAuditLog', () => t.ptAuditLog.updateMany({ where: { clientId: userId }, data: { clientId: null, originalText: null, editedText: null } }));
    // Keyed by email, not a user FK, so the cascade doesn't reach it.
    if (email) await tryDelete('passwordResetCode', () => t.passwordResetCode.deleteMany({ where: { email: email.toLowerCase() } }));

    // 5. Trust & safety. Reports filed BY this user, reports ABOUT them and
    //    the classifier flags on their content all go: each holds an
    //    excerpt of what they wrote, and a re-registration gets a new id
    //    anyway, so keeping them by userId bought no abuse history — only
    //    personal data we had promised to erase.
    await tryDelete('contentReport', () => t.contentReport.deleteMany({ where: { reporterId: userId } }));
    await tryDelete('contentReport:aboutUser', () => t.contentReport.deleteMany({ where: { reportedUserId: userId } }));
    await tryDelete('contentFlag', () => t.contentFlag.deleteMany({ where: { userId } }));
    await tryDelete('userSuspension', () => t.userSuspension.deleteMany({ where: { userId } }));
    // Blog mailing list is keyed by email, not a user FK.
    if (email) await tryDelete('blogSubscriber', () => t.blogSubscriber.deleteMany({ where: { email: email.trim().toLowerCase() } }));

    // 6. Finally remove the user row itself
    await tx.user.delete({ where: { id: userId } });
  });

  // Any token still in circulation now fails requireAuth's lookup (no row).
  invalidateAuthCache(userId);

  // posthog-node can't delete a person; scrub the identifying properties so
  // the analytics profile no longer names them, then record the deletion.
  try {
    posthog.identify({ distinctId: userId, properties: { $set: { email: null, name: null, deleted: true } } });
    posthog.capture({ distinctId: userId, event: 'user_account_deleted', properties: { reason, skipped_steps: warnings.length } });
  } catch { /* analytics never blocks deletion */ }

  if (warnings.length) console.error(`[account-delete] ${userId} deleted with ${warnings.length} skipped step(s): ${warnings.join(', ')}`);
  return { ok: true, warnings };
}

router.delete('/auth/account', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    const r = await deleteUserAccount(userId, 'user_request');
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    // Clear the auth cookie
    res.clearCookie('liftoff_jwt', { httpOnly: true, sameSite: 'none', secure: true });
    res.json({ success: true, warnings: r.warnings });
  } catch (err) {
    posthog.captureException(err, userId);
    console.error('Account deletion error:', err);
    res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }
});

export default router;
