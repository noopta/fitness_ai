import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import libraryRoutes from './routes/library.js';
import sessionsRoutes from './routes/sessions.js';
import waitlistRoutes from './routes/waitlist.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'LiftOff API is running' });
});

// Routes
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
