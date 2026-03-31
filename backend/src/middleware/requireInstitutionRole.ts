import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function requireInstitutionRole(role: 'coach' | 'athlete' | 'any') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: 'Institution slug required' });

    const institution = await prisma.institution.findUnique({ where: { slug } });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });

    const member = await prisma.institutionMember.findUnique({
      where: { institutionId_userId: { institutionId: institution.id, userId: req.user.id } },
    });

    if (!member || !member.active) {
      return res.status(403).json({ error: 'Not a member of this institution' });
    }

    if (role !== 'any' && member.role !== role) {
      return res.status(403).json({ error: `${role} role required` });
    }

    (req as any).institution = institution;
    (req as any).institutionMember = member;
    next();
  };
}
