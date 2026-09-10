import { Request, Response, NextFunction } from 'express';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

/** True when the email is on the ADMIN_EMAILS allowlist (case-insensitive). */
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!isAdminEmail(req.user.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
