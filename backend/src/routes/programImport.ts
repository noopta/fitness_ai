// Training → Import a program (Oct 2026): the user's own coach's program from
// pasted text or photos of the sheet, transcribed exactly (services/
// coachProgramImport.ts). Preview first; apply makes it their program — the
// same path as the chat card (current program archived, never deleted).

import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/requireAuth.js';
import { transcribeCoachProgram, toSavedProgram, previewLines } from '../services/coachProgramImport.js';
import { saveProgramForUser } from './coach.js';

const router = Router();
const pending = new Map<string, { userId: string; program: any; at: number }>();
const TTL = 60 * 60_000;
const sweep = () => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > TTL) pending.delete(k); };

// POST /api/programs/import-coach { text?, images?: [{ base64, mimeType }], coach? } → preview
router.post('/programs/import-coach', requireAuth, async (req, res) => {
  try {
    sweep();
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const images = Array.isArray(req.body?.images) ? req.body.images
      .filter((i: any) => typeof i?.base64 === 'string' && /^image\/(jpeg|png|heic|heif|webp)$/.test(String(i?.mimeType)) && i.base64.length < 12_000_000)
      .slice(0, 8) : [];
    if (!text.trim() && !images.length) return res.status(400).json({ error: 'Paste the program or add a photo of it.' });
    const p = await transcribeCoachProgram({ text, images, coach: typeof req.body?.coach === 'string' ? req.body.coach : null });
    if (!p.phases.length) return res.status(422).json({ error: 'Couldn’t find a program in that. Try a clearer photo or paste the text.', unclear: p.unclear });
    const program = { ...toSavedProgram(p), ...(text ? { sourceText: text.slice(0, 20_000) } : {}) };
    const id = crypto.randomUUID();
    pending.set(id, { userId: req.user!.id, program, at: Date.now() });
    res.json({ id, name: p.name, coach: p.coach, weeks: program.durationWeeks, daysPerWeek: program.daysPerWeek, phases: p.phases, notes: p.notes, unclear: p.unclear, preview: previewLines(p, 14) });
  } catch (err: any) {
    console.error('[program-import] preview failed:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn’t read that program. Try again, or paste it as text.' });
  }
});

// POST /api/programs/import-coach/:id/apply → it's their program now
router.post('/programs/import-coach/:id/apply', requireAuth, async (req, res) => {
  const p = pending.get(req.params.id);
  if (!p || p.userId !== req.user!.id) return res.status(404).json({ error: 'That preview expired — import it again.' });
  try {
    await saveProgramForUser(req.user!.id, p.program);
    pending.delete(req.params.id);
    res.json({ ok: true, name: p.program.name });
  } catch (err: any) {
    console.error('[program-import] apply failed:', err?.message ?? err);
    res.status(500).json({ error: 'Couldn’t save the program.' });
  }
});

export default router;
