import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUser } from './requireAuth.js';

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token =
    req.cookies?.liftoff_jwt ||
    req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
      req.user = payload;
    } catch {
      // ignore invalid tokens for optional auth
    }
  }
  next();
}
