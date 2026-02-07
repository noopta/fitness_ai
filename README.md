# Lift Coach MVP

AI-powered strength training diagnostic web application that provides lift-specific coaching for compound movements.

## Overview

Lift Coach helps lifters identify their limiting factors and provides personalized training programs with targeted accessories. Turn "I'm stuck on my bench" into a clear diagnosis with actionable training recommendations.

### Supported Lifts
- Flat Bench Press
- Incline Bench Press
- Deadlift
- Barbell Back Squat
- Barbell Front Squat

## Features

- **Lift-Specific Analysis**: Focused diagnostics for each compound movement
- **AI-Powered Diagnostic Interview**: 4-8 smart questions to identify sticking points
- **Personalized Programming**: Targeted accessories based on your specific limiters
- **Evidence-Based Recommendations**: Clear explanations for every exercise choice
- **Modern UI**: Beautiful, smooth animations and responsive design

## Tech Stack

### Backend
- Node.js + Express + TypeScript
- Prisma ORM with SQLite
- OpenAI GPT-4 for diagnostic reasoning
- Structured rules engine for biomechanics knowledge

### Frontend
- React 18 + TypeScript
- Vite for fast development
- shadcn/ui component library
- Tailwind CSS for styling
- Framer Motion for animations
- React Router for navigation

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- OpenAI API key (provided in project)

### Installation

1. **Install dependencies for the entire project:**

```bash
npm install
```

This will install dependencies for both backend and frontend workspaces.

2. **Set up the backend:**

```bash
cd backend
npm run prisma:generate
npm run prisma:push
```

This creates the SQLite database and generates the Prisma client.

### Running the Application

From the root directory, run both frontend and backend simultaneously:

```bash
npm run dev
```

This will start:
- Backend API on http://localhost:3001
- Frontend on http://localhost:3000

Or run them separately:

```bash
# Terminal 1 - Backend
npm run dev:backend

# Terminal 2 - Frontend
npm run dev:frontend
```

## Project Structure

```
strengthTrainingApp/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # Database schema
│   ├── src/
│   │   ├── data/
│   │   │   ├── exercises.ts       # Exercise library
│   │   │   └── lifts.ts          # Lift biomechanics data
│   │   ├── engine/
│   │   │   └── rulesEngine.ts    # Deterministic rules
│   │   ├── routes/
│   │   │   ├── library.ts        # Lift/exercise endpoints
│   │   │   └── sessions.ts       # Session/diagnostic endpoints
│   │   ├── services/
│   │   │   └── llmService.ts     # OpenAI integration
│   │   └── index.ts              # Express app
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/ui/        # shadcn/ui components
│   │   ├── pages/               # Main application pages
│   │   │   ├── Landing.tsx
│   │   │   ├── LiftSelection.tsx
│   │   │   ├── SnapshotEntry.tsx
│   │   │   ├── DiagnosticChat.tsx
│   │   │   └── PlanOutput.tsx
│   │   ├── lib/
│   │   │   └── utils.ts         # Helper functions
│   │   ├── types/
│   │   │   └── index.ts         # TypeScript types
│   │   ├── App.tsx              # Router setup
│   │   └── main.tsx
│   └── package.json
└── package.json                  # Root workspace config
```

## User Flow

1. **Landing Page** - Introduction to the app
2. **Lift Selection** - Choose target lift and enter profile (optional)
3. **Snapshot Entry** - Add recent strength performance data (optional)
4. **Diagnostic Chat** - AI-powered interview to identify limiters
5. **Plan Output** - Personalized training program with accessories

## API Endpoints

### Library
- `GET /api/lifts` - Get all supported lifts
- `GET /api/lifts/:id/exercises` - Get relevant exercises for a lift

### Sessions
- `POST /api/sessions` - Create new diagnostic session
- `POST /api/sessions/:id/snapshots` - Add exercise snapshot
- `POST /api/sessions/:id/messages` - Send diagnostic message
- `POST /api/sessions/:id/generate` - Generate workout plan
- `GET /api/sessions/:id` - Get session details

## Design Principles

- **Lift-centric, not muscle-split-centric**
- **Subjective input is expected and embraced**
- **LLM may choose, but not invent** - All exercises come from approved library
- **Safety-first volume constraints** - Based on training age
- **Always explain why** - Every exercise choice is justified

## Development

### Backend Development

```bash
cd backend
npm run dev              # Start with hot reload
npm run prisma:studio    # Open Prisma Studio (database GUI)
```

### Frontend Development

```bash
cd frontend
npm run dev              # Start Vite dev server
npm run build            # Build for production
```

## Environment Variables

Backend `.env` file (already configured):
```
PORT=3001
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=your_api_key_here
```

## Key Features Implemented

### Deterministic Rules Engine
- Lift phases and biomechanics mapping
- Volume constraints based on training age
- Exercise approval and filtering
- Equipment and injury constraints

### LLM Integration
- Structured diagnostic questioning
- Evidence-based limiter identification
- JSON-structured plan generation
- Contextual follow-up questions

### Modern UI/UX
- Smooth page transitions with Framer Motion
- Progressive form filling
- Real-time chat interface
- Responsive design for all screen sizes
- Clean, minimalist aesthetic

## Future Enhancements

- Video form analysis
- Velocity-based training inputs
- Multiple lift days coordination
- Outcome tracking and learning
- Progressive overload automation
- Exercise demonstration videos

## License

This is an MVP project for demonstration purposes.

---

Built with ❤️ for strength athletes everywhere.
