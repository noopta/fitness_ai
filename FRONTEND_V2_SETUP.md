# Frontend V2 Setup - Complete! ✅

## 🎉 Both UIs Now Running!

You now have **two frontends** running side-by-side, both connected to the same backend:

### Frontend #1 (Original MVP)
- **URL**: http://localhost:3000/
- **Tech**: React + Vite + shadcn/ui + React Router
- **Features**: Full MVP flow with animations

### Frontend #2 (GitHub Repo)
- **URL**: http://localhost:5000/
- **Tech**: React + Vite + shadcn/ui + Wouter
- **Source**: https://github.com/noopta/fitness_ai.git
- **Features**: Alternative UI design

### Backend API
- **URL**: http://localhost:3001/api
- **Serving**: Both frontends

---

## 📁 Project Structure

```
strengthTrainingApp/
├── backend/                    # Express + Prisma API (port 3001)
├── frontend/                   # Original MVP UI (port 3000)
├── frontend-v2/                # GitHub repo UI (port 5000)
│   ├── client/
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── signup.tsx
│   │   │   │   ├── onboarding.tsx  (lift selection)
│   │   │   │   ├── snapshot.tsx
│   │   │   │   ├── diagnostic.tsx
│   │   │   │   └── plan.tsx
│   │   │   └── lib/
│   │   │       └── api.ts      # NEW: Backend integration
│   │   └── .env                # API URL configuration
│   └── vite.config.ts          # Port 5000 + proxy setup
└── start-frontend-v2.bat       # Easy startup script
```

---

## 🔌 Backend Integration

Created `frontend-v2/client/src/lib/api.ts` with full API adapter:

```typescript
export const liftCoachApi = {
  getLifts()                    // GET /api/lifts
  getLiftExercises(liftId)      // GET /api/lifts/:id/exercises
  createSession(data)           // POST /api/sessions
  addSnapshot(sessionId, data)  // POST /api/sessions/:id/snapshots
  sendMessage(sessionId, msg)   // POST /api/sessions/:id/messages
  generatePlan(sessionId)       // POST /api/sessions/:id/generate
  getSession(sessionId)         // GET /api/sessions/:id
}
```

---

## 🚀 How to Start

### Start Everything
```bash
# Terminal 1 - Backend + Frontend #1 (already running)
npm run dev

# Terminal 2 - Frontend #2
.\start-frontend-v2.bat
```

### Or Start Frontend-v2 Manually
```bash
cd frontend-v2
npm run dev:client
```

---

## 🎨 UI Comparison

### Frontend #1 (Port 3000)
- ✅ Modern gradient backgrounds
- ✅ Framer Motion animations
- ✅ Card-based layouts
- ✅ Imperial unit toggles (ft/in, lbs)
- ✅ Complete diagnostic flow
- ✅ Plan download feature

### Frontend #2 (Port 5000)
- ✅ Clean, professional design
- ✅ Glass morphism effects
- ✅ Serif typography accents
- ✅ Step indicators
- ✅ Alternative layout approach
- ✅ Wouter routing (lighter than React Router)

---

## 📋 Frontend-v2 Pages

1. **Signup** (`/` or `/signup`)
   - Landing/auth page

2. **Onboarding** (`/mvp`)
   - Lift selection
   - Profile input (height, weight, training age)
   - Goal selection
   - Equipment and constraints

3. **Snapshot** (`/snapshot`)
   - Exercise entry form
   - Multiple exercises support
   - Weight/sets/reps/RPE input

4. **Diagnostic** (`/diagnostic`)
   - AI chat interface
   - Question/answer flow

5. **Plan** (`/plan`)
   - Generated workout plan
   - Diagnosis display
   - Accessories with explanations

---

## 🔧 Configuration

### Vite Config (frontend-v2/vite.config.ts)
```typescript
server: {
  port: 5000,
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    }
  }
}
```

### Environment (frontend-v2/client/.env)
```
VITE_API_URL=http://localhost:3001/api
```

---

## 🎯 Next Steps to Fully Integrate

The frontend-v2 is **running** but needs these integrations:

### 1. Connect Onboarding Page
Update `frontend-v2/client/src/pages/onboarding.tsx`:
- Call `liftCoachApi.createSession()` on submit
- Store session ID in state/localStorage
- Navigate to snapshot with session ID

### 2. Connect Snapshot Page
Update `frontend-v2/client/src/pages/snapshot.tsx`:
- Get session ID from URL/state
- Call `liftCoachApi.addSnapshot()` for each exercise
- Navigate to diagnostic with session ID

### 3. Connect Diagnostic Page
Update `frontend-v2/client/src/pages/diagnostic.tsx`:
- Get session ID from URL/state
- Call `liftCoachApi.sendMessage()` for each user message
- Handle AI responses
- Navigate to plan when complete

### 4. Connect Plan Page
Update `frontend-v2/client/src/pages/plan.tsx`:
- Get session ID from URL/state
- Call `liftCoachApi.generatePlan()` on load
- Display the generated plan

---

## 🔍 Testing Both UIs

### Test Flow - Frontend #1 (Port 3000)
1. Open http://localhost:3000/
2. Click "Start Your Diagnosis"
3. Select lift and fill profile
4. Add exercise snapshots
5. Complete diagnostic chat
6. View personalized plan

### Test Flow - Frontend #2 (Port 5000)
1. Open http://localhost:5000/
2. Redirects to `/signup`
3. Navigate to `/mvp` for onboarding
4. Fill out lift selection and profile
5. Continue through flow

---

## 💡 Key Differences

| Feature | Frontend #1 | Frontend #2 |
|---------|-------------|-------------|
| **Routing** | React Router | Wouter |
| **Styling** | Gradients + Cards | Glass morphism |
| **Typography** | Sans-serif | Serif accents |
| **Animations** | Framer Motion | Framer Motion |
| **Auth** | None | Signup page |
| **State** | Local | React Query ready |
| **Unit Toggle** | ✅ Implemented | ⏳ To implement |

---

## 📊 Current Status

✅ Frontend-v2 cloned from GitHub  
✅ Dependencies installed  
✅ Vite configured for port 5000  
✅ API adapter created  
✅ Proxy configured to backend  
✅ Server running successfully  
⏳ Pages need API integration  
⏳ Session management needed  
⏳ State persistence needed  

---

## 🎨 Design Philosophy

### Frontend #1
- Bold, modern, fitness-focused
- Bright gradients and animations
- Immediate visual feedback
- Consumer-friendly

### Frontend #2
- Professional, clean, minimalist
- Subtle glass effects
- Typography-driven
- Coach/professional-focused

---

## 🚀 Quick Commands

```bash
# View Frontend #1
start http://localhost:3000

# View Frontend #2
start http://localhost:5000

# View Backend API
start http://localhost:3001/api/lifts

# Stop Frontend #2
# Press Ctrl+C in the terminal running start-frontend-v2.bat
```

---

## 📝 Notes

- Node.js version warning is non-critical (20.17 vs 20.19 required)
- Both frontends share the same backend
- No database conflicts - same SQLite file
- Session IDs can be shared between UIs
- API responses are identical for both

---

**You now have two beautiful UIs to choose from!** 🎉

Compare them side-by-side and decide which design direction you prefer, or use elements from both!
