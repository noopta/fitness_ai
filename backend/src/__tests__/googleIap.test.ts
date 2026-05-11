import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factory must be self-contained — define mocks inside.
vi.mock('@prisma/client', () => {
  const user = { update: vi.fn(), updateMany: vi.fn() };
  const PrismaClient = vi.fn(function (this: any) { this.user = user; });
  return { PrismaClient, __mocks: { user } };
});

const subsV2Get = vi.fn();
vi.mock('googleapis', () => ({
  google: {
    auth: {
      // `new GoogleAuth({...})` is invoked at runtime — use a real function so
      // it works as a constructor.
      GoogleAuth: vi.fn(function (this: any) { this.fake = true; }),
    },
    androidpublisher: () => ({
      purchases: { subscriptionsv2: { get: subsV2Get } },
    }),
  },
}));

vi.mock('../services/posthogClient.js', () => ({
  default: { capture: vi.fn(), captureException: vi.fn() },
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user_1' };
    next();
  },
}));

// Stub env BEFORE import — getAndroidPublisher reads it lazily but module top
// level may not, and a missing env can't trip the test.
process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'fake@iam.gserviceaccount.com',
  private_key: 'fake',
});
process.env.GOOGLE_PLAY_PACKAGE_NAME = 'io.axiomtraining.app';

import express from 'express';
import request from 'supertest';
import googleIapRouter from '../routes/googleIap.js';
import * as prismaMod from '@prisma/client';
const { user: prismaUserMock } = (prismaMod as any).__mocks;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', googleIapRouter);
  return app;
}

beforeEach(() => {
  subsV2Get.mockReset();
  prismaUserMock.update.mockReset();
  prismaUserMock.updateMany.mockReset();
  prismaUserMock.update.mockResolvedValue({});
  prismaUserMock.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /api/payments/google-iap/verify', () => {
  it('rejects missing fields with 400', async () => {
    const res = await request(buildApp()).post('/api/payments/google-iap/verify').send({});
    expect(res.status).toBe(400);
  });

  it('rejects unknown productId', async () => {
    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok', productId: 'mystery_product' });
    expect(res.status).toBe(400);
  });

  it('upgrades user to pro on ACTIVE subscription', async () => {
    const expiry = new Date(Date.now() + 30 * 86400000).toISOString();
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [{ expiryTime: expiry }],
      },
    });

    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok123', productId: 'axiom_pro_monthly' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, tier: 'pro' });
    expect(prismaUserMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tier: 'pro',
        googlePurchaseToken: 'tok123',
        googleProductId: 'axiom_pro_monthly',
      }),
    }));
  });

  it('treats IN_GRACE_PERIOD as active', async () => {
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
        lineItems: [{ expiryTime: new Date(Date.now() + 86400000).toISOString() }],
      },
    });
    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok', productId: 'axiom_pro_monthly' });
    expect(res.status).toBe(200);
  });

  it('treats CANCELED-but-still-paid as active (user keeps Pro through expiry)', async () => {
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [{ expiryTime: new Date(Date.now() + 5 * 86400000).toISOString() }],
      },
    });
    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok', productId: 'axiom_pro_monthly' });
    expect(res.status).toBe(200);
  });

  it('rejects EXPIRED subscription with 402', async () => {
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
        lineItems: [{ expiryTime: new Date(Date.now() - 86400000).toISOString() }],
      },
    });
    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok', productId: 'axiom_pro_monthly' });
    expect(res.status).toBe(402);
    expect(prismaUserMock.update).not.toHaveBeenCalled();
  });

  it('rejects CANCELED with past expiry as 402', async () => {
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [{ expiryTime: new Date(Date.now() - 86400000).toISOString() }],
      },
    });
    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok', productId: 'axiom_pro_monthly' });
    expect(res.status).toBe(402);
  });

  it('returns 500 when Play API throws', async () => {
    subsV2Get.mockRejectedValue(new Error('network'));
    const res = await request(buildApp())
      .post('/api/payments/google-iap/verify')
      .send({ purchaseToken: 'tok', productId: 'axiom_pro_monthly' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/payments/google-iap/notifications', () => {
  function encodePubsubMessage(payload: any) {
    return {
      message: {
        data: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
    };
  }

  it('200s on empty test pings', async () => {
    const res = await request(buildApp())
      .post('/api/payments/google-iap/notifications')
      .send({});
    expect(res.status).toBe(200);
  });

  it('downgrades user on EXPIRED state from notification', async () => {
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
        lineItems: [{ expiryTime: new Date(Date.now() - 1000).toISOString() }],
      },
    });
    const res = await request(buildApp())
      .post('/api/payments/google-iap/notifications')
      .send(encodePubsubMessage({
        subscriptionNotification: {
          notificationType: 13,
          purchaseToken: 'tok_expired',
          subscriptionId: 'axiom_pro_monthly',
        },
      }));
    expect(res.status).toBe(200);
    expect(prismaUserMock.updateMany).toHaveBeenCalledWith({
      where: { googlePurchaseToken: 'tok_expired' },
      data: { tier: 'free' },
    });
  });

  it('upgrades on RENEWED notification when state is active', async () => {
    const expiry = new Date(Date.now() + 30 * 86400000);
    subsV2Get.mockResolvedValue({
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: [{ expiryTime: expiry.toISOString() }],
      },
    });
    const res = await request(buildApp())
      .post('/api/payments/google-iap/notifications')
      .send(encodePubsubMessage({
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'tok_renewed',
          subscriptionId: 'axiom_pro_monthly',
        },
      }));
    expect(res.status).toBe(200);
    expect(prismaUserMock.updateMany).toHaveBeenCalledWith({
      where: { googlePurchaseToken: 'tok_renewed' },
      data: expect.objectContaining({ tier: 'pro' }),
    });
  });

  it('always 200s even when Play API fails (Pub/Sub retry suppression)', async () => {
    subsV2Get.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .post('/api/payments/google-iap/notifications')
      .send(encodePubsubMessage({
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'tok',
          subscriptionId: 'axiom_pro_monthly',
        },
      }));
    expect(res.status).toBe(200);
  });
});
