import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { stripe } from '../services/stripeService.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { transferToAffiliate } from '../services/affiliateService.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';

const router = Router();
const prisma = new PrismaClient();

// GET /api/payments/status
router.get('/payments/status', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { tier: true, stripeSubStatus: true, stripeCustomerId: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ tier: user.tier, subStatus: user.stripeSubStatus });
  } catch (err) {
    console.error('Payments status error:', err);
    res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});

// POST /api/payments/portal — Stripe billing portal session
router.post('/payments/portal', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { stripeCustomerId: true, email: true },
    });

    let customerId = user?.stripeCustomerId;

    // Fallback: look up Stripe customer by email if no customerId stored locally.
    // This handles users who subscribed via the direct Stripe checkout link before
    // the webhook was configured to save stripeCustomerId.
    if (!customerId && user?.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        // Persist for future requests
        await prisma.user.update({
          where: { id: req.user!.id },
          data: { stripeCustomerId: customerId },
        });
      }
    }

    if (!customerId) {
      return res.status(400).json({ error: 'No billing account found. Please subscribe first.' });
    }

    // Try to create portal session; if customer ID is stale, clear it and re-lookup by email
    let portalSession;
    try {
      portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${FRONTEND_URL}/settings`,
      });
    } catch (stripeErr: any) {
      if (stripeErr?.code === 'resource_missing' && user?.email) {
        // Stale customer ID — clear it, then try email lookup
        await prisma.user.update({ where: { id: req.user!.id }, data: { stripeCustomerId: null } });

        const customers = await stripe.customers.list({ email: user.email, limit: 1 });
        if (customers.data.length === 0) {
          return res.status(400).json({ error: 'No active subscription found. Please subscribe first.' });
        }
        const freshCustomerId = customers.data[0].id;
        await prisma.user.update({ where: { id: req.user!.id }, data: { stripeCustomerId: freshCustomerId } });

        portalSession = await stripe.billingPortal.sessions.create({
          customer: freshCustomerId,
          return_url: `${FRONTEND_URL}/settings`,
        });
      } else {
        throw stripeErr;
      }
    }

    res.json({ url: portalSession.url });
  } catch (err: any) {
    console.error('Portal session error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create portal session' });
  }
});

// POST /api/payments/webhook — raw body
router.post('/payments/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const rawBody = (req as any).rawBody ?? req.body;

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      // Re-fetch with expansion so we can read the promo code
      const session = await stripe.checkout.sessions.retrieve(
        (event.data.object as any).id,
        { expand: ['total_details.breakdown'] }
      );
      const userId = session.client_reference_id;
      const customerId = session.customer as string | null;

      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            tier: 'pro',
            stripeCustomerId: customerId,
            stripeSubStatus: 'active'
          }
        });
        console.log(`✓ User ${userId} upgraded to pro`);
      }

      // ── Affiliate payout on initial purchase ──────────────────────────────
      const discounts = (session as any).total_details?.breakdown?.discounts ?? [];
      const promoCodeId: string | undefined = discounts[0]?.discount?.promotion_code;

      if (promoCodeId) {
        const affiliate = await prisma.affiliate.findUnique({ where: { promoCodeId } });
        if (affiliate) {
          // Store subscription → affiliate mapping for recurring renewals
          if (session.subscription) {
            await prisma.affiliateSubscription.upsert({
              where: { subscriptionId: session.subscription as string },
              create: { subscriptionId: session.subscription as string, affiliateId: affiliate.id },
              update: {},
            });
          }
          if (affiliate.stripeAccountId) {
            await transferToAffiliate({
              affiliateId: affiliate.id,
              stripeAccountId: affiliate.stripeAccountId,
              sourceEventId: event.id,
            });
          } else {
            console.warn(`[affiliates] Affiliate ${affiliate.id} has no Stripe account yet`);
          }
        }
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as any;
      // Only fire on renewals, not the initial subscription invoice
      if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
        const sub = await prisma.affiliateSubscription.findUnique({
          where: { subscriptionId: invoice.subscription },
          include: { affiliate: true },
        });
        if (sub?.affiliate?.stripeAccountId) {
          await transferToAffiliate({
            affiliateId: sub.affiliate.id,
            stripeAccountId: sub.affiliate.stripeAccountId,
            sourceEventId: event.id,
          });
        }
      }
    } else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const status = subscription.status; // active, past_due, canceled, unpaid, etc.

      const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (user) {
        const newTier = status === 'active' ? 'pro' : user.tier;
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeSubStatus: status, tier: newTier }
        });
        console.log(`✓ User ${user.id} subscription updated: ${status}`);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { tier: 'free', stripeSubStatus: 'canceled' }
        });
        console.log(`✓ User ${user.id} downgraded to free`);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeSubStatus: 'past_due' }
        });
        console.log(`⚠ User ${user.id} payment failed — marked past_due`);
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
});

export default router;
