import { Request, Response, NextFunction } from 'express';

const UPGRADE_URL = `https://buy.stripe.com/9B614gaQ2gjIdxV26NfUQ01`;

export function requireProTier(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (user.tier !== 'pro' && user.tier !== 'enterprise') {
    return res.status(403).json({
      error: 'Pro subscription required',
      upgradeUrl: `${UPGRADE_URL}?client_reference_id=${user.id}`
    });
  }
  next();
}
