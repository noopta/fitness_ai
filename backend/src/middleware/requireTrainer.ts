import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { personalTrainingAvailableFor } from '../services/featureFlags.js';

const prisma = new PrismaClient();

export interface TrainerPractice {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

declare global {
  namespace Express {
    interface Request {
      practice?: TrainerPractice;
    }
  }
}

/**
 * Gate for the trainer side of /api/personal-training. Answers 404 rather
 * than 403 when the dashboard is not enabled for this account, so the
 * surface is indistinguishable from not existing.
 */
export function requirePersonalTraining(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!personalTrainingAvailableFor(req.user.id, req.user.email)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/**
 * The practice this user runs: an active institution where they hold the
 * 'coach' role. A trainer with several picks one with ?practice=<slug>;
 * otherwise the one they joined first.
 */
export async function findPractice(userId: string, slug?: string): Promise<TrainerPractice | null> {
  const membership = await prisma.institutionMember.findFirst({
    where: {
      userId,
      role: 'coach',
      active: true,
      institution: { active: true, ...(slug ? { slug } : {}) },
    },
    orderBy: { joinedAt: 'asc' },
    select: { institution: { select: { id: true, name: true, slug: true, logoUrl: true } } },
  });
  return membership?.institution ?? null;
}

/** Resolves req.practice. 409 `no_practice` tells the client to show practice setup. */
export async function requireTrainer(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const slug = typeof req.query.practice === 'string' && req.query.practice ? req.query.practice : undefined;
    const practice = await findPractice(req.user.id, slug);
    if (!practice) return res.status(409).json({ error: 'Set up your practice first', code: 'no_practice' });
    req.practice = practice;
    next();
  } catch (err) {
    console.error('[personal-training] requireTrainer', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
