# Quick Setup Guide

## Step-by-Step Installation

### 1. Install All Dependencies

From the root directory:

```bash
npm install
```

This installs dependencies for both backend and frontend in one command.

### 2. Initialize the Database

```bash
cd backend
npm run prisma:generate
npm run prisma:push
cd ..
```

This creates the SQLite database and sets up the Prisma client.

### 3. Start the Application

From the root directory:

```bash
npm run dev
```

This starts both the backend (port 3001) and frontend (port 3000) simultaneously.

### 4. Access the Application

Open your browser and navigate to:
```
http://localhost:3000
```

The backend API will be available at:
```
http://localhost:3001
```

## Troubleshooting

### If ports are already in use:

**Backend (3001):**
Edit `backend/.env` and change PORT to another number.

**Frontend (3000):**
Edit `frontend/vite.config.ts` and change the server port.

### If you get module not found errors:

Make sure you're using Node.js 18 or higher:
```bash
node --version
```

### If Prisma generates errors:

Delete the existing database and regenerate:
```bash
cd backend
rm prisma/dev.db
npm run prisma:push
cd ..
```

### If the OpenAI API doesn't work:

The API key is already configured in the backend. If you need to update it, the key is stored in `backend/.env` (note: this file may be gitignored for security, but should exist with the provided key).

## Testing the Application

1. Click "Start Your Diagnosis" on the landing page
2. Select "Flat Bench Press" as your target lift
3. Choose your training experience level
4. Optionally add some exercise snapshots (or skip)
5. Answer the diagnostic questions from the AI coach
6. Review your personalized training plan!

## Development Tips

### Run Backend Only
```bash
npm run dev:backend
```

### Run Frontend Only
```bash
npm run dev:frontend
```

### View Database
```bash
cd backend
npm run prisma:studio
```

This opens Prisma Studio in your browser to view and edit database records.

### Build for Production
```bash
npm run build
```

## Project Structure Quick Reference

```
Root
├── backend/          # Express + Prisma API
│   ├── src/
│   │   ├── data/     # Exercise library & lift data
│   │   ├── engine/   # Rules engine
│   │   ├── routes/   # API endpoints
│   │   └── services/ # OpenAI integration
│   └── prisma/       # Database schema
│
└── frontend/         # React + Vite app
    └── src/
        ├── pages/    # Main app pages
        └── components/ui/  # shadcn/ui components
```

Enjoy using Lift Coach! 💪
