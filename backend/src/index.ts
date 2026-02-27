import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import libraryRoutes from './routes/library.js';
import sessionsRoutes from './routes/sessions.js';
import waitlistRoutes from './routes/waitlist.js';
import authRoutes from './routes/auth.js';
import paymentsRoutes from './routes/payments.js';
import coachRoutes from './routes/coach.js';
import nutritionRoutes from './routes/nutrition.js';
import wellnessRoutes from './routes/wellness.js';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Raw body parser for Stripe webhook BEFORE express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(cookieParser());
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'https://liftoffmvp.io',
  // Allow localhost ports for local development
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'LiftOff API is running' });
});

// Routes
app.use('/api', authRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', coachRoutes);
app.use('/api', nutritionRoutes);
app.use('/api', wellnessRoutes);
app.use('/api', libraryRoutes);
app.use('/api', sessionsRoutes);
app.use('/api', waitlistRoutes);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 LiftOff API running on http://localhost:${PORT}`);
  console.log(`📚 API endpoints available at http://localhost:${PORT}/api`);
});

// ── Daily coach thread cleanup ─────────────────────────────────────────────
// Clears OpenAI Assistants threads once every 24h to reduce token storage costs.
// Users will get a fresh thread on their next chat message.
const prisma = new PrismaClient();
const openaiForCleanup = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function clearCoachThreads() {
  try {
    const users = await prisma.user.findMany({
      where: { coachThreadId: { not: null } },
      select: { id: true, coachThreadId: true },
    });

    let cleared = 0;
    for (const u of users) {
      try {
        await openaiForCleanup.beta.threads.del(u.coachThreadId!);
      } catch {
        // Thread may already be deleted — continue
      }
      await prisma.user.update({ where: { id: u.id }, data: { coachThreadId: null } });
      cleared++;
    }
    if (cleared > 0) console.log(`✓ Daily cleanup: cleared ${cleared} coach thread(s)`);
  } catch (err) {
    console.error('Coach thread cleanup error:', err);
  }
}

// Run once on startup (clears any stale threads), then every 24 hours
clearCoachThreads();
setInterval(clearCoachThreads, 24 * 60 * 60 * 1000);
