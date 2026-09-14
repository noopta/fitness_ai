import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.hoisted(() => { process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!'; });
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) }; }) }));

import authRouter from '../routes/auth.js';

describe('GET /auth/me caching', () => {
  it('is never cacheable, even on an error response', async () => {
    const jwt = await import('jsonwebtoken');
    const app = express();
    app.use(express.json());
    app.use('/api', authRouter);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt.default.sign({ id: 'u1', email: 'a@b.c', tier: 'free' }, process.env.JWT_SECRET!)}`);
    expect(res.headers['cache-control']).toBe('no-store, private');
  });
});
