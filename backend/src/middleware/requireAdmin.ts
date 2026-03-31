import { Request, Response, NextFunction } from 'express';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.user.email || !ADMIN_EMAILS.includes(req.user.email.toLowerCase())) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
