import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthUser {
  id: string;
  email: string | null;
  tier: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Throttle lastActiveAt DB writes to once per 30 min per user (in-memory)
const lastActiveSent = new Map<string, number>();
const ACTIVE_THROTTLE_MS = 30 * 60 * 1000;

function touchLastActive(userId: string): void {
  const now = Date.now();
  const last = lastActiveSent.get(userId) ?? 0;
  if (now - last < ACTIVE_THROTTLE_MS) return;
  lastActiveSent.set(userId, now);
  // Fire-and-forget — never blocks the request
  setImmediate(() => {
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token =
    req.cookies?.liftoff_jwt ||
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    req.user = payload;
    touchLastActive(payload.id);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
