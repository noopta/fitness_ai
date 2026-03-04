# Backend Changes — What the Frontend Needs to Know

> **Backend URL:** `https://luciuslab.xyz:4009` (port 4009, SSL)  
> **Frontend:** Vite app (frontend-v2), typically run locally or served separately.

---

## 1. New Fields You Can Send on `POST /api/sessions`

The profile object now accepts two new optional fields that improve diagnosis quality:

```json
{
  "selectedLift": "flat_bench_press",
  "goal": "strength_peak",
  "profile": {
    "trainingAge": "intermediate",
    "equipment": "commercial",
    "weightKg": 90.0,
    "heightCm": 177.8,
    "constraintsText": "shoulder impingement"
  }
}
```

| Field         | Type   | Values                                      | Notes                                                                 |
|---------------|--------|---------------------------------------------|-----------------------------------------------------------------------|
| `trainingAge` | string | `"beginner"` \| `"intermediate"` \| `"advanced"` | Fed into the diagnostic engine; affects phase rules and validation.   |
| `equipment`   | string | `"commercial"` \| `"limited"` \| `"home"`   | Affects which phase rules fire and how the efficiency score is computed. |

The more accurate these are, the better the diagnosis.

---

## 2. Three New Fields on Plan Response (`POST /api/sessions/:id/generate`)

The plan object now includes three optional engine-computed fields:

```json
{
  "plan": {
    "selected_lift": "...",
    "diagnosis": [...],
    "bench_day_plan": {...},
    "progression_rules": [...],
    "track_next_time": [...],

    "dominance_archetype": {
      "label": "Anterior Chain Dominant",
      "rationale": "Your quad-to-posterior ratio indicates..."
    },

    "efficiency_score": {
      "score": 72,
      "explanation": "Deductions for tricep bottleneck and low posterior stability..."
    },

    "validation_test": {
      "description": "Close-Grip Bench Warm-Up Test",
      "how_to_run": "Perform 3 reps at 70% of your bench 1RM with a close grip...",
      "hypothesis_tested": "triceps_lockout_strength"
    }
  }
}
```

**All three are optional** — they will be `undefined` if the engine doesn't have enough snapshot data to compute them confidently (e.g. no proxy lifts entered in the snapshot step). **Render them conditionally.**

---

## 3. How `sessionFlags` Are Captured (No Frontend Action Needed)

The backend now parses natural language from the diagnostic conversation into structured flags automatically (e.g. *"it's hard at lockout"* → `hard_at_lockout: true`). The frontend does not need to send anything new for this — it happens server-side from the conversation history.

---

## 4. What's Already Wired Up in frontend-v2

| File            | Status                                                                 |
|-----------------|-----------------------------------------------------------------------|
| `onboarding.tsx`| Training Age + Equipment dropdowns added; values persisted to localStorage and sent in profile |
| `api.ts`        | `WorkoutPlan` type updated with the three new optional fields         |
| `plan.tsx`      | Three new cards render conditionally in the right column when the engine returns data |

---

## Quick Reference: API Base URL

Set `VITE_API_URL` in `.env` to override the default:

```
VITE_API_URL=https://luciuslab.xyz:4009/api
```

Default (if unset): `https://luciuslab.xyz:4009/api`
