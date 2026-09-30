// Settings for the v2 pages (You › Notifications, Privacy, Plan & usage).
// Writes go through the same ops as chat, so a toggle on the page lands in
// the change log with the same undo as "turn off social notifications".

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { executeOp } from '../agent/ops.js';
import { readPrefs } from '../agent/toolkits/prefs.js';
import { readUsage } from '../agent/toolkits/social.js';
import '../agent/toolkits/index.js';

const router = Router();

router.get('/me/settings', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const [prefs, usage] = await Promise.all([readPrefs(userId), readUsage(userId)]);
    res.json({ ...prefs, usage });
  } catch (err: any) {
    console.error('[settings] read failed:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn’t load your settings.' });
  }
});

const patchSchema = z.object({
  prefs: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  notifications: z.record(z.string(), z.union([z.boolean(), z.number()])).optional(),
  consent: z.record(z.string(), z.boolean()).optional(),
}).refine((b) => b.prefs || b.notifications || b.consent, 'Nothing to change');

router.patch('/me/settings', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const b = patchSchema.parse(req.body);
    const changes: { changeId: string; summary: string }[] = [];
    if (b.prefs && Object.keys(b.prefs).length) changes.push(await executeOp(userId, 'pref.set_many', { values: b.prefs }));
    if (b.notifications && Object.keys(b.notifications).length) changes.push(await executeOp(userId, 'notif.set', { values: b.notifications }));
    if (b.consent && Object.keys(b.consent).length) changes.push(await executeOp(userId, 'consent.set', { values: b.consent }));
    const [prefs, usage] = await Promise.all([readPrefs(userId), readUsage(userId)]);
    res.json({ ...prefs, usage, changes: changes.map((c) => ({ changeId: c.changeId, summary: c.summary })) });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
    // Op validation messages ("Reminder hour is 0–23.") are user-facing.
    res.status(400).json({ error: err?.message ?? 'Couldn’t save that.' });
  }
});

export default router;
