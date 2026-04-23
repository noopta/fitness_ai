import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import twilio from 'twilio';
import appleSignin from 'apple-signin-auth';
import posthog from '../services/posthogClient.js';

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

// Helper: validate age >= 13 from a DOB string. Returns error string or null.
function validateAge(dobStr: string): string | null {
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return 'Invalid date of birth.';
  const ageDays = (Date.now() - dob.getTime()) / 86400000;
  if (ageDays < 13 * 365.25) return 'You must be at least 13 years old to use this app.';
  return null;
}

// POST /api/auth/register
const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
});

router.post('/auth/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

    const ageError = validateAge(data.dateOfBirth);
    if (ageError) return res.status(400).json({ error: ageError });

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        hashedPassword,
        dateOfBirth: new Date(data.dateOfBirth),
        tier: tierForEmail(data.email),
      }
    });

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    // Fire-and-forget notification
    sendAuthSMS(`🆕 New Axiom signup: ${data.name} (${data.email})`);
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
      properties: {
        login_method: 'email',
        tier: user.tier,
      },
    });
    res.json({ user: { id: user.id, name: user.name, email: user.email, tier: user.tier }, token });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    posthog.captureException(err);
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

router.post('/auth/login', async (req, res) => {
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

// GET /api/auth/google — redirect to Google OAuth consent
router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const callbackUrl = encodeURIComponent(process.env.GOOGLE_CALLBACK_URL!);
  const scope = encodeURIComponent('openid email profile');
  // Encode mobile redirect_uri in state so it survives the OAuth round-trip
  const mobileRedirect = req.query.redirect_uri as string | undefined;
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
      mobileRedirect = decoded.mobileRedirect || null;
    }
  } catch { /* ignore malformed state */ }

  const errorRedirect = mobileRedirect
    ? `${mobileRedirect}?auth=error`
    : `${process.env.FRONTEND_URL}/login?auth=error`;

  const code = req.query.code as string;
  if (!code) {
    return res.redirect(errorRedirect);
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
      };
      // Silently upgrade whitelisted emails
      const resolvedEmail = email || existingUser.email;
      if (existingUser.tier === 'free' && tierForEmail(resolvedEmail) === 'pro') {
        upgradeData.tier = 'pro';
      }
      user = await prisma.user.update({ where: { id: existingUser.id }, data: upgradeData });
    } else {
      user = await prisma.user.create({
        data: { googleId, email, name, tier: tierForEmail(email) }
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
      res.redirect(`${mobileRedirect}?token=${token}${needsDob}`);
    } else {
      // Include token in URL so web frontend can use it as Bearer fallback
      // (cross-domain cookies may be blocked by browser privacy features)
      res.redirect(`${process.env.FRONTEND_URL}/login?auth=success&token=${token}`);
    }
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(errorRedirect);
  }
});

// POST /api/auth/apple — Sign in with Apple (mobile)
router.post('/auth/apple', async (req, res) => {
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
          ...(existingUser.tier === 'free' && tierForEmail(resolvedEmail) === 'pro' ? { tier: 'pro' } : {}),
        },
      });
    } else {
      user = await prisma.user.create({
        data: { appleId, email, name, tier: tierForEmail(email) },
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
  name: z.string().optional(),
  heightCm: z.number().optional(),
  weightKg: z.number().optional(),
  trainingAge: z.string().optional(),
  equipment: z.string().optional(),
  constraintsText: z.string().optional(),
  dateOfBirth: z.string().optional(),
  coachGoal: z.string().max(500).optional(),
  coachBudget: z.string().max(100).optional(),
  coachOnboardingDone: z.boolean().optional(),
  coachProfile: z.string().optional(), // JSON stringified full interview answers
});

router.put('/auth/profile', requireAuth, async (req, res) => {
  try {
    const data = profileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...data,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined
      },
      select: {
        id: true, name: true, email: true, tier: true,
        heightCm: true, weightKg: true, trainingAge: true,
        equipment: true, constraintsText: true,
        coachGoal: true, coachBudget: true, coachOnboardingDone: true, coachProfile: true, savedProgram: true,
      }
    });
    res.json({ user });
  } catch (err: any) {
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

// PUT /api/auth/reengagement-opt-out — toggle shame/re-engagement notifications
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
    // Limit to ~2MB base64
    if (avatarBase64.length > 2_800_000) return res.status(413).json({ error: 'Image too large (max ~2MB)' });
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarBase64 } });
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
router.delete('/auth/account', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Leaf records with no further children
      await tx.diagnosticMessage.deleteMany({ where: { session: { userId } } });
      await tx.exerciseSnapshot.deleteMany({ where: { session: { userId } } });
      await tx.generatedPlan.deleteMany({ where: { session: { userId } } });
      await tx.mealEntry.deleteMany({ where: { userId } });
      await tx.nutritionLog.deleteMany({ where: { userId } });
      await tx.bodyWeightLog.deleteMany({ where: { userId } });
      await tx.wellnessCheckin.deleteMany({ where: { userId } });
      await tx.activityLog.deleteMany({ where: { userId } });
      await tx.savedFood.deleteMany({ where: { userId } });

      // 2. Sessions (after their children are gone)
      await tx.session.deleteMany({ where: { userId } });

      // 3. Social / messaging
      await tx.message.deleteMany({
        where: { OR: [{ senderId: userId }, { conversation: { OR: [{ participantAId: userId }, { participantBId: userId }] } }] },
      });
      await tx.directConversation.deleteMany({
        where: { OR: [{ participantAId: userId }, { participantBId: userId }] },
      });
      await tx.sharedItem.deleteMany({
        where: { OR: [{ sharerId: userId }, { recipientId: userId }] },
      });
      await tx.friendship.deleteMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      });

      // 4. Finally remove the user row itself
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
