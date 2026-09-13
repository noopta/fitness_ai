// Baseline security response headers.
//
// This is a hand-rolled subset of what `helmet` would set. It's deliberately
// dependency-free: the box this runs on is disk-constrained, and everything we
// actually need here is a handful of static headers on an API that serves JSON
// plus exactly one HTML page (the OAuth hand-off in auth.ts).
//
// What we set and why:
//   Strict-Transport-Security  — nginx terminates TLS at :4009; without HSTS a
//                                downgrade on the first hop is possible.
//   X-Content-Type-Options     — stops MIME sniffing turning a JSON body into
//                                an executable script in an embedded webview.
//   X-Frame-Options / CSP frame-ancestors
//                              — the OAuth hand-off page briefly holds a JWT in
//                                the DOM; it must never be framable.
//   Referrer-Policy            — the OAuth redirect carries ?token= in the URL,
//                                so the Referer must not leak it cross-origin.
//   Cross-Origin-Resource-Policy — same-site by default; the feed's signed GCS
//                                URLs are fetched directly by the client, not
//                                proxied, so this doesn't affect images.
//
// NOT set here: a full Content-Security-Policy. The API returns JSON, and the
// one HTML page sets its own inline script; a global CSP would either be
// meaningless or break that page. The page-specific CSP lives in auth.ts.

import { Request, Response, NextFunction } from 'express';

const IS_PROD = process.env.NODE_ENV === 'production';

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // 180 days. Not preloaded — preload is a one-way door and should be a
  // deliberate decision once every subdomain is known-good over HTTPS.
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // Express advertises itself by default; no reason to hand out the stack.
  res.removeHeader('X-Powered-By');
  next();
}
