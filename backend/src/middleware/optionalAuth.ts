import { Request, Response, NextFunction } from 'express';
import { resolveAuthToken, tokenFromRequest } from './requireAuth.js';

/**
 * Attach req.user when a valid, unrevoked session token is present; carry on
 * anonymously otherwise. Same checks as requireAuth (token version, DB tier,
 * no scoped tokens) — an anonymous request is never refused here.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = tokenFromRequest(req);
  if (!token) return next();
  resolveAuthToken(token).then(
    (r) => {
      if (r.ok) req.user = r.user;
      next();
    },
    () => next(),
  ).catch(next);
}
