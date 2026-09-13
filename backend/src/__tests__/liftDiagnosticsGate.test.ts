/**
 * Rollout gate for the conversational lift diagnostic: dark for everyone but
 * the allowlist, advertised and enforced from the same predicate.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
  delete process.env.LIFT_DIAGNOSTIC_CONVERSATION_ENABLED;
  process.env.LIFT_DIAGNOSTIC_CONVERSATION_USERS = 'Tester@Axiom.io, user-by-id';
});

const prismaMock = vi.hoisted(() => ({
  session: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  diagnosticTurn: { findMany: vi.fn(async () => []) },
  user: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
}));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, prismaMock); }) }));
vi.mock('../services/llmService.js', () => ({ generateWorkoutPlan: vi.fn() }));
vi.mock('../services/liftDiagnostic/video.js', () => ({ runDiagnosticVideo: vi.fn(), probeBufferDurationSec: vi.fn() }));
vi.mock('../services/liftDiagnostic/writeThrough.js', () => ({ writeThroughWorkingSets: vi.fn() }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));

import router from '../routes/liftDiagnostics.js';
import { liftConversationAvailableFor } from '../services/featureFlags.js';

const app = express();
app.use(express.json());
app.use('/api', router);
const auth = (id: string, email: string) => `Bearer ${jwt.sign({ id, email, tier: 'free' }, process.env.JWT_SECRET!)}`;

describe('lift diagnostic rollout gate', () => {
  it('matches allowlisted emails (case-insensitive) and ids only', () => {
    expect(liftConversationAvailableFor('u1', 'tester@axiom.io')).toBe(true);
    expect(liftConversationAvailableFor('USER-BY-ID', null)).toBe(true);
    expect(liftConversationAvailableFor('u2', 'someone@else.io')).toBe(false);
  });

  it('the API is a 404 for users outside the rollout and open for the allowlist', async () => {
    expect((await request(app).get('/api/lift-diagnostics').set('Authorization', auth('u2', 'someone@else.io'))).status).toBe(404);
    expect((await request(app).get('/api/lift-diagnostics').set('Authorization', auth('u1', 'tester@axiom.io'))).status).toBe(200);
  });

  it('still requires auth, and leaves shared public links reachable', async () => {
    expect((await request(app).get('/api/lift-diagnostics')).status).toBe(401);
    const pub = await request(app).get('/api/lift-diagnostics/11111111-2222-4333-8444-555555555555/public');
    expect(pub.status).toBe(404);
    expect(pub.body.error).toBe('Report not found');
  });
});
