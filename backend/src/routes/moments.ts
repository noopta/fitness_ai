// Progress moments (spec "Progress Moments", 19 Oct 2026): what a log earned —
// the congratulation and the shareable cards' data. Logs return their moment
// inline; these serve it again (chat cards, the Done screen, deep links) and
// record what the user did with it.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getMoment, recentMoments, markMoment } from '../services/moments/index.js';

const router = Router();
const ID = /^[0-9a-f-]{36}$/i;

// GET /api/moments?limit=10 — the latest moments, newest first.
router.get('/moments', requireAuth, async (req, res) => {
  try {
    res.json({ moments: await recentMoments(req.user!.id, Number(req.query.limit) || 10) });
  } catch (err) {
    console.error('[moments] list error:', err);
    res.status(500).json({ error: 'Failed to load moments' });
  }
});

// GET /api/moments/:id — { id, type, label, title, praise, why[], shareables[{kind,data}], sharedAt, canShare }
router.get('/moments/:id', requireAuth, async (req, res) => {
  try {
    if (!ID.test(req.params.id)) return res.status(404).json({ error: 'Moment not found' });
    const m = await getMoment(req.user!.id, req.params.id);
    if (!m) return res.status(404).json({ error: 'Moment not found' });
    res.json(m);
  } catch (err) {
    console.error('[moments] get error:', err);
    res.status(500).json({ error: 'Failed to load moment' });
  }
});

// POST /api/moments/:id/shared · /dismiss — what the user did with it (analytics + "Shared" state).
for (const [path, what] of [['shared', 'shared'], ['dismiss', 'dismissed']] as const) {
  router.post(`/moments/:id/${path}`, requireAuth, async (req, res) => {
    try {
      if (!ID.test(req.params.id) || !(await markMoment(req.user!.id, req.params.id, what))) return res.status(404).json({ error: 'Moment not found' });
      res.json({ ok: true });
    } catch (err) {
      console.error(`[moments] ${path} error:`, err);
      res.status(500).json({ error: 'Failed to update moment' });
    }
  });
}

export default router;
