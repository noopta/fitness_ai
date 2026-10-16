// A practice's public page (/p/<slug>): opt-in, read-only profile, and the
// enquiry form. Unauthenticated, so every write is rate-limited per IP and
// carries a honeypot field.

import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimiter.js';
import { LeadError, publicPractice, publicSlots, submitLead } from '../services/personalTraining/leads.js';

const router = Router();
const leadLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, keyFn: (req) => `ptlead:${req.ip ?? 'unknown'}`, message: 'Too many enquiries from this network. Try again later.' });

const wrap = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof LeadError) return res.status(err.status).json({ error: err.message });
    console.error('[pt-public]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

router.get('/:slug', wrap(async (req, res) => res.json({ practice: await publicPractice(req.params.slug) })));
router.get('/:slug/slots', wrap(async (req, res) => res.json({ slots: await publicSlots(req.params.slug) })));
router.post('/:slug/leads', leadLimiter, wrap(async (req, res) => res.status(201).json(await submitLead(req.params.slug, req.body ?? {}))));

export default router;
