// Claiming an institution invite. Shared by /api/institutions (teams) and
// /api/personal-training (a trainer's practice is an institution), so the
// email binding and role rules have exactly one implementation.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class InviteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'InviteError';
    this.status = status;
  }
}

/** Validate an invite and return it with its institution. Throws InviteError when it can't be used. */
export async function findUsableInvite(token: string) {
  const invite = await prisma.institutionInvite.findUnique({
    where: { token },
    include: { institution: { select: { id: true, name: true, slug: true, logoUrl: true } } },
  });
  if (!invite) throw new InviteError('Invite not found', 404);
  if (invite.usedAt) throw new InviteError('Invite already used', 400);
  if (invite.expiresAt < new Date()) throw new InviteError('Invite expired', 400);
  return invite;
}

export async function claimInvite(token: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.institutionInvite.findUnique({
      where: { token },
      include: { institution: true },
    });
    if (!invite) throw new InviteError('Invite not found', 404);
    if (invite.usedAt) throw new InviteError('Invite already used', 400);
    if (invite.expiresAt < new Date()) throw new InviteError('Invite expired', 400);

    // Bind the invite to the address it was issued to. Without this, whoever
    // held the link got the role — including role:'coach', which grants the
    // member roster (names and email addresses) for the whole institution.
    // A forwarded or leaked link was a privilege grant to a stranger.
    if (invite.email) {
      const claimer = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      const claimerEmail = claimer?.email?.toLowerCase().trim();
      if (!claimerEmail || claimerEmail !== invite.email.toLowerCase().trim()) {
        throw new InviteError('This invite was issued to a different email address.', 403);
      }
    }

    // The upsert below writes the invite's role over an existing membership.
    // A coach opening their own athlete invite would demote themselves and
    // lose the roster, so an active coach can never claim down.
    const existing = await tx.institutionMember.findUnique({
      where: { institutionId_userId: { institutionId: invite.institutionId, userId } },
    });
    if (existing?.active && existing.role === 'coach' && invite.role !== 'coach') {
      throw new InviteError('You already run this practice, so you cannot join it as a client.', 400);
    }

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
}
