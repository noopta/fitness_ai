import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import twilio from 'twilio';

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

// POST /api/auth/register
const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().optional()
});

router.post('/auth/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

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
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        tier: 'free'
      }
    });

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    // Fire-and-forget notification
    sendAuthSMS(`🆕 New LiftOff signup: ${data.name} (${data.email})`);
    res.json({ user: { id: user.id, name: user.name, email: user.email, tier: user.tier } });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
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

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.hashedPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(data.password, user.hashedPassword);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    sendAuthSMS(`🔑 LiftOff login: ${user.name || 'User'} (${user.email}) [${user.tier}]`);
    res.json({ user: { id: user.id, name: user.name, email: user.email, tier: user.tier } });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/google — redirect to Google OAuth consent
router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const callbackUrl = encodeURIComponent(process.env.GOOGLE_CALLBACK_URL!);
  const scope = encodeURIComponent('openid email profile');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=${scope}&access_type=offline`;
  res.redirect(url);
});

// GET /api/auth/google/callback — handle OAuth code exchange
router.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?auth=error`);
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
      return res.redirect(`${process.env.FRONTEND_URL}/login?auth=error`);
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
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: { googleId, name: name || existingUser.name, email: email || existingUser.email }
      });
    } else {
      user = await prisma.user.create({
        data: { googleId, email, name, tier: 'free' }
      });
    }

    const token = issueToken(user);
    res.cookie('liftoff_jwt', token, COOKIE_OPTS);
    sendAuthSMS(`${isNewUser ? '🆕 New Google signup' : '🔑 Google login'}: ${user.name || 'User'} (${user.email || 'no email'}) [${user.tier}]`);
    res.redirect(`${process.env.FRONTEND_URL}/login?auth=success`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?auth=error`);
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
      }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
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

export default router;
