# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (`cd backend`)
```bash
npm run dev              # Dev with hot reload (tsx watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled dist/index.js (production)
npm test                 # Run all tests (vitest run)
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npx prisma db push       # Sync schema to SQLite
npx prisma generate      # Regenerate Prisma client after schema changes
npx prisma studio        # Open DB GUI (port 5555)
```

### Frontend (`cd frontend-v2`)
```bash
npm run dev:client       # Vite dev server on port 5000
npm run build            # Production build
npm test                 # Run all tests (vitest run, happy-dom)
npm run test:watch       # Watch mode
npm run check            # TypeScript type check only
```

### Running a single test
```bash
# Backend
cd backend && npx vitest run src/__tests__/diagnosticEngine.test.ts

# Frontend
cd frontend-v2 && npx vitest run client/src/__tests__/api.test.ts
```

## Architecture

### Two frontends — use `frontend-v2/` only
`frontend/` is deprecated. All active development is in `frontend-v2/`.

### Backend (`backend/src/`)
- **`index.ts`** — Express app setup: CORS, cookie parser, route registration
- **`routes/`** — API endpoints (sessions, auth, payments, coach, nutrition, wellness, library, waitlist)
- **`middleware/`** — `requireAuth`, `optionalAuth` (JWT cookie `liftoff_jwt` + Bearer), `checkAnalysisRateLimit` (free tier: 2/day), `requireProTier`
- **`engine/`** — Deterministic diagnostic engine (no LLM; see below)
- **`services/`** — External API wrappers: `llmService.ts` (OpenAI), `stripeService.ts`, `youtubeService.js`
- **`data/`** — Static exercise/lift library JSON-like data

### Diagnostic Engine (`backend/src/engine/`)
Three files work together:

1. **`diagnosticEngine.ts`** — Pure deterministic scoring engine. No LLM, no side effects. Takes `DiagnosticEngineInput` (snapshots, flags, bodyweight, trainingAge, equipment) and returns `DiagnosticSignals`:
   - e1RMs (Epley formula, clamped to ≤10 reps for confidence)
   - Index scores (quad_index, posterior_index, back_tension_index, triceps_index, shoulder_index)
   - Phase scores → primary_phase + confidence
   - Hypothesis scores (top 3–5 candidates)
   - Dominance archetype (±15 threshold)
   - Efficiency score (40–95 range)
   - Validation test recommendation

2. **`liftConfigs.ts`** — Data-only rules (1890 lines). To change diagnosis behavior, **edit configs here** — no logic changes needed. Each lift config defines `phaseRules`, `hypothesisRules`, `indexMappings`, and `validationTests`.

3. **`rulesEngine.ts`** — Higher-level logic: volume constraints by training age, accessory selection, intensity recommendations, and `analyzeSnapshotStrengthRatios`. Feature flag `USE_ENGINE_FOR_RATIO_ANALYSIS = false` — legacy heuristics still active in production; new engine runs in parallel for QA logging only.

### Frontend (`frontend-v2/client/src/`)
- **`App.tsx`** — Wouter router (lightweight, NOT React Router)
- **`context/AuthContext.tsx`** — Auth state, login/logout, JWT management
- **`components/ProtectedRoute.tsx`** — Redirects unauthenticated users
- **`lib/api.ts`** — HTTP client; all calls include `credentials: 'include'` (cross-domain cookies)
- **`pages/`** — One file per route: signup, login, register, onboarding, snapshot, diagnostic, plan, history, coach, analysis

### Database
SQLite via Prisma. Schema at `backend/prisma/schema.prisma`. Key models:
- **User** — Auth, profile, tier (free/pro/enterprise), OpenAI coach thread
- **Session** — Diagnostic session per lift (selectedLift, goal, threadId)
- **ExerciseSnapshot** — Weight/sets/reps/RPE per exercise
- **DiagnosticMessage** — Chat history (role: user|assistant)
- **GeneratedPlan** — Stored plan JSON + text
- **NutritionLog**, **WellnessCheckin**, **VideoCache**

### Auth & Payments
- JWT stored in httpOnly cookie (`liftoff_jwt`), also accepted as Bearer token
- `sameSite: 'none'`, `secure: true` required for cross-domain (Vercel → EC2)
- Google OAuth: `/api/auth/google` → `/api/auth/google/callback` → `${FRONTEND_URL}?auth=success`
- Stripe checkout URL: `https://buy.stripe.com/...?client_reference_id=<userId>`
- `STRIPE_WEBHOOK_SECRET` must be filled in `.env` when configuring Stripe dashboard

### LLM Integration
- **Plan generation** — GPT-4 via `llmService.ts` (chat completions)
- **Diagnostic interview** — GPT-4 structured responses
- **Coach chat** — OpenAI Assistants API threads (`OPENAI_ASSISTANT_ID` env var); thread IDs stored on User model

## Testing Notes
- **Frontend uses `happy-dom`**, not jsdom. jsdom v25+ has `@exodus/bytes` ESM incompatibility with vitest's forks pool.
- Prisma mocks require the constructor form: `vi.fn(function(this: any) { this.user = mock; })` — arrow functions break `this` binding.
- When implementing any notable function, API endpoint, etc. be sure to include unit testing for it 
- For front end unit tests, include them as well for changes but more so for larger changes 

## Deployment
- **Backend:** systemd `fitness-ai.service`, port 3051, proxied via Nginx at `https://api.airthreads.ai:4009`
- **Frontend:** Vercel (see `frontend-v2/vercel.json`)
- After backend changes: `npm run build` in `backend/`, then `sudo systemctl restart fitness-ai.service`


### Github
- When making any backend or front end bulk changes, be sure to push to the repo when done by default

