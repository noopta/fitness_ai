import express, { type Express, type RequestHandler } from "express";
import fs from "fs";
import path from "path";

// ─── Security headers ────────────────────────────────────────────────────────
// Mirrored in vercel.json — keep the two in sync.
//
// script-src is 'self' only: index.html has no inline executable scripts (the
// JSON-LD block is a non-executed data block), Vite emits external module
// scripts, and PostHog's session recorder is bundled rather than loaded from
// its CDN. worker-src allows blob: for the recorder's compression worker.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src 'self' data: https: blob:",
  "media-src 'self' https: blob:",
  "connect-src 'self' https://api.airthreads.ai https://api.airthreads.ai:4009 https://us.i.posthog.com https://us-assets.i.posthog.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
};

/**
 * Sets the security headers on every response. `production: false` (dev)
 * skips the CSP — Vite's dev server injects inline HMR/react-refresh scripts
 * that `script-src 'self'` would block — and X-Frame-Options, so the Replit
 * workspace preview iframe keeps working.
 */
export function securityHeaders({ production = true }: { production?: boolean } = {}): RequestHandler {
  return (_req, res, next) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!production && k === "X-Frame-Options") continue;
      res.setHeader(k, v);
    }
    if (production) res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.removeHeader("X-Powered-By");
    next();
  };
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Idempotent with the app-wide middleware in index.ts; kept here so the
  // static bundle is never served without headers, whoever mounts it.
  app.use(securityHeaders());
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
