# LiftOff - AI-Powered Lift Diagnostics

## Overview
LiftOff is an AI-powered strength training diagnostic web application that helps lifters identify limiting factors and provides personalized training programs with targeted accessories for compound movements (bench press, squat, deadlift).

## Project Architecture
The primary application lives in `frontend-v2/` — a full-stack Express + Vite React app served on port 5000.

### Directory Structure
- `frontend-v2/` — Main application
  - `client/` — React frontend (Vite, React 19, Tailwind CSS v4, shadcn/ui, wouter)
  - `server/` — Express backend (TypeScript, Express 5)
  - `shared/` — Shared types and Drizzle schema
  - `attached_assets/` — Static assets
- `backend/` — Legacy backend (Prisma + SQLite, not actively used)

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui, wouter, Framer Motion
- **Backend**: Express 5, TypeScript, tsx
- **Database**: PostgreSQL (Neon-backed via Replit), Drizzle ORM
- **Storage**: In-memory (MemStorage) for user data currently

### Key Configuration
- Port: 5000 (both API and frontend served together)
- Host: 0.0.0.0
- Vite: allowedHosts enabled for Replit proxy
- Database: PostgreSQL via DATABASE_URL env var
- Build: `npm run build` in frontend-v2 (Vite + esbuild)
- Production: `npm run start` in frontend-v2 (Node.js serving static + API)

### Scripts (frontend-v2)
- `npm run dev` — Development server with Vite HMR
- `npm run build` — Build for production
- `npm run start` — Run production build
- `npm run db:push` — Push Drizzle schema to database

## Recent Changes
- Initial Replit environment setup (Feb 2026)
- PostgreSQL database provisioned
- Drizzle schema pushed

## User Preferences
- None documented yet
