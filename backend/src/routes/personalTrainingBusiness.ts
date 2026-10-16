// Personal-training API, part four: running the business — billing on the
// trainer's own Stripe account (0% platform fee) and scheduling. Mounted by
// personalTraining.ts. The Stripe Connect webhook is the one route here that
// is not a trainer route; it is authenticated by Stripe's signature.

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { socialWriteLimiter } from '../middleware/rateLimiter.js';
import { requirePersonalTraining, requireTrainer } from '../middleware/requireTrainer.js';
import { stripe } from '../services/stripeService.js';
import {
  BillingError, archiveOffer, billingStatus, clientBilling, connectAccount, createOffer, handleConnectEvent, listOffers, revenue, saveBillingSettings, startCheckout,
} from '../services/personalTraining/billing.js';
import { prisma } from '../services/personalTraining/db.js';
import { issueLink, currentLink } from '../services/personalTraining/links.js';
import { loadClients } from '../services/personalTraining/roster.js';
import { atRisk, draftOutreach } from '../services/personalTraining/retention.js';
import { LeadError, addLead, convertLead, listLeads, updateLead } from '../services/personalTraining/leads.js';
import { TeamError, acceptCoachInvite, assignClient, inviteCoach, removeCoach, team, teamAnalytics } from '../services/personalTraining/team.js';
import { ScheduleError, book, cancel, getAvailability, listBookings, markSession, openSlots, setAvailability } from '../services/personalTraining/scheduling.js';

const router = Router();
const trainer: RequestHandler[] = [requireAuth, requirePersonalTraining, requireTrainer];

type Handler = (req: Request, res: Response) => Promise<unknown>;
const handle = (name: string, fn: Handler): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof BillingError || err instanceof ScheduleError || err instanceof TeamError || err instanceof LeadError) return void (res.headersSent || res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) }));
    console.error(`[personal-training] ${name}`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
};

async function clientOf(req: Request, id: string) {
  const [c] = await loadClients(req.practice!.id, { ids: [id], includeArchived: true });
  if (!c || c.status === 'notJoined') throw new BillingError('Client not found', 404);
  return c;
}

// ─── Stripe Connect webhook ──────────────────────────────────────────────────
// Raw body (index.ts stashes it for this path). Signed with the Connect endpoint's own secret.

router.post('/billing/webhook', async (req, res) => {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Not configured' });
  let event: any;
  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody ?? '', req.get('stripe-signature') ?? '', secret);
  } catch {
    return res.status(400).json({ error: 'Bad signature' });
  }
  try {
    res.json({ received: true, handled: await handleConnectEvent(event) });
  } catch (err) {
    console.error('[personal-training] connect webhook', event?.type, err);
    // 500 makes Stripe retry; every handler is idempotent.
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── Billing ─────────────────────────────────────────────────────────────────

router.get('/billing/status', ...trainer, handle('GET billing status', async (req, res) => {
  res.json({ status: await billingStatus(req.practice!.id, { refresh: req.query.refresh === '1' }) });
}));

router.post('/billing/connect', ...trainer, socialWriteLimiter, handle('POST billing connect', async (req, res) => {
  res.json(await connectAccount(req.practice!.id, req.user!.id));
}));

router.put('/billing/settings', ...trainer, handle('PUT billing settings', async (req, res) => {
  res.json({ status: await saveBillingSettings(req.practice!.id, req.user!.id, req.body ?? {}) });
}));

router.get('/billing/offers', ...trainer, handle('GET offers', async (req, res) => {
  res.json({ offers: await listOffers(req.practice!.id) });
}));

router.post('/billing/offers', ...trainer, socialWriteLimiter, handle('POST offer', async (req, res) => {
  res.status(201).json({ offer: await createOffer(req.practice!.id, req.user!.id, req.body ?? {}) });
}));

router.delete('/billing/offers/:oid', ...trainer, handle('DELETE offer', async (req, res) => {
  await archiveOffer(req.practice!.id, req.user!.id, req.params.oid);
  res.json({ ok: true });
}));

router.get('/billing/revenue', ...trainer, handle('GET revenue', async (req, res) => {
  res.json({ revenue: await revenue(req.practice!.id) });
}));

router.get('/clients/:id/billing', ...trainer, handle('GET client billing', async (req, res) => {
  const c = await clientOf(req, req.params.id);
  res.json(await clientBilling(req.practice!.id, c.id));
}));

// A payment link the trainer sends a client: their portal's billing tab, with this offer picked.
router.post('/clients/:id/billing/request', ...trainer, socialWriteLimiter, handle('POST payment request', async (req, res) => {
  const c = await clientOf(req, req.params.id);
  const offerId = typeof req.body?.offerId === 'string' ? req.body.offerId : '';
  const offer = await prisma.ptOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.practiceId !== req.practice!.id || !offer.active) throw new BillingError('That offer is not available', 404);
  const link = (await currentLink(req.practice!.id, c.id)) ?? (await issueLink(req.practice!.id, c.id, req.user!.id));
  res.json({ url: `${link.url}?tab=billing&offer=${encodeURIComponent(offer.id)}` });
}));

// ─── Scheduling ──────────────────────────────────────────────────────────────

router.get('/schedule/availability', ...trainer, handle('GET availability', async (req, res) => {
  res.json({ windows: await getAvailability(req.practice!.id, req.user!.id) });
}));

router.put('/schedule/availability', ...trainer, handle('PUT availability', async (req, res) => {
  res.json({ windows: await setAvailability(req.practice!.id, req.user!.id, req.body?.windows) });
}));

router.get('/schedule/bookings', ...trainer, handle('GET bookings', async (req, res) => {
  const from = typeof req.query.from === 'string' && !Number.isNaN(Date.parse(req.query.from)) ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' && !Number.isNaN(Date.parse(req.query.to)) ? new Date(req.query.to) : undefined;
  res.json({ bookings: await listBookings(req.practice!.id, { from, to, clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined }) });
}));

router.post('/schedule/bookings', ...trainer, socialWriteLimiter, handle('POST booking', async (req, res) => {
  const c = await clientOf(req, String(req.body?.clientId ?? ''));
  res.status(201).json({ booking: await book({ practiceId: req.practice!.id, clientId: c.id, trainerId: req.user!.id, startsAt: req.body?.startsAt, minutes: req.body?.minutes, notes: req.body?.notes, by: 'trainer' }) });
}));

router.patch('/schedule/bookings/:bid', ...trainer, handle('PATCH booking', async (req, res) => {
  if (req.body?.status === 'cancelled') {
    return res.json({ booking: await cancel({ practiceId: req.practice!.id, bookingId: req.params.bid, by: 'trainer', actorId: req.user!.id }) });
  }
  res.json({ booking: await markSession(req.practice!.id, req.user!.id, req.params.bid, req.body?.status) });
}));

router.get('/schedule/slots', ...trainer, handle('GET slots', async (req, res) => {
  res.json({ slots: await openSlots(req.practice!.id, { days: Number(req.query.days) || 14 }) });
}));

// ─── Retention ───────────────────────────────────────────────────────────────

router.get('/retention', ...trainer, handle('GET retention', async (req, res) => {
  res.json({ clients: await atRisk(req.practice!.id, req.user!.id) });
}));

router.post('/retention/:clientId/draft', ...trainer, socialWriteLimiter, handle('POST retention draft', async (req, res) => {
  const c = await clientOf(req, req.params.clientId);
  res.status(201).json({ draft: await draftOutreach(req.practice!.id, req.user!.id, c.id) });
}));

// ─── Leads ───────────────────────────────────────────────────────────────────

router.get('/leads', ...trainer, handle('GET leads', async (req, res) => {
  res.json({ leads: await listLeads(req.practice!.id) });
}));

router.post('/leads', ...trainer, socialWriteLimiter, handle('POST lead', async (req, res) => {
  res.status(201).json({ lead: await addLead(req.practice!.id, req.user!.id, req.body ?? {}) });
}));

router.patch('/leads/:lid', ...trainer, handle('PATCH lead', async (req, res) => {
  res.json({ lead: await updateLead(req.practice!.id, req.user!.id, req.params.lid, req.body ?? {}) });
}));

router.post('/leads/:lid/convert', ...trainer, socialWriteLimiter, handle('POST lead convert', async (req, res) => {
  const { clientId, link } = await convertLead(req.practice!.id, req.user!.id, req.params.lid);
  const [client] = await loadClients(req.practice!.id, { ids: [clientId] });
  res.status(201).json({ client, link });
}));

// ─── Team (multi-coach practices) ────────────────────────────────────────────

router.get('/team', ...trainer, handle('GET team', async (req, res) => {
  res.json({ members: await team(req.practice!.id) });
}));

router.post('/team/invite', ...trainer, socialWriteLimiter, handle('POST team invite', async (req, res) => {
  res.status(201).json(await inviteCoach(req.practice!.id, req.user!.id, req.body?.email));
}));

// The co-trainer accepting: signed in, but not yet a coach of this practice.
router.post('/team/invites/:token/accept', requireAuth, socialWriteLimiter, handle('POST team accept', async (req, res) => {
  res.json(await acceptCoachInvite(req.params.token, req.user!));
}));

router.delete('/team/:userId', ...trainer, handle('DELETE team member', async (req, res) => {
  await removeCoach(req.practice!.id, req.user!.id, req.params.userId);
  res.json({ ok: true });
}));

router.get('/team/analytics', ...trainer, handle('GET team analytics', async (req, res) => {
  res.json(await teamAnalytics(req.practice!.id, req.user!.id));
}));

router.put('/clients/:id/assignment', ...trainer, handle('PUT assignment', async (req, res) => {
  const c = await clientOf(req, req.params.id);
  await assignClient(req.practice!.id, req.user!.id, c.id, req.body?.trainerId ?? null);
  res.json({ ok: true });
}));

export default router;

/** Portal routes for paying and booking, mounted by ptPortal.ts behind the link. */
export function portalBusinessRoutes(r: Router, wrap: (name: string, fn: (req: Request, res: Response, s: { practiceId: string; clientId: string }) => Promise<unknown>) => RequestHandler, writeLimiter: RequestHandler) {
  r.get('/billing', wrap('GET billing', async (_req, res, s) => {
    const [status, offers, mine] = await Promise.all([billingStatus(s.practiceId), listOffers(s.practiceId, { activeOnly: true }), clientBilling(s.practiceId, s.clientId)]);
    res.json({ available: status.available && status.chargesEnabled, offers, ...mine });
  }));
  r.post('/billing/checkout', writeLimiter, wrap('POST checkout', async (req, res, s) => {
    res.json(await startCheckout(s.practiceId, s.clientId, req.body?.offerId));
  }));
  r.post('/billing/manage', writeLimiter, wrap('POST manage', async (_req, res, s) => {
    const { customerPortal } = await import('../services/personalTraining/billing.js');
    res.json(await customerPortal(s.practiceId, s.clientId));
  }));
  r.get('/slots', wrap('GET slots', async (req, res, s) => {
    res.json({ slots: await openSlots(s.practiceId, { days: Number(req.query.days) || 14 }) });
  }));
  r.get('/bookings', wrap('GET bookings', async (_req, res, s) => {
    res.json({ bookings: await listBookings(s.practiceId, { clientId: s.clientId, from: new Date(Date.now() - 30 * 86_400_000) }) });
  }));
  r.post('/bookings', writeLimiter, wrap('POST booking', async (req, res, s) => {
    res.status(201).json({ booking: await book({ practiceId: s.practiceId, clientId: s.clientId, trainerId: typeof req.body?.trainerId === 'string' ? req.body.trainerId : undefined, startsAt: req.body?.startsAt, by: 'client' }) });
  }));
  r.delete('/bookings/:bid', writeLimiter, wrap('DELETE booking', async (req, res, s) => {
    res.json({ booking: await cancel({ practiceId: s.practiceId, bookingId: req.params.bid, by: 'client', actorId: s.clientId, clientId: s.clientId }) });
  }));
}
