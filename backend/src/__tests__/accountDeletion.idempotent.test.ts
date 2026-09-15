// DELETE /auth/account must be idempotent. requireAuth only verifies the JWT,
// so a second tap (or a retry after a lost response) reaches the handler after
// the first request already removed the user. That used to 500 with a P2025
// and file a server exception for an account that was successfully deleted.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';

const userDelete = vi.fn();
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    this.user = { delete: userDelete, update: vi.fn().mockResolvedValue({}) };
    // Every best-effort tryDelete step runs against a model proxy that succeeds.
    this.$transaction = async (fn: any) => fn(new Proxy({ user: this.user }, {
      get: (t: any, k) => t[k] ?? { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }));
  });
  return { PrismaClient };
});

const captureException = vi.fn();
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException } }));
vi.mock('../services/errorAlertService.js', () => ({ alertServerError: vi.fn(async () => {}) }));

let app: express.Express;
const token = jwt.sign({ id: 'user_1', email: 'a@b.c', tier: 'free' }, process.env.JWT_SECRET!);

beforeAll(async () => {
  const { default: authRoutes } = await import('../routes/auth.js');
  const { errorReporting } = await import('../middleware/errorReporting.js');
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  // Same interceptor as prod, so the "reported exactly once" check is real.
  app.use(errorReporting);
  app.use('/api', authRoutes);
});

beforeEach(() => {
  userDelete.mockReset();
  captureException.mockReset();
});

describe('DELETE /api/auth/account', () => {
  it('succeeds when the user is deleted', async () => {
    userDelete.mockResolvedValue({ id: 'user_1' });
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('answers success, without reporting an error, when the account is already gone', async () => {
    userDelete.mockRejectedValue(Object.assign(new Error('No record was found for a delete.'), { code: 'P2025' }));
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('still 500s, reported exactly once, when a FK blocks the delete', async () => {
    userDelete.mockRejectedValue(Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' }));
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
