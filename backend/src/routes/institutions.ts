import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireInstitutionRole } from '../middleware/requireInstitutionRole.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { computeStrengthProfile } from './strength.js';

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
  const { token } = req.params;
  const userId = req.user!.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.institutionInvite.findUnique({
        where: { token },
        include: { institution: true },
      });
      if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
      if (invite.usedAt) throw Object.assign(new Error('Invite already used'), { status: 400 });
      if (invite.expiresAt < new Date()) throw Object.assign(new Error('Invite expired'), { status: 400 });

      // Create or reactivate member
      const member = await tx.institutionMember.upsert({
        where: { institutionId_userId: { institutionId: invite.institutionId, userId } },
        update: { active: true, role: invite.role },
        create: { institutionId: invite.institutionId, userId, role: invite.role, active: true },
      });

      // Mark invite as used
      await tx.institutionInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedByUserId: userId },
      });

      return { institution: invite.institution, member };
    });

    return res.json(result);
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[institutions] POST /invite/:token/claim', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Coach role ───────────────────────────────────────────────────────────────

// PATCH /institutions/:slug — update institution name/logo
router.patch('/:slug', requireAuth, requireInstitutionRole('coach'), async (req, res) => {
  const { slug } = req.params;
  const { name, logoUrl } = req.body;
  if (!name && logoUrl === undefined) {
    return res.status(400).json({ error: 'Provide at least one field to update: name, logoUrl' });
  }
  try {
    const updated = await prisma.institution.update({
      where: { slug },
      data: {
        ...(name !== undefined && { name }),
        ...(logoUrl !== undefined && { logoUrl }),
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

  const expiresAt = new Date(Date.now() + expiresIn * 60 * 60 * 1000);

  try {
    const invite = await prisma.institutionInvite.create({
      data: {
        institutionId: institution.id,
        invitedByUserId: req.user!.id,
        email: email ?? null,
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
        bodyWeightLogs,
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

    try {
      // Confirm athlete is in this institution
      const member = await prisma.institutionMember.findUnique({
        where: { institutionId_userId: { institutionId: institution.id, userId: athleteId } },
      });
      if (!member || !member.active) {
        return res.status(404).json({ error: 'Athlete not found in this institution' });
      }

      // Canonical ordering: participantA < participantB (lexicographic)
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
