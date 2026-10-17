import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { bodyWeightKg, displayWeight } from '../services/weightUnits.js';
import { requireInstitutionRole } from '../middleware/requireInstitutionRole.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { computeStrengthProfile } from './strength.js';
import { claimInvite, InviteError } from '../services/institutionInvites.js';
import { moderateText } from '../services/moderationService.js';

/** Institution display name cap (shown to every member). */
export const INSTITUTION_NAME_MAX = 120;
/** Logo URL cap; must be https. */
export const LOGO_URL_MAX = 2048;
/** Coach → athlete direct message cap. */
export const COACH_MESSAGE_MAX = 2000;

/** null when acceptable, else the client-facing error. Exported for tests. */
export function validateLogoUrl(v: unknown): string | null {
  if (v === null) return null; // clearing the logo
  if (typeof v !== 'string' || !v.trim() || v.length > LOGO_URL_MAX) return `logoUrl must be an https URL of at most ${LOGO_URL_MAX} characters`;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:') return 'logoUrl must use https';
  } catch {
    return 'logoUrl must be a valid URL';
  }
  return null;
}

const router = Router();
const prisma = new PrismaClient();

// ─── Public ───────────────────────────────────────────────────────────────────

// GET /institutions/:slug — public institution info
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const institution = await prisma.institution.findUnique({
      where: { slug },
      include: { _count: { select: { members: { where: { active: true } } } } },
    });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });

    return res.json({
      id: institution.id,
      name: institution.name,
      slug: institution.slug,
      logoUrl: institution.logoUrl,
      memberCount: institution._count.members,
    });
  } catch (err) {
    console.error('[institutions] GET /:slug', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin ────────────────────────────────────────────────────────────────────

// POST /institutions — create a new institution
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, slug, logoUrl } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }
  try {
    const existing = await prisma.institution.findUnique({ where: { slug } });
    if (existing) return res.status(409).json({ error: 'Slug already taken' });

    const institution = await prisma.institution.create({
      data: { name, slug, logoUrl: logoUrl ?? null },
    });
    return res.status(201).json(institution);
  } catch (err) {
    console.error('[institutions] POST /', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Invite token routes (requireAuth, no slug param — must come before /:slug/* to avoid conflicts) ─

// GET /institutions/invite/:token — validate invite token
router.get('/invite/:token', requireAuth, async (req, res) => {
  const { token } = req.params;
  try {
    const invite = await prisma.institutionInvite.findUnique({
      where: { token },
      include: { institution: { select: { id: true, name: true, slug: true, logoUrl: true } } },
    });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.usedAt) return res.status(400).json({ error: 'Invite already used' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ error: 'Invite expired' });

    return res.json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      institution: invite.institution,
    });
  } catch (err) {
    console.error('[institutions] GET /invite/:token', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /institutions/invite/:token/claim — claim an invite
router.post('/invite/:token/claim', requireAuth, async (req, res) => {
  try {
    return res.json(await claimInvite(req.params.token, req.user!.id));
  } catch (err: any) {
    if (err instanceof InviteError) return res.status(err.status).json({ error: err.message });
    console.error('[institutions] POST /invite/:token/claim', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Coach role ───────────────────────────────────────────────────────────────

// PATCH /institutions/:slug — update institution name/logo
router.patch('/:slug', requireAuth, requireInstitutionRole('coach'), async (req, res) => {
  const { slug } = req.params;
  const { name, logoUrl } = req.body ?? {};
  if (!name && logoUrl === undefined) {
    return res.status(400).json({ error: 'Provide at least one field to update: name, logoUrl' });
  }
  // Both are shown to every member (and logoUrl is fetched by their clients),
  // so neither may be arbitrary: a bounded name, an https URL or null.
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > INSTITUTION_NAME_MAX)) {
    return res.status(400).json({ error: `name must be 1-${INSTITUTION_NAME_MAX} characters` });
  }
  if (logoUrl !== undefined) {
    const logoErr = validateLogoUrl(logoUrl);
    if (logoErr) return res.status(400).json({ error: logoErr });
  }
  try {
    const updated = await prisma.institution.update({
      where: { slug },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(logoUrl !== undefined && { logoUrl: logoUrl === null ? null : logoUrl.trim() }),
      },
    });
    return res.json(updated);
  } catch (err) {
    console.error('[institutions] PATCH /:slug', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /institutions/:slug/members — list all members
router.get('/:slug/members', requireAuth, requireInstitutionRole('coach'), async (req, res) => {
  const institution = (req as any).institution;
  try {
    const members = await prisma.institutionMember.findMany({
      where: { institutionId: institution.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return res.json(
      members.map((m: typeof members[number]) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        active: m.active,
        joinedAt: m.joinedAt,
        user: m.user,
      }))
    );
  } catch (err) {
    console.error('[institutions] GET /:slug/members', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /institutions/:slug/invite — generate invite link
router.post('/:slug/invite', requireAuth, requireInstitutionRole('coach'), async (req, res) => {
  const institution = (req as any).institution;
  const { email, role = 'athlete', expiresIn = 72 } = req.body;

  // `role` came straight from the body — anything at all could be written into
  // the membership row, and requireInstitutionRole compares that value to
  // decide access later.
  if (role !== 'athlete' && role !== 'coach') {
    return res.status(400).json({ error: 'role must be "athlete" or "coach"' });
  }
  // `expiresIn` was unvalidated, so `expiresIn: 1e9` minted an invite that
  // never expired. Cap at 30 days.
  const hours = Number(expiresIn);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    return res.status(400).json({ error: 'expiresIn must be between 1 and 720 hours' });
  }
  if (email !== undefined && email !== null && (typeof email !== 'string' || email.length > 255)) {
    return res.status(400).json({ error: 'email must be a string' });
  }
  // A coach invite grants coach access to every athlete's data. An open
  // (email-less) coach link can be forwarded to anyone, so it must name the
  // person it is for; claimInvite enforces the match.
  if (role === 'coach' && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
    return res.status(400).json({ error: 'Coach invites must be addressed to an email' });
  }

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  try {
    const invite = await prisma.institutionInvite.create({
      data: {
        institutionId: institution.id,
        invitedByUserId: req.user!.id,
        email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
        role,
        expiresAt,
      },
    });

    const baseUrl = process.env.APP_BASE_URL || 'https://app.liftoffai.com';
    const link = `${baseUrl}/invite/${invite.token}`;

    return res.status(201).json({ ...invite, link });
  } catch (err) {
    console.error('[institutions] POST /:slug/invite', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /institutions/:slug/members/:userId — deactivate member
router.delete(
  '/:slug/members/:userId',
  requireAuth,
  requireInstitutionRole('coach'),
  async (req, res) => {
    const institution = (req as any).institution;
    const { userId } = req.params;
    try {
      const member = await prisma.institutionMember.findUnique({
        where: { institutionId_userId: { institutionId: institution.id, userId } },
      });
      if (!member) return res.status(404).json({ error: 'Member not found' });
      // Coaches are peers: one may remove athletes or step down themselves,
      // but not lock another coach out. (No 'owner' role exists; an admin
      // handles coach disputes.)
      if (member.role === 'coach' && userId !== req.user!.id) {
        return res.status(403).json({ error: 'Coaches can\'t remove another coach.' });
      }

      const updated = await prisma.institutionMember.update({
        where: { institutionId_userId: { institutionId: institution.id, userId } },
        data: { active: false },
      });
      return res.json(updated);
    } catch (err) {
      console.error('[institutions] DELETE /:slug/members/:userId', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /institutions/:slug/athletes — list active athlete members
router.get('/:slug/athletes', requireAuth, requireInstitutionRole('coach'), async (req, res) => {
  const institution = (req as any).institution;
  try {
    const athletes = await prisma.institutionMember.findMany({
      where: { institutionId: institution.id, role: 'athlete', active: true },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return res.json(
      athletes.map((m: typeof athletes[number]) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        user: m.user,
      }))
    );
  } catch (err) {
    console.error('[institutions] GET /:slug/athletes', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /institutions/:slug/athletes/:userId — full athlete detail
router.get(
  '/:slug/athletes/:userId',
  requireAuth,
  requireInstitutionRole('coach'),
  async (req, res) => {
    const institution = (req as any).institution;
    const { userId } = req.params;
    try {
      // Confirm the target is an active athlete in this institution
      const member = await prisma.institutionMember.findUnique({
        where: { institutionId_userId: { institutionId: institution.id, userId } },
        include: { user: true },
      });
      if (!member || !member.active || member.role !== 'athlete') {
        return res.status(404).json({ error: 'Athlete not found in this institution' });
      }

      const [workoutLogs, wellnessCheckins, nutritionLogs, bodyWeightLogs, strengthProfile] =
        await Promise.all([
          prisma.workoutLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
          prisma.wellnessCheckin.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 7,
          }),
          prisma.nutritionLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 7,
          }),
          prisma.bodyWeightLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 30,
          }),
          computeStrengthProfile(userId),
        ]);

      const { user } = member;
      return res.json({
        profile: {
          id: user.id,
          name: user.name,
          email: user.email,
          heightCm: user.heightCm,
          weightKg: user.weightKg,
          bodyCompTag: user.bodyCompTag,
          trainingAge: user.trainingAge,
          equipment: user.equipment,
          dateOfBirth: user.dateOfBirth,
        },
        member: {
          id: member.id,
          role: member.role,
          joinedAt: member.joinedAt,
        },
        workoutLogs,
        strengthSummary: strengthProfile,
        wellnessCheckins,
        nutritionLogs,
        // Canonical kg + derived lbs so the athlete view can localise to the unit.
        bodyWeightLogs: bodyWeightLogs.map((l) => {
          const kg = bodyWeightKg(l);
          return { ...l, weightKg: kg, weightLbs: kg != null ? displayWeight(kg, 'imperial', 1) : l.weightLbs };
        }),
      });
    } catch (err) {
      console.error('[institutions] GET /:slug/athletes/:userId', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /institutions/:slug/athletes/:userId/message — start/get conversation and send message
router.post(
  '/:slug/athletes/:userId/message',
  requireAuth,
  requireInstitutionRole('coach'),
  async (req, res) => {
    const institution = (req as any).institution;
    const coachId = req.user!.id;
    const { userId: athleteId } = req.params;
    const { body } = req.body;

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'Message body is required' });
    }
    if (body.trim().length > COACH_MESSAGE_MAX) {
      return res.status(400).json({ error: `Message must be at most ${COACH_MESSAGE_MAX} characters` });
    }

    try {
      // Confirm athlete is in this institution
      const member = await prisma.institutionMember.findUnique({
        where: { institutionId_userId: { institutionId: institution.id, userId: athleteId } },
      });
      if (!member || !member.active) {
        return res.status(404).json({ error: 'Athlete not found in this institution' });
      }

      // Canonical ordering: participantA < participantB (lexicographic)
      // Same moderation as any other DM (fails open for coach_message).
      const verdict = await moderateText(body, 'coach_message', coachId);
      if (!verdict.allowed) {
        return res.status(400).json({ error: verdict.message ?? 'Message not allowed', blockedCategory: verdict.blockedCategory });
      }

      const [participantAId, participantBId] =
        coachId < athleteId ? [coachId, athleteId] : [athleteId, coachId];

      const conversation = await prisma.directConversation.upsert({
        where: { participantAId_participantBId: { participantAId, participantBId } },
        update: {},
        create: { participantAId, participantBId },
      });

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: coachId,
          body: body.trim(),
        },
      });

      return res.status(201).json({ conversationId: conversation.id, message });
    } catch (err) {
      console.error('[institutions] POST /:slug/athletes/:userId/message', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Athlete / any-member role ────────────────────────────────────────────────

// GET /institutions/:slug/coach-info — list coaches in the institution
router.get('/:slug/coach-info', requireAuth, requireInstitutionRole('any'), async (req, res) => {
  const institution = (req as any).institution;
  try {
    const coaches = await prisma.institutionMember.findMany({
      where: { institutionId: institution.id, role: 'coach', active: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return res.json(coaches.map((m: typeof coaches[number]) => ({ id: m.user.id, name: m.user.name, email: m.user.email })));
  } catch (err) {
    console.error('[institutions] GET /:slug/coach-info', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
