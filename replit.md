# LiftOff / Axiom - AI-Powered Lift Diagnostics

## Overview
LiftOff (Axiom) is an AI-powered strength training diagnostic platform that helps lifters identify limiting factors and provides personalized training programs with targeted accessories for compound movements (bench press, squat, deadlift). The project includes both a web app and a React Native mobile app.

## Project Architecture
All backend logic runs on a remote EC2 server. The project contains two frontends:
1. `frontend-v2/` — React web app served on port 5000 via Express
2. `mobile/` — React Native / Expo mobile app (also previews on port 5000 via Expo web)

### Directory Structure
- `frontend-v2/` — Web application
  - `client/` — React frontend (Vite, React 19, Tailwind CSS v4, shadcn/ui, wouter)
  - `server/` — Express server for serving frontend (TypeScript, Express 5)
  - `shared/` — Shared types and Drizzle schema
  - `attached_assets/` — Static assets and documentation
- `mobile/` — React Native / Expo mobile app
  - `app/` — Expo Router file-based routes
    - `(auth)/` — Auth screens (login, register)
    - `(tabs)/` — Main tab screens (home, coach, history, settings)
    - `diagnostic/` — Diagnostic funnel (onboarding → snapshot → chat → plan)
    - `analysis/[sessionId].tsx` — Session detail view
  - `src/` — Source code
    - `components/ui/` — Reusable UI primitives (Button, Card, Input, Badge, Skeleton)
    - `components/plan/` — Plan visualization (StrengthRadar, PhaseBreakdown, HypothesisRankings)
    - `constants/theme.ts` — Design tokens (colors, spacing, radius, typography)
    - `context/AuthContext.tsx` — Auth state management with AsyncStorage persistence
    - `lib/api.ts` — API client with all endpoints and TypeScript types
  - `assets/` — App icons and images
- `backend/` — Legacy backend (NOT used — backend runs on remote EC2)

### Tech Stack
- **Web Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui, wouter, Framer Motion
- **Mobile App**: React Native 0.81, Expo SDK 54, Expo Router v6, TypeScript, React Query v5
- **Local Server**: Express 5, TypeScript, tsx (serves web frontend only)
- **Remote Backend**: EC2 at `https://api.airthreads.ai:4009` (Node.js + Express + Prisma + SQLite + OpenAI GPT-4)

### Remote Backend API
Base URL: `https://api.airthreads.ai:4009/api`

Endpoints:
- `GET /health` — Health check
- `GET /api/lifts` — Get all supported lifts
- `GET /api/lifts/:id/exercises` — Get exercises for a lift
- `POST /api/sessions` — Create diagnostic session
- `POST /api/sessions/:id/snapshots` — Add exercise snapshots
- `POST /api/sessions/:id/messages` — Send diagnostic message
- `POST /api/sessions/:id/generate` — Generate workout plan
- `GET /api/sessions/:id` — Get session details
- `GET /api/sessions/:id/plan` — Get cached plan
- `GET /api/sessions/history` — Get session history
- `POST /api/auth/login` — Login
- `POST /api/auth/register` — Register
- `GET /api/auth/me` — Get current user
- `POST /api/auth/logout` — Logout
- `PUT /api/auth/profile` — Update profile
- `POST /api/waitlist` — Join waitlist

### Key Configuration
- Port: 5000 (both web frontend and Expo web preview use this port)
- Host: 0.0.0.0
- Web app: Vite allowedHosts enabled for Replit proxy
- Mobile app: Expo Router with file-based routing, dark theme
- Mobile auth: AsyncStorage-based token persistence (Bearer token header)
- Web auth: Cookie-based sessions (credentials: 'include')

### Workflows
- **Dev Server** — Expo dev server for mobile app (`cd mobile && npx expo start --web --port 5000`)
- **EAS Init/Update/Build** — EAS CLI workflows for publishing

### Scripts
- `mobile/`: `npm start` — Expo dev server
- `frontend-v2/`: `npm run dev` — Vite dev server, `npm run build` — Production build

## Mobile App Features
1. **Auth**: Login/Register with email & password, Google OAuth (via expo-web-browser), AsyncStorage token persistence
2. **Home Tab**: Welcome screen with "Start Diagnosis" CTA and feature overview
3. **Diagnostic Funnel**:
   - Onboarding: Lift selection (bench/squat/deadlift/Olympic lifts), profile inputs, imperial unit entry
   - Snapshot: Accessory exercise weight entry with exercise picker
   - Chat: AI diagnostic interview with chat bubbles
   - Plan: Full results with diagnosis, StrengthRadar bars, PhaseBreakdown, HypothesisRankings, accessories ranked by impact
4. **Coach Tab**: Pro feature with program/nutrition/analytics sections (gated by tier)
5. **History Tab**: Session list with completion status, links to analysis detail view
6. **Settings Tab**: Profile display, subscription info, sign out
7. **Analysis Detail**: Full session review with diagnosis, snapshots, plan, chat history

## User Preferences
- Uses remote EC2 backend — local backend code should NOT run
- Imperial units for user input (lbs, feet/inches), converted to metric for backend
- Dark theme matching web app color palette

## Theme (Dark Mode)
- Primary: `#fafafa` (near-white), PrimaryForeground: `#09090b` (near-black)
- Background/Card: `#09090b`, Foreground: `#fafafa`
- Muted/Border/Secondary/Accent: `#27272a`, MutedForeground: `#a1a1aa`
- Destructive: `#7f1d1d`, Success: `#22c55e`, Warning: `#f59e0b`

## Recent Changes
- Synced `mobileAlt/` from GitHub repo `noopta/fitness_ai` (Mar 2026)
- Dev Server workflow now runs from `mobileAlt/` directory
- Using Expo SDK 54 / React Native 0.81.5 / React 19.1.0 / Expo Router v6
- Fixed `expo-secure-store` web compatibility: falls back to AsyncStorage on web, SecureStore on native (`src/lib/api.ts`)
- Added missing `app/diagnostic/_layout.tsx` default export (Stack navigator)
- Installed missing deps: `expo-asset`, `expo-font`, `react-dom`, `react-native-web`
- App renders welcome screen with Log In / Get Started on web preview
- CORS blocks API calls on web preview (expected; works on native devices)
- `mobile/` directory contains the older rebuilt version

### Bug Fixes (Mar 2026)
- **Coach Tab**: `initCoach()` now fetches `getProgram()` in parallel with `getMessages()`, resolves program from API `program` field, `user.savedProgram`, or `data.savedProgram` with proper JSON string parsing
- **OverviewTab**: Unwraps `todaySession` from `getToday()` response; supports `day`/`focus` fields from API
- **ProgramTab**: Reads `phase.trainingDays` (not just `phase.days`), `phase.phaseName` (not just `phase.name`), `phase.durationWeeks`/`weeksLabel`, `day.day`, and `ex.intensity` from API response
- **NutritionTab**: Extracts macros from `nutritionPlan.macros` sub-object (API structure: `{macros, foods, rationale, impact, expectedOutcomes}`); supports `proteinG`/`carbsG`/`fatG` camelCase field names
- **Meal Suggestions**: API returns meal objects (not strings); now formats `{name, description, macros, prepMinutes}` into readable text
- **WellnessTab**: `CheckinEntry` interface updated for backend fields (`stress`, `energy`, numeric `mood`); `moodEmoji()` handles both numeric (1-5) and string moods; fatigue column shows `stress` field; fixed `colMood` font size with explicit `moodCellText` style
- **Chat (diagnostic)**: Reads `sessionId` from URL params via `useLocalSearchParams`, falls back to AsyncStorage; syncs resolved ID back to storage
- **Settings Portal**: Expanded URL field coverage (`portal_url`, `sessionUrl`); context-specific error messages for Stripe issues; added debug logging
- **Coach `handleProgramSave`**: Now uses same robust program parsing as `initCoach()` (handles JSON strings, nested `program`/`savedProgram` fields)
- **Plan screen**: Unwraps `cached.plan` / `generated.plan` response wrapper; fixed `handleNewAnalysis` clearing wrong AsyncStorage key (`liftoff_session_id` → `axiom_session_id`)
- **AnalyticsTab**: Fixed weight unit mismatch (kg → lbs), handles `weightLbs` field from API, user-friendly error for read-only database errors
