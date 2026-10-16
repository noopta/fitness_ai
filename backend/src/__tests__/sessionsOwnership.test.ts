// DELETE /sessions/:id and POST /sessions/:id/share answer a foreign session
// id exactly like a missing one (404), via loadOwnedSession — a 403 confirmed
// the id exists (Oct 2026 audit).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
});

const { prismaUser, prismaSession } = vi.hoisted(() => ({
  prismaUser: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  prismaSession: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
}));

vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = prismaUser;
    this.session = prismaSession;
  });
  return { PrismaClient };
});
vi.mock('../services/llmService.js', () => ({
  generateDiagnosticQuestion: vi.fn(),
  generateWorkoutPlan: vi.fn(),
  generateInitialAnalysis: vi.fn(),
  createChatThread: vi.fn(),
  sendChatMessage: vi.fn(),
}));
vi.mock('../services/youtubeService.js', () => ({ getExerciseVideo: vi.fn() }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));

import sessionsRouter from '../routes/sessions.js';

const auth = `Bearer ${jwt.sign({ id: 'u1', email: 'u1@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
const app = express();
app.use(express.json());
app.use('/api', sessionsRouter);

beforeEach(() => {
  prismaSession.findUnique.mockReset();
  prismaSession.delete.mockReset().mockResolvedValue({});
  prismaSession.update.mockReset().mockResolvedValue({});
});

describe('session ownership', () => {
  it('DELETE of someone else\'s session is a 404 and deletes nothing', async () => {
    prismaSession.findUnique.mockResolvedValue({ id: 's1', userId: 'other', flow: 'wizard' });
    const res = await request(app).delete('/api/sessions/s1').set('Authorization', auth);
    expect(res.status).toBe(404);
    expect(prismaSession.delete).not.toHaveBeenCalled();
  });

  it('DELETE of an unknown id is the same 404', async () => {
    prismaSession.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/sessions/nope').set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  it('DELETE of your own session works', async () => {
    prismaSession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', flow: 'wizard' });
    const res = await request(app).delete('/api/sessions/s1').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(prismaSession.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('share of someone else\'s session is a 404 and never flips isPublic', async () => {
    prismaSession.findUnique.mockResolvedValue({ id: 's1', userId: 'other', flow: 'wizard' });
    const res = await request(app).post('/api/sessions/s1/share').set('Authorization', auth);
    expect(res.status).toBe(404);
    expect(prismaSession.update).not.toHaveBeenCalled();
  });

  it('share of your own session returns a link', async () => {
    prismaSession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', flow: 'wizard' });
    const res = await request(app).post('/api/sessions/s1/share').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toContain('/analysis/s1');
  });
});
