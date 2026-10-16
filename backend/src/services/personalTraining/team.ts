// Multi-coach practices (handoff phase 3): a practice owner invites
// co-trainers, assigns clients to them, and sees how each trainer's roster is
// doing. The owner is the practice's longest-standing coach; nothing else
// about access changes — every coach of a practice can open every client, and
// assignment decides whose list (and briefing focus) a client is on.

import { audit } from './drafts.js';
import { prisma } from './db.js';
import { personalTrainingAvailableFor } from '../featureFlags.js';
import { atRisk } from './retention.js';
import { loadClients } from './roster.js';
import { monthlyCents } from './billing.js';
import type { TeamAnalytics, TeamMember } from './types.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

export class TeamError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TeamError';
    this.status = status;
  }
}

async function coaches(practiceId: string) {
  return prisma.institutionMember.findMany({
    where: { institutionId: practiceId, role: 'coach', active: true },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, joinedAt: true, user: { select: { name: true, email: true } } },
  });
}

export async function ownerOf(practiceId: string): Promise<string | null> {
  return (await coaches(practiceId))[0]?.userId ?? null;
}

async function assertOwner(practiceId: string, userId: string) {
  if ((await ownerOf(practiceId)) !== userId) throw new TeamError('Only the practice owner can do that', 403);
}

export async function team(practiceId: string): Promise<TeamMember[]> {
  const [list, profiles] = await Promise.all([coaches(practiceId), prisma.ptClientProfile.findMany({ where: { practiceId, state: { not: 'archived' }, assignedTrainerId: { not: null } }, select: { assignedTrainerId: true } })]);
  const assigned = new Map<string, number>();
  for (const p of profiles) assigned.set(p.assignedTrainerId!, (assigned.get(p.assignedTrainerId!) ?? 0) + 1);
  return list.map((c, i) => ({ userId: c.userId, name: c.user.name?.trim() || c.user.email || 'Trainer', email: c.user.email, role: i === 0 ? 'owner' : 'coach', assignedClients: assigned.get(c.userId) ?? 0, joinedAt: c.joinedAt.toISOString() }));
}

/** An invite bound to the co-trainer's email: a forwarded link cannot make a stranger a coach. */
export async function inviteCoach(practiceId: string, ownerId: string, email: unknown) {
  await assertOwner(practiceId, ownerId);
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 255) throw new TeamError('Enter the trainer\'s email address', 400);
  const invite = await prisma.institutionInvite.create({
    data: { institutionId: practiceId, invitedByUserId: ownerId, email: email.trim().toLowerCase(), role: 'coach', expiresAt: new Date(Date.now() + 7 * DAY_MS) },
  });
  await audit({ practiceId, trainerId: ownerId, action: 'coach_invited', itemType: 'team', itemId: invite.id, meta: { email: invite.email } });
  return { link: `${FRONTEND_URL}/personal-training/team/join/${invite.token}`, email: invite.email, expiresAt: invite.expiresAt.toISOString() };
}

/** A co-trainer accepts. They need the trainer dashboard on their own account first. */
export async function acceptCoachInvite(token: string, user: { id: string; email?: string | null }) {
  const invite = await prisma.institutionInvite.findUnique({ where: { token } });
  if (!invite || invite.role !== 'coach') throw new TeamError('Invite not found', 404);
  if (!personalTrainingAvailableFor(user.id, user.email ?? undefined)) throw new TeamError('This account does not have the trainer dashboard yet. Ask Axiom to enable it, then open the link again.', 403);
  const { claimInvite } = await import('../institutionInvites.js');
  const { institution } = await claimInvite(token, user.id);
  await audit({ practiceId: institution.id, trainerId: user.id, action: 'coach_joined', itemType: 'team', itemId: invite.id });
  return { practice: { id: institution.id, name: institution.name, slug: institution.slug, logoUrl: institution.logoUrl } };
}

export async function removeCoach(practiceId: string, ownerId: string, userId: string) {
  await assertOwner(practiceId, ownerId);
  if (userId === ownerId) throw new TeamError('The owner cannot leave their own practice here', 409);
  const m = await prisma.institutionMember.findUnique({ where: { institutionId_userId: { institutionId: practiceId, userId } } });
  if (!m || m.role !== 'coach' || !m.active) throw new TeamError('Trainer not found', 404);
  await prisma.institutionMember.update({ where: { id: m.id }, data: { active: false } });
  // Their clients go back to the whole practice rather than to nobody.
  await prisma.ptClientProfile.updateMany({ where: { practiceId, assignedTrainerId: userId }, data: { assignedTrainerId: null } });
  await audit({ practiceId, trainerId: ownerId, action: 'coach_removed', itemType: 'team', itemId: userId });
}

export async function assignClient(practiceId: string, actorId: string, clientId: string, trainerId: unknown) {
  const target = trainerId === null || trainerId === '' ? null : typeof trainerId === 'string' ? trainerId : undefined;
  if (target === undefined) throw new TeamError('trainerId must be a trainer id or null', 400);
  if (target && !(await coaches(practiceId)).some((c) => c.userId === target)) throw new TeamError('That trainer is not in this practice', 404);
  await prisma.ptClientProfile.upsert({
    where: { practiceId_clientId: { practiceId, clientId } },
    update: { assignedTrainerId: target },
    create: { practiceId, clientId, assignedTrainerId: target },
  });
  await audit({ practiceId, trainerId: actorId, clientId, action: 'client_assigned', itemType: 'client', itemId: clientId, meta: { to: target } });
}

/** The owner's view: each trainer's roster at a glance. Unassigned clients count under the owner. */
export async function teamAnalytics(practiceId: string, ownerId: string, now: Date = new Date()): Promise<TeamAnalytics> {
  await assertOwner(practiceId, ownerId);
  const [members, clients, profiles, risk, bookings, plans, offers] = await Promise.all([
    team(practiceId),
    loadClients(practiceId, { now }),
    prisma.ptClientProfile.findMany({ where: { practiceId }, select: { clientId: true, assignedTrainerId: true } }),
    atRisk(practiceId, ownerId, now),
    prisma.ptBooking.findMany({ where: { practiceId, status: 'booked', startsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) } }, select: { trainerId: true } }),
    prisma.ptClientPlan.findMany({ where: { practiceId, status: { in: ['active', 'past_due'] } }, select: { clientId: true, offerId: true } }),
    prisma.ptOffer.findMany({ where: { practiceId } }),
  ]);
  const ownerFor = new Map(profiles.map((p) => [p.clientId, p.assignedTrainerId ?? ownerId]));
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const riskBy = new Map(risk.map((r) => [r.clientId, r.level]));
  return {
    trainers: members.map((m) => {
      const mine = clients.filter((c) => (ownerFor.get(c.id) ?? ownerId) === m.userId);
      const avg = mine.length ? Math.round((mine.reduce((s, c) => s + c.engagement8w.slice(-2).reduce((a, b) => a + b, 0) / 2, 0) / mine.length) * 10) / 10 : null;
      const mrr = plans.filter((p) => (ownerFor.get(p.clientId) ?? ownerId) === m.userId).reduce((s, p) => {
        const o = offerById.get(p.offerId);
        return o?.kind === 'subscription' ? s + monthlyCents(o) : s;
      }, 0);
      return {
        userId: m.userId, name: m.name, role: m.role, clients: mine.length,
        needsSupport: mine.filter((c) => c.status === 'support').length,
        highRisk: mine.filter((c) => riskBy.get(c.id) === 'high').length,
        avgEngagement: avg,
        sessionsNext7d: bookings.filter((b) => b.trainerId === m.userId).length,
        mrrCents: mrr,
      };
    }),
  };
}
