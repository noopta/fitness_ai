# Profile Fields Cleanup 🧹

## Changes Made

### Removed Irrelevant Fields ✅

The following fields have been removed from the onboarding profile section:

1. **Training Experience** (Beginner/Intermediate/Advanced)
2. **Equipment Access** (Commercial Gym/Home Gym/Limited)

**Rationale**: These fields were not being used for AI diagnosis and added unnecessary friction to the onboarding flow.

---

## What Remains in Profile Section

The profile section now includes only essential and optional fields:

### Physical Metrics (Optional)
- **Height** (feet and inches)
- **Weight** (lbs)

### Constraints (Optional)
- **Injuries or Constraints** (free text)
  - e.g., "shoulder impingement, lower back sensitivity"

---

## Files Modified

**`frontend-v2/client/src/pages/onboarding.tsx`**

### Changes:
```diff
- Removed trainingAge state variable
- Removed equipment state variable
- Removed Select import (no longer needed)
- Removed Training Experience Select component
- Removed Equipment Access Select component
- Updated profile object to exclude these fields
```

---

## Updated Onboarding Flow

### Step 1: Select Target Lift
```
┌─────────────────────────────────┐
│ Select Your Target Lift         │
│ ✓ Flat Bench Press              │
└─────────────────────────────────┘
```

### Step 2: Enter Current Lift Stats
```
┌─────────────────────────────────┐
│ Your Current Flat Bench Press   │
│ Weight: [185] lbs               │
│ Sets: [3]                       │
│ Reps: [8]                       │
└─────────────────────────────────┘
```

### Step 3: Profile (Optional) ✨ SIMPLIFIED
```
┌─────────────────────────────────┐
│ Your Profile (Optional)          │
│                                  │
│ Height: [5] ft [10] in          │
│ Weight: [175] lbs               │
│                                  │
│ Injuries/Constraints:            │
│ [Optional free text...]         │
└─────────────────────────────────┘
```

---

## Benefits

### ✅ Faster Onboarding
- Fewer fields to fill
- Less cognitive load
- Quicker to complete

### ✅ Less Clutter
- Cleaner UI
- Focus on essential data
- Better user experience

### ✅ Maintained Context
- Still captures height/weight for body mechanics
- Still captures injuries/constraints for safety
- Target lift stats remain the priority

---

## Data Sent to Backend

### Before:
```json
{
  "selectedLift": "flat_bench_press",
  "goal": "strength_peak",
  "profile": {
    "heightCm": 177.8,
    "weightKg": 79.4,
    "trainingAge": "intermediate",
    "equipment": "commercial",
    "constraintsText": "shoulder impingement"
  }
}
```

### After:
```json
{
  "selectedLift": "flat_bench_press",
  "goal": "strength_peak",
  "profile": {
    "heightCm": 177.8,
    "weightKg": 79.4,
    "constraintsText": "shoulder impingement"
  }
}
```

---

## Profile Section Visual

### Before:
```
┌──────────────────────────────────┐
│ Your Profile                      │
├──────────────────────────────────┤
│ Height: [__] ft [__] in          │
│ Weight: [___] lbs                │
│                                   │
│ Training Experience: [dropdown]   │ ← REMOVED
│ Equipment Access: [dropdown]      │ ← REMOVED
│                                   │
│ Injuries/Constraints: [textarea]  │
└──────────────────────────────────┘
```

### After:
```
┌──────────────────────────────────┐
│ Your Profile                      │
├──────────────────────────────────┤
│ Height: [__] ft [__] in          │
│ Weight: [___] lbs                │
│                                   │
│ Injuries/Constraints: [textarea]  │
└──────────────────────────────────┘
```

**Result**: 2 fields removed, cleaner layout!

---

## Code Changes Summary

| Change | Lines Affected | Impact |
|--------|----------------|--------|
| Removed state variables | -2 lines | Simpler state management |
| Removed Select import | -1 line | Cleaner imports |
| Removed UI fields | -29 lines | Cleaner UI |
| Updated profile object | -2 properties | Simpler data structure |
| **Total** | **-34 lines** | **More focused onboarding** |

---

## Testing Checklist

- [x] Code compiles without errors
- [x] No linter errors
- [ ] Profile section displays correctly
- [ ] Height and weight inputs work
- [ ] Constraints textarea works
- [ ] All fields optional (can continue without filling)
- [ ] Session creates successfully
- [ ] Backend receives correct data structure

---

## User Impact

### Before:
- 7 total input fields in profile
- Some fields felt irrelevant
- Users wondering if they needed to fill everything

### After:
- 4 total input fields in profile
- All fields feel relevant
- Clearer that profile is optional
- Faster completion time

---

## Next Steps

The onboarding flow is now streamlined to:
1. **Required**: Target lift selection
2. **Required**: Current lift stats (weight, sets, reps)
3. **Optional**: Physical metrics (height, weight)
4. **Optional**: Constraints/injuries

This focuses on what matters most for AI diagnosis: **the lift data itself**.

---

## Summary

✅ **Removed**: Training Experience and Equipment Access fields
✅ **Kept**: Height, Weight, Injuries/Constraints (all optional)
✅ **Result**: Cleaner, faster, more focused onboarding

**Impact**: High positive - removes friction without losing valuable data!
