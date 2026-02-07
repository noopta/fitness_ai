# AI Integration Complete - Diagnostic Chat

## Overview
The diagnostic chat page is now fully integrated with your OpenAI-powered backend! The AI will dynamically ask questions based on the user's lift selection, their snapshot data, and previous answers to diagnose weak points accurately.

## What Changed

### Frontend (`frontend-v2/client/src/pages/diagnostic.tsx`)

#### ✅ 1. Removed Hardcoded Questions
- **Before**: Used scripted questions that didn't adapt to user context
- **After**: Real-time AI-generated questions from OpenAI via your backend

#### ✅ 2. Backend Integration
- Loads session ID from localStorage
- Calls `liftCoachApi.sendMessage()` to send user responses
- Receives dynamic AI questions based on context
- Handles "complete" state when AI has enough information

#### ✅ 3. Message Persistence
- Loads existing conversation history from backend on page load
- Resumes where user left off if they navigate away and come back
- All messages stored in database via Prisma

#### ✅ 4. Loading States
- Input shows "AI is thinking..." while waiting for response
- Send button pulses during AI processing
- Buttons disabled while loading to prevent duplicate sends

#### ✅ 5. UI Improvements
- Updated header logo to "LO" gradient (matches LiftOff branding)
- Question count now shows actual answered questions
- Status badge shows "In progress" or "Complete"
- Dynamic subtitle updates with question count

## How It Works

### Flow:
1. **User enters from Snapshot page** → Session ID stored in localStorage
2. **Diagnostic page loads** → Retrieves session data from backend
3. **AI asks first question** → Based on selected lift and snapshot data
4. **User answers** → Message sent to backend
5. **Backend processes** → OpenAI analyzes context and generates next question
6. **Repeat** until AI determines it has enough information
7. **Complete** → Shows "Generate plan" button

### Context AI Receives:
- Selected compound lift (e.g., "Flat Bench Press")
- User profile (height, weight, training age, equipment, constraints)
- Exercise snapshots (working weights, sets, reps, RPE/RIR)
- Full conversation history
- Goal (strength, balanced, or hypertrophy)

### Example AI Questions:
The AI dynamically generates questions like:
- "Where does the rep slow most—off the chest, mid-range, or lockout?"
- "Does the bar path shift toward your face or stomach when it gets heavy?"
- "What gives out first: chest, triceps, or shoulder stability?"
- "Any pain or discomfort? If yes, where exactly?"

These adapt based on:
- The lift selected (bench questions vs squat questions)
- Previous answers (follows up on specific weak points)
- Snapshot data (asks about specific exercises they entered)

## Backend API Endpoints Used

### `POST /api/sessions/:id/messages`
**Purpose**: Send user message, get AI response

**Request:**
```json
{
  "message": "lockout"
}
```

**Response (more questions):**
```json
{
  "complete": false,
  "message": "Does the bar drift toward your face or down toward your stomach as it gets heavy?"
}
```

**Response (complete):**
```json
{
  "complete": true,
  "message": "Diagnostic complete. Ready to generate your plan."
}
```

### `GET /api/sessions/:id`
**Purpose**: Load existing conversation history

**Response:**
```json
{
  "session": {
    "id": "session-123",
    "selectedLift": "flat_bench_press",
    "messages": [
      { "role": "assistant", "message": "Where does the rep slow most?" },
      { "role": "user", "message": "lockout" },
      { "role": "assistant", "message": "What fails first: triceps, chest, or shoulder stability?" }
    ]
  }
}
```

## AI Service (`backend/src/services/llmService.ts`)

The backend uses `generateDiagnosticQuestion()` which:
1. Takes user context (lift, snapshots, conversation history)
2. Sends structured prompt to OpenAI GPT-4
3. Receives targeted diagnostic question
4. Determines if enough information collected
5. Returns question or "complete" signal

## Features

### ✅ Smart Question Flow
- AI asks 4-8 questions (varies based on user responses)
- Stops early if it has enough information
- Asks follow-ups for ambiguous answers
- Adapts to different lifts and experience levels

### ✅ Context-Aware
- Knows what lift you're working on
- References your snapshot data
- Remembers previous answers
- Considers your equipment and constraints

### ✅ Error Handling
- Gracefully handles backend errors
- Shows toast notifications on failures
- Redirects to onboarding if no session found
- Disables inputs during loading

### ✅ User Experience
- Smooth animations for messages
- Auto-scrolls to latest message
- Shows typing indicators
- Clear "Complete" state

## Testing the AI

### 1. Complete the Flow:
```
1. Go to http://localhost:5000
2. Select a lift (e.g., Flat Bench Press)
3. Enter profile info → Continue
4. Fill in 2-3 exercises with weights → Continue
5. AI chat starts automatically
```

### 2. Answer Questions:
The AI will ask about your weak points. Example answers:
- "lockout" or "mid-range" or "off the chest"
- "triceps" or "chest" or "shoulders"
- "drifts to face" or "stays straight"
- "none" or "shoulder hurts"

### 3. Watch for Completion:
After 4-8 exchanges, AI will signal completion and show "Generate plan" button.

## Database Storage

All messages are stored in `DiagnosticMessage` table:
```sql
CREATE TABLE DiagnosticMessage (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

This enables:
- Conversation persistence
- Resume after navigation
- Training data for improving prompts
- Audit trail of AI interactions

## OpenAI Configuration

The backend uses your OpenAI API key from `.env`:
```env
OPENAI_API_KEY="sk-proj-..."
```

**Model**: GPT-4 (configurable in `llmService.ts`)
**Temperature**: 0.3 (focused and consistent)
**Max Tokens**: 150 (concise questions)

## Next Steps

The diagnostic conversation feeds into:
- **Plan Generation** (`POST /api/sessions/:id/generate`)
- Uses diagnosis to prescribe targeted accessories
- Identifies limiters with confidence scores
- Creates personalized workout plan

---

## Files Modified

- ✅ `frontend-v2/client/src/pages/diagnostic.tsx` - Full AI integration
- ✅ Backend already had endpoints ready (no changes needed!)

## Try It Now! 🚀

Go through the complete flow and watch the AI adapt its questions based on your answers. The diagnostic is now **fully powered by OpenAI** and will provide genuinely personalized workout recommendations!
