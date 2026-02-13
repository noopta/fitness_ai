# LiftOff - AI-Powered Lift Diagnostics

## Overview
LiftOff is an AI-powered strength training diagnostic web application that helps lifters identify limiting factors and provides personalized training programs with targeted accessories for compound movements (bench press, squat, deadlift).

## Project Architecture
The primary application lives in `frontend-v2/` — a React frontend served on port 5000 via Express. All backend logic runs on a remote EC2 server.

### Directory Structure
- `frontend-v2/` — Main application
  - `client/` — React frontend (Vite, React 19, Tailwind CSS v4, shadcn/ui, wouter)
  - `server/` — Express server for serving frontend (TypeScript, Express 5)
  - `shared/` — Shared types and Drizzle schema
  - `attached_assets/` — Static assets and documentation
- `backend/` — Legacy backend (Prisma + SQLite, NOT used — backend runs on remote EC2)

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui, wouter, Framer Motion
- **Local Server**: Express 5, TypeScript, tsx (serves frontend only)
- **Remote Backend**: EC2 at `https://luciuslab.xyz:4009` (Node.js + Express + Prisma + SQLite + OpenAI GPT-4)
- **Database**: PostgreSQL provisioned on Replit (for local schema), remote backend uses SQLite

### Remote Backend API
Base URL: `https://luciuslab.xyz:4009/api`

Endpoints:
- `GET /health` — Health check
- `GET /api/lifts` — Get all supported lifts (returns array directly)
- `GET /api/lifts/:id/exercises` — Get exercises for a lift (returns array directly)
- `POST /api/sessions` — Create diagnostic session (returns flat `{sessionId, ...}`)
- `POST /api/sessions/:id/snapshots` — Add exercise snapshots (expects `{snapshots: [...]}`)
- `POST /api/sessions/:id/messages` — Send diagnostic message (returns `{aiResponse, complete, ...}`)
- `POST /api/sessions/:id/generate` — Generate workout plan (returns `{plan: {...}}`)
- `GET /api/sessions/:id` — Get session details (returns flat object)
- `POST /api/waitlist` — Join waitlist (sends SMS + email notifications)

### Key Configuration
- Port: 5000 (frontend served via Express)
- Host: 0.0.0.0
- Vite: allowedHosts enabled for Replit proxy
- Build: `npm run build` in frontend-v2 (Vite + esbuild)
- Production: `npm run start` in frontend-v2 (Node.js serving static files)

### Scripts (frontend-v2)
- `npm run dev` — Development server with Vite HMR
- `npm run build` — Build for production
- `npm run start` — Run production build

## Recent Changes
- Initial Replit environment setup (Feb 2026)
- Redirected all API calls to remote EC2 backend at `https://luciuslab.xyz:4009`
- Aligned frontend interfaces and API methods with backend spec (Feb 13, 2026):
  - Updated response shapes (flat objects, no wrapping)
  - Fixed snapshot payload format (`{snapshots: [...]}` with correct fields)
  - Fixed diagnostic chat to use `aiResponse` field
  - Rewrote plan page for new WorkoutPlan structure (diagnosis + accessories + implementation)
  - Added `joinWaitlist` to API client

## User Preferences
- Uses remote EC2 backend — local backend code should NOT run
- Imperial units for user input (lbs, feet/inches), converted to metric for backend
