import { Router, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { resizeAvatarBase64 } from '../services/avatarImage.js';
import twilio from 'twilio';
import appleSignin from 'apple-signin-auth';
import posthog from '../services/posthogClient.js';
import { detectUnitPreferenceFromAcceptLanguage, normalizePreference } from '../services/weightUnits.js';
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
import { authLimiter, registerLimiter, outboundNotifyLimiter } from '../middleware/rateLimiter.js';
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
const PRO_TIER_EMAILS = new Set([
  'brian62888@gmail.com',
  'safia.alif.sa@gmail.com',
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

function issueToken(user: { id: string; email: string | null; tier: string }) {
  return jwt.sign(
    { id: user.id, email: user.email, tier: user.tier },
    process.env.JWT_SECRET!,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '30d') as any }
  );
}

// Age gate. Delegates to the shared validator, which additionally rejects
// future dates and impossible ages — the previous check verified only the 13+
// floor, so a DOB in the year 1200 or next century passed and then produced a
// nonsense age everywhere it was consumed.
const validateAge = validateDateOfBirth;

// POST /api/auth/register
const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  referralCode: z.string().optional(),
  // Optional explicit unit preference from the client (e.g. mobile passing its
  // device locale's choice). When omitted we infer from the Accept-Language
  // header. 'metric' | 'imperial'.
  unitPreference: z.enum(['metric', 'imperial']).optional(),
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
    const unitPreference = data.unitPreference
      ?? detectUnitPreferenceFromAcceptLanguage(req.headers['accept-language']);

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
      }
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

router.post('/auth/verify-email', authLimiter, async (req, res) => {
  try {
    const { email, code } = verifyEmailSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'No signup found for this email.' });

    // Idempotent: a user who is already verified shouldn't fail here just
    // because the code row was consumed.
    if (user.emailVerified) {
      const token = issueToken(user);
      res.cookie('liftoff_jwt', token, COOKIE_OPTS);
      return res.json({ user: { id: user.id, name: user.name, email: user.email, tier: user.tier }, token, alreadyVerified: true });
    }

    const result = await verifyEmailCode(email, code);
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

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
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
  'localhost',
  '127.0.0.1',
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
  if (ALLOWED_REDIRECT_HOSTS.has(url.hostname)) return true;
  // Replit preview/deploy domains, matched on the label boundary so
  // "notreplit.app" can't pass.
  if (/\.(replit\.dev|repl\.co|replit\.app)$/.test(url.hostname)) return true;

  return false;
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
  const state = mobileRedirect
    ? encodeURIComponent(Buffer.from(JSON.stringify({ mobileRedirect })).toString('base64'))
    : '';
  const stateParam = state ? `&state=${state}` : '';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=${scope}&access_type=offline${stateParam}`;
  res.redirect(url);
});

// GET /api/auth/google/callback — handle OAuth code exchange
router.get('/auth/google/callback', async (req, res) => {
  // Parse mobile redirect_uri from state early so errors can redirect back to the app
  let mobileRedirect: string | null = null;
  try {
    const rawState = req.query.state as string | undefined;
    if (rawState) {
      const decoded = JSON.parse(Buffer.from(decodeURIComponent(rawState), 'base64').toString());
      // Re-validate on the way back out. `state` is attacker-reachable (it round
      // trips through the browser), so trusting it here would reintroduce the
      // open redirect even with the check on /auth/google.
      mobileRedirect = safeRedirectTarget(decoded.mobileRedirect);
    }
  } catch { /* ignore malformed state */ }

  const errorRedirect = mobileRedirect
    ? `${mobileRedirect}?auth=error`
    : `${process.env.FRONTEND_URL}/login?auth=error`;

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

    const { sub: googleId, email, name } = profile;

    // Upsert user
    let existingUser = await prisma.user.findUnique({ where: { googleId } });
    if (!existingUser && email) {
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
          unitPreference: detectUnitPreferenceFromAcceptLanguage(req.headers['accept-language']),
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
    }

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
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
      // Include token in URL so web frontend can use it as Bearer fallback
      // (cross-domain cookies may be blocked by browser privacy features)
      res.redirect(`${process.env.FRONTEND_URL}/login?auth=success&token=${token}`);
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
      audience: ['io.axiomtraining.app', 'com.clubscentra.app', 'host.exp.Exponent'],
      ignoreExpiration: false,
    }) as any;

    const appleId: string = applePayload.sub;
    // Apple only sends email on first sign-in; may be null on subsequent logins
    const email: string | null = applePayload.email ?? null;
    // fullName is sent by the device only on first auth — use it if provided
    const name: string | null =
      fullName?.givenName || fullName?.familyName
        ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ')
        : null;

    // Upsert: find by appleId first, then by email
    let existingUser = await prisma.user.findUnique({ where: { appleId } });
    if (!existingUser && email) {
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
          ...(existingUser.tier === 'free' && tierForEmail(resolvedEmail) === 'pro' ? { tier: 'pro' } : {}),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          appleId, email, name,
          tier: tierForEmail(email),
          unitPreference: detectUnitPreferenceFromAcceptLanguage(req.headers['accept-language']),
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
    }

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
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
    if (ageError) return res.status(400).json({ error: ageError });
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

// GET /api/auth/me
router.get('/auth/me', requireAuth, async (req, res) => {
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
        institutionMemberships: {
          where: { active: true },
          include: {
            institution: { select: { id: true, name: true, slug: true, logoUrl: true } },
          },
        },
      }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Re-issue JWT so tier changes (e.g. Stripe upgrades) take effect immediately
    const freshToken = issueToken({ id: user.id, email: user.email, tier: user.tier });
    res.cookie('liftoff_jwt', freshToken, COOKIE_OPTS);

    // Shape institution memberships for frontend consumption
    const institutions = (user as any).institutionMemberships.map((m: any) => ({
      role: m.role,
      joinedAt: m.joinedAt,
      institution: m.institution,
    }));

    const { institutionMemberships: _, ...userFields } = user as any;
    res.json({ user: { ...userFields, institutions } });
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
    // being stored at full camera resolution (~68KB base64) and embedded per
    // user in every social-feed response. Resizing to 96px JPEG strips ~96% of
    // that. If decoding fails (corrupt/unsupported image), fall back to the
    // original so the upload still succeeds.
    let toStore = avatarBase64;
    try {
      toStore = await resizeAvatarBase64(avatarBase64);
    } catch (e) {
      console.error('[avatar] resize failed, storing original:', e);
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
router.get('/auth/export', requireAuth, outboundNotifyLimiter, async (req, res) => {
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

router.delete('/auth/account', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    // Deleting a relation that doesn't exist in this build (a model added on a
    // branch that hasn't been pushed to this DB yet) must not abort the whole
    // transaction and strand the user with a half-deleted account. Each step is
    // therefore best-effort; the final user.delete is the one that must succeed,
    // and it will fail loudly if any FK is genuinely still pointing at the row.
    const tryDelete = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e: any) {
        console.warn(`[account-delete] skipped ${label}: ${e?.message ?? e}`);
      }
    };

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
      await tryDelete('institutionMember', () => t.institutionMember.deleteMany({ where: { userId } }));
      await tryDelete('partnerWorkoutMember', () => t.partnerWorkoutMember.deleteMany({ where: { userId } }));
      await tryDelete('partnerWorkout', () => t.partnerWorkout.deleteMany({ where: { creatorId: userId } }));

      // 5. Trust & safety. Reports filed BY this user go; ContentFlag rows are
      //    deliberately retained (userId is not an FK) — an abuse history that
      //    a serial abuser can erase by deleting and re-registering is not an
      //    abuse history. They carry no PII beyond a truncated excerpt.
      await tryDelete('contentReport', () => t.contentReport.deleteMany({ where: { reporterId: userId } }));
      await tryDelete('userSuspension', () => t.userSuspension.deleteMany({ where: { userId } }));

      // 6. Finally remove the user row itself
      await tx.user.delete({ where: { id: userId } });
    });

    posthog.capture({
      distinctId: userId,
      event: 'user_account_deleted',
    });
    // Clear the auth cookie
    res.clearCookie('liftoff_jwt', { httpOnly: true, sameSite: 'none', secure: true });
    res.json({ success: true });
  } catch (err) {
    posthog.captureException(err, userId);
    console.error('Account deletion error:', err);
    res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }
});

export default router;
