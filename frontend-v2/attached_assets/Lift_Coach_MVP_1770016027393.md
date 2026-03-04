
# Lift Coach MVP — Web App Specification

## Goal
Build a web app MVP that provides **lift-specific diagnostic coaching** for compound movements
(e.g. Flat Bench Press) using:
- Structured lift biomechanics knowledge
- User-entered *single-session* strength snapshots
- LLM-driven diagnostic questioning
- Deterministic rules + constrained AI reasoning

Primary value: turn *“I’m stuck on my bench”* into a **clear diagnosis + targeted accessories**.

---

## Supported Compound Lifts (MVP)
- Deadlift
- Barbell Back Squat
- Barbell Front Squat
- Flat Bench Press (recommended first)
- Incline Bench Press

---

## Core User Flow

### 1. Select Target Lift
User selects one standardized compound movement.

### 2. Enter Profile Context
Optional but recommended:
- Height
- Weight
- Body composition (lean / average / heavy)
- Training age (beginner / intermediate / advanced)
- Equipment access (home / commercial / limited)
- Injury or pain constraints
- Goal: strength peak / hypertrophy / balanced

### 3. Enter Current Strength Snapshot (Single Session)
The system detects **relevant exercises** for the selected lift.

User may optionally enter:
- Exercise
- Weight
- Sets
- Reps (e.g. 3x8)
- RPE or RIR (optional)

Example (Bench):
- Close-Grip Bench
- Incline Bench
- Overhead Press
- Triceps Pressdown
- Row variation

No historical data required.

### 4. Diagnostic Interview (LLM)
The LLM:
- Analyzes snapshot data + profile
- Asks 4–8 total questions max
- Uses follow-ups only if necessary
- Diagnoses sticking points and likely limiters

Example questions:
- Where does the rep slow most?
- Does the bar drift?
- What fails first?
- Any shoulder discomfort?

### 5. Generate Lift-Day Prescription
Output includes:
- Primary lift sets/reps/intensity
- 2 targeted accessories
- 1 stability/health accessory
- Optional hypertrophy accessory
- Progression rules
- What to track next session

---

## Key Design Principles
- Lift-centric, not muscle-split-centric
- Subjective input is expected and embraced
- LLM may *choose*, but not *invent*
- Safety-first volume and exercise constraints
- Always explain *why* an exercise is chosen

---

## System Architecture

### Deterministic Layer (Rules Engine)
Handles:
- Lift → phases mapping
- Phase → likely limiters
- Approved exercise library
- Volume and safety constraints

### LLM Layer
Handles:
- Natural language reasoning
- Interpreting user descriptions
- Asking clarifying questions
- Selecting from approved options
- Generating explanations

LLM output is strictly structured.

---

## Data Models

### User
- id
- height_cm (optional)
- weight_kg (optional)
- body_comp_tag
- training_age
- equipment
- constraints_text

### Session
- id
- user_id (optional)
- selected_lift
- goal
- created_at

### ExerciseSnapshot
- id
- session_id
- exercise_id
- weight
- sets
- reps_schema
- rpe_or_rir

### DiagnosticMessage
- id
- session_id
- role (user / assistant)
- message
- created_at

### GeneratedPlan
- id
- session_id
- plan_json
- plan_text
- created_at

---

## API Endpoints (MVP)

### Library
GET /api/lifts  
GET /api/lifts/:id/exercises  

### Sessions
POST /api/sessions  
POST /api/sessions/:id/snapshots  
POST /api/sessions/:id/messages  
POST /api/sessions/:id/generate  
GET /api/sessions/:id  

---

## LLM Output Schema (Plan)

```json
{
  "selected_lift": "flat_bench_press",
  "diagnosis": [
    {
      "limiter": "triceps_lockout_strength",
      "confidence": 0.72,
      "evidence": [
        "Reported lockout slowdown",
        "Low triceps accessory strength"
      ]
    }
  ],
  "bench_day_plan": {
    "primary_lift": {
      "exercise_id": "flat_bench_press",
      "sets": 4,
      "reps": 5,
      "intensity": "RIR 1–2",
      "rest_minutes": 3
    },
    "accessories": [
      {
        "exercise_id": "close_grip_bench_press",
        "sets": 3,
        "reps": "6–8",
        "why": "Lockout triceps emphasis"
      },
      {
        "exercise_id": "rope_pressdown",
        "sets": 3,
        "reps": "10–15",
        "why": "High-volume triceps endurance"
      },
      {
        "exercise_id": "chest_supported_row",
        "sets": 4,
        "reps": "8–12",
        "why": "Pressing stability"
      }
    ]
  },
  "progression_rules": [
    "Add load when top reps hit at target RIR"
  ],
  "track_next_time": [
    "Sticking point shift",
    "RPE at same load"
  ]
}
```

---

## Frontend Pages
1. Landing
2. Lift Selection + Profile
3. Snapshot Entry
4. Diagnostic Chat
5. Plan Output

---

## MVP Exercise Library
- Bench variations
- Triceps isolations
- Upper back stability
- Shoulder support

Stored as JSON with tags:
- target_phase
- target_muscle
- fatigue_cost
- contraindications

---

## Risks & Mitigations
- Hallucinated advice → constrained exercise library
- User misdiagnosis → behavioral questions
- Overload → training-age volume caps

---

## Success Metrics
- Completion rate
- Re-run usage
- Saved/exported plans
- User-rated usefulness

---

## Future Extensions
- Video form analysis
- Velocity-based inputs
- Multiple lift days
- Outcome learning
- Camera-based body analysis (opt-in)

---

This MVP encodes **coach-level reasoning** into a safe, explainable, lift-centric system.
