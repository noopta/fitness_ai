# LiftOff Platform Upgrade — Implementation Notes

**Date:** 2026-02-21
**Commit:** `f2a3a3a`
**Branch:** `main`

---

## Overview

This document summarizes the full platform upgrade implemented in one session. The app went from a completely open, localStorage-only, unauthenticated system to a full-stack product with accounts, payments, video content, social sharing, and Olympic lift support.

---

## What Was Built

### Phase 1 — Prisma Schema

**File:** `backend/prisma/schema.prisma`

Added to the `User` model:
- `name`, `email` (unique), `hashedPassword`, `googleId` (unique), `dateOfBirth`
- `tier` — `"free"` | `"pro"` | `"enterprise"` (default: `"free"`)
- `stripeCustomerId`, `stripeSubStatus`
- `dailyAnalysisCount`, `dailyAnalysisDate` — for rate limiting free tier
- `updatedAt` — with `@default(now()) @updatedAt` (required for SQLite db push with existing rows)

Added to `Session`:
- `isPublic Boolean @default(false)` — for shareable links

New model `VideoCache`:
- `exerciseId` (unique), `videoId`, `title`, `thumbnail`, `fetchedAt`
- Used for 7-day YouTube API result caching

Ran `npx prisma db push` to apply (no migrations, SQLite push).

---

### Phase 2 — Backend Auth

#### New Middleware (`backend/src/middleware/`)

| File | Purpose |
|------|---------|
| `requireAuth.ts` | Reads `liftoff_jwt` httpOnly cookie (or `Authorization: Bearer`). Attaches `req.user = { id, email, tier }`. Returns 401 if missing/invalid. |
| `optionalAuth.ts` | Same as requireAuth but always calls `next()`. Sets `req.user` if valid token present, otherwise leaves undefined. |
| `requireProTier.ts` | Returns 403 + `upgradeUrl` if `req.user.tier` is not `pro` or `enterprise`. |
| `rateLimit.ts` | Checks `dailyAnalysisCount` vs `FREE_TIER_DAILY_LIMIT` env var. Resets on new calendar day. Returns 429 + `upgradeUrl` for over-limit free users. Skips for pro/enterprise. |

#### New Route: `backend/src/routes/auth.ts`

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/register` | bcrypt hash password, create User, issue JWT cookie |
| `POST /api/auth/login` | bcrypt compare, issue JWT cookie |
| `GET /api/auth/google` | Redirect to Google OAuth consent URL |
| `GET /api/auth/google/callback` | Exchange code for id_token, upsert user, issue JWT cookie, redirect to `FRONTEND_URL?auth=success` |
| `POST /api/auth/logout` | Clear `liftoff_jwt` cookie |
| `GET /api/auth/me` | (requireAuth) Return full user profile |
| `PUT /api/auth/profile` | (requireAuth) Update physical profile fields |

**JWT Cookie config:**
```typescript
{ httpOnly: true, secure: true, sameSite: 'none', maxAge: 30d }
```
`sameSite: 'none'` + `secure: true` required for cross-site cookie (liftoffmvp.io → luciuslab.xyz).

#### Modified: `backend/src/index.ts`
- Added `cookieParser()` middleware
- CORS changed from `origin: '*'` to `origin: process.env.FRONTEND_URL, credentials: true`
- Raw body parser for Stripe webhook registered BEFORE `express.json()`
- Registered `authRoutes` and `paymentsRoutes`

#### Modified: `backend/src/routes/sessions.ts`
- `POST /sessions` — added `optionalAuth`; links session to `req.user.id` if logged in
- `POST /sessions/:id/generate` — added `requireAuth` + `checkAnalysisRateLimit`
- New `GET /sessions/history` (requireAuth) — returns user's past sessions with plans
- New `GET /sessions/:id/public` — returns sanitized plan only if `session.isPublic === true`
- New `POST /sessions/:id/share` (requireAuth) — verifies ownership, sets `isPublic = true`, returns share URL
- New `GET /exercises/:exerciseId/video` — calls youtubeService, returns cached video data

---

### Phase 3 — Backend Payments

**New files:**
- `backend/src/services/stripeService.ts` — Stripe SDK init, exports `stripe` instance
- `backend/src/routes/payments.ts`:
  - `GET /api/payments/status` (requireAuth) — returns user tier + subscription info
  - `POST /api/payments/webhook` (raw body, no auth) — handles:
    - `checkout.session.completed` → sets `tier=pro`, stores `stripeCustomerId`
    - `customer.subscription.deleted` → sets `tier=free`

Webhook verifies signature with `stripe.webhooks.constructEvent()`.
Stripe checkout URL format: `https://buy.stripe.com/9B614gaQ2gjIdxV26NfUQ01?client_reference_id=<userId>`

> **TODO:** Set `STRIPE_WEBHOOK_SECRET` in `.env` after registering the webhook endpoint in the Stripe Dashboard.

---

### Phase 4 — YouTube Videos

**New file: `backend/src/services/youtubeService.ts`**
- `getExerciseVideo(exerciseId, exerciseName)`: checks `VideoCache` (7-day TTL), fetches YouTube Data API v3 if stale, upserts cache
- Returns `{ videoId, title, thumbnail }`

**New component: `frontend-v2/client/src/components/AccessoryVideoCard.tsx`**
- Uses `IntersectionObserver` to defer fetch until card is in viewport
- Shows YouTube thumbnail with play button overlay
- On click, replaces thumbnail with `<iframe src="https://www.youtube-nocookie.com/embed/{videoId}?autoplay=1">`
- Renders inside each accessory card in `plan.tsx`

---

### Phase 5 — Frontend Auth

#### New Files

| File | Description |
|------|-------------|
| `frontend-v2/client/src/context/AuthContext.tsx` | `AuthProvider` + `useAuth` hook. On mount calls `GET /api/auth/me` to restore session. Exposes `{ user, loading, login, register, logout, googleLogin, refreshUser }`. |
| `frontend-v2/client/src/components/ProtectedRoute.tsx` | If `!user && !loading`, saves intended path to `sessionStorage.liftoff_redirect` and redirects to `/login`. |
| `frontend-v2/client/src/pages/login.tsx` | Email/password form + "Continue with Google". Handles `?auth=success` param after Google redirect. Reads `sessionStorage.liftoff_redirect` and navigates on success. |
| `frontend-v2/client/src/pages/register.tsx` | Name, email, password, DOB form + Google signup button. |
| `frontend-v2/client/src/pages/history.tsx` | Protected. Fetches `GET /api/sessions/history`. Clickable session cards navigate to `/plan` via localStorage session ID. |
| `frontend-v2/client/src/pages/analysis.tsx` | Public (no auth). Fetches `GET /api/sessions/:sessionId/public`. Read-only plan view with CTA to `/register`. |
| `frontend-v2/client/src/components/ShareAnalysis.tsx` | "Share" button calls `POST /api/sessions/:id/share`. Shows copy link + X/WhatsApp share buttons once public. |
| `frontend-v2/client/src/components/UpgradePrompt.tsx` | Shown when `generatePlan` returns 429. Links to Stripe checkout with `?client_reference_id=<userId>`. |

#### Modified: `frontend-v2/client/src/lib/api.ts`
- Added `credentials: 'include'` to all fetch calls (required for cross-origin cookies)
- Error objects now include `err.status` and `err.upgradeUrl` for 429 detection
- New API namespaces: `authApi`, `historyApi`, `sessionApi`, `exerciseApi`, `paymentsApi`

#### Modified: `frontend-v2/client/src/App.tsx`
- Entire app wrapped in `<AuthProvider>`
- New routes: `/login`, `/register`, `/analysis/:sessionId` (public), `/history` (protected)
- Protected routes wrapped in `<ProtectedRoute>`: `/mvp`, `/onboarding`, `/snapshot`, `/diagnostic`, `/plan`, `/history`

#### Modified: `frontend-v2/client/src/pages/onboarding.tsx`
- Added 4 Olympic lifts to the lift picker (Clean & Jerk, Snatch, Power Clean, Hang Clean)
- Pre-populates form from `user` profile on mount (trainingAge, equipment, constraints, height, weight)
- After `createSession`, calls `authApi.updateProfile()` fire-and-forget to persist profile to account

#### Modified: `frontend-v2/client/src/pages/plan.tsx`
- Catches 429 from `generatePlan` → shows `<UpgradePrompt userId={user?.id} />`
- Added `<ShareAnalysis sessionId={sessionId} />` and "History" link in header
- Added `<AccessoryVideoCard exerciseId={...} exerciseName={...} />` inside each accessory card

#### Modified: `frontend-v2/client/src/pages/signup.tsx`
- Nav: "Sign In" + "Get Started" buttons (replace old "Try Demo")
- Hero CTA: "Get Started Free" → `/register` as primary action
- Waitlist demoted to secondary inline text link
- Bottom CTA: "Get Started Free" + "Sign In"

---

### Phase 6 — Olympic Lifting

#### `backend/src/data/lifts.ts`
Added 4 new lift definitions:
- `clean_and_jerk` — 4 phases (first_pull, second_pull, catch_clean, jerk), 3 limiters
- `snatch` — 5 phases (setup, first_pull, transition, second_pull, overhead_squat), 3 limiters
- `power_clean` — 3 phases (first_pull, second_pull, catch), 2 limiters
- `hang_clean` — 3 phases (hang_position, second_pull, catch), 2 limiters

#### `backend/src/data/exercises.ts`
Added Olympic-specific accessories:
- `overhead_squat`, `snatch_pull`, `clean_pull`, `push_press`, `hang_power_snatch`, `box_jump`, `wrist_curl`, `ankle_mobility`

#### `backend/src/engine/liftConfigs.ts`
Added 4 full `LiftConfig` exports:

| Config | Phases | Hypothesis Rules | Key Hypotheses |
|--------|--------|-----------------|----------------|
| `cleanAndJerkConfig` | first_pull, second_pull, catch_clean, jerk | 5 | hip_drive_deficit, front_rack_mobility_deficit, posterior_chain_weakness |
| `snatchConfig` | first_pull, transition, second_pull, overhead_squat | 4 | overhead_stability_deficit, hip_drive_deficit, mobility_restriction |
| `powerCleanConfig` | first_pull, second_pull, catch | 4 | posterior_chain_weakness, front_rack_mobility_deficit |
| `hangCleanConfig` | hang_position, second_pull, catch | 4 | hip_drive_deficit, upper_back_weakness, front_rack_mobility_deficit |

All 4 configs registered in the `liftConfigs` lookup map.

---

## Environment Variables Added

```bash
# backend/.env additions
JWT_SECRET=<64-char-hex>
JWT_EXPIRES_IN=30d
GOOGLE_CLIENT_ID=266105218292-05qcv53iltdp5bi7sn4qj7l7uh2j5r88.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<secret>
GOOGLE_CALLBACK_URL=https://luciuslab.xyz:4009/api/auth/google/callback
FRONTEND_URL=https://liftoffmvp.io
STRIPE_SECRET_KEY=<sk_live_...>
STRIPE_WEBHOOK_SECRET=          # ← FILL IN after Stripe Dashboard config
YOUTUBE_API_KEY=<key>
FREE_TIER_DAILY_LIMIT=2
```

---

## Key Technical Notes

1. **Cross-origin cookies** require `sameSite: 'none'` + `secure: true` on the cookie, `credentials: 'include'` on every frontend fetch, and `credentials: true` + specific origin (not `*`) in CORS config.

2. **`prisma db push` on SQLite with existing rows** — `updatedAt` must use `@default(now()) @updatedAt`, not just `@updatedAt`, otherwise the push fails.

3. **Stripe webhook raw body** — `express.raw({ type: 'application/json' })` must be registered for `/api/payments/webhook` BEFORE `express.json()` is registered.

4. **Rate limiting** gates only `POST /sessions/:id/generate` — the diagnostic interview remains free.

5. **`jwt.sign` expiresIn type** — newer `@types/jsonwebtoken` requires `as any` cast for string values due to `StringValue` type constraint.

---

## Remaining Infrastructure Tasks

| Task | Details |
|------|---------|
| Stripe webhook secret | Register `POST https://luciuslab.xyz:4009/api/payments/webhook` in Stripe Dashboard → copy `whsec_...` → add to `.env` as `STRIPE_WEBHOOK_SECRET` |
| Vercel deploy | Push `frontend-v2` to Vercel (`vercel --prod` in `frontend-v2/`) to get new auth pages live |
| Google OAuth console | Verify `https://luciuslab.xyz:4009/api/auth/google/callback` is listed as an authorized redirect URI in Google Cloud Console |

---

## Files Changed (30 total)

### New Backend Files
- `backend/src/middleware/requireAuth.ts`
- `backend/src/middleware/optionalAuth.ts`
- `backend/src/middleware/requireProTier.ts`
- `backend/src/middleware/rateLimit.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/payments.ts`
- `backend/src/services/stripeService.ts`
- `backend/src/services/youtubeService.ts`

### Modified Backend Files
- `backend/prisma/schema.prisma`
- `backend/src/index.ts`
- `backend/src/routes/sessions.ts`
- `backend/src/data/lifts.ts`
- `backend/src/data/exercises.ts`
- `backend/src/engine/liftConfigs.ts`
- `backend/package.json`
- `backend/.env`

### New Frontend Files
- `frontend-v2/client/src/context/AuthContext.tsx`
- `frontend-v2/client/src/components/ProtectedRoute.tsx`
- `frontend-v2/client/src/components/ShareAnalysis.tsx`
- `frontend-v2/client/src/components/UpgradePrompt.tsx`
- `frontend-v2/client/src/components/AccessoryVideoCard.tsx`
- `frontend-v2/client/src/pages/login.tsx`
- `frontend-v2/client/src/pages/register.tsx`
- `frontend-v2/client/src/pages/history.tsx`
- `frontend-v2/client/src/pages/analysis.tsx`

### Modified Frontend Files
- `frontend-v2/client/src/App.tsx`
- `frontend-v2/client/src/lib/api.ts`
- `frontend-v2/client/src/pages/onboarding.tsx`
- `frontend-v2/client/src/pages/plan.tsx`
- `frontend-v2/client/src/pages/signup.tsx`
