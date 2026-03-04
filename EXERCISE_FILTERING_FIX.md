# Exercise Filtering Fix - Lift-Specific Workouts

## Issue
The snapshot page was showing all exercises in the dropdown regardless of which compound lift was selected. Users selecting "Flat Bench Press" would see deadlift and squat exercises, which wasn't relevant.

## Solution
Implemented lift-specific exercise filtering based on target muscle groups:

### Changes Made

#### 1. **Onboarding Page** (`frontend-v2/client/src/pages/onboarding.tsx`)
- Now stores the selected lift ID in localStorage when continuing to snapshot
- Stores both session ID and lift ID for downstream filtering

```typescript
localStorage.setItem("liftoff_session_id", response.session.id);
localStorage.setItem("liftoff_selected_lift", selectedLift); // NEW
```

#### 2. **Snapshot Page** (`frontend-v2/client/src/pages/snapshot.tsx`)
- Created lift-to-exercise mapping based on muscle groups
- Reads selected lift from localStorage on mount
- Filters exercise dropdown to show only relevant exercises

### Exercise Mappings

#### **Flat Bench Press** (Chest, Triceps, Shoulders)
- Primary: Flat Bench, Close-Grip Bench, Incline Bench
- Accessories: Dumbbell variations, Overhead Press, Dips
- Triceps: Rope Pressdown, Overhead Extension, JM Press
- Antagonists: Rows (Barbell, Dumbbell, Chest-Supported, Cable, T-Bar)
- Shoulders: Face Pull, Lateral Raise, Band Pull Apart

#### **Incline Bench Press** (Upper Chest, Anterior Deltoid)
- Primary: Incline Bench, Flat Bench variations
- Accessories: Overhead Press, Dips
- Support: Rows, Face Pulls, Lateral Raises

#### **Deadlift** (Posterior Chain)
- Primary: Deadlift, Romanian Deadlift, Rack Pull, Deficit Deadlift
- Pulling: Barbell Row, T-Bar Row, Cable Row, Lat Pulldown, Pull-Up
- Posterior: Leg Curl, Hip Thrust, Good Morning, Back Extension
- Carries: Farmer's Walk
- Variations: Paused Deadlift

#### **Barbell Back Squat** (Quads, Glutes, Erectors)
- Primary: Back Squat, Front Squat, Pause Squat
- Accessories: Leg Press, Bulgarian Split Squat, Hack Squat, Goblet Squat
- Isolation: Leg Extension, Leg Curl
- Posterior: Romanian Deadlift, Hip Thrust, Good Morning

#### **Barbell Front Squat** (Quad Dominant)
- Primary: Front Squat, Back Squat, Pause Squat
- Accessories: Leg Press, Bulgarian Split Squat, Hack Squat
- Variations: Goblet Squat, Zercher Squat
- Isolation: Leg Extension, Leg Curl

## How It Works

1. **User selects compound lift** on onboarding page (e.g., "Flat Bench Press")
2. **Lift ID stored** in localStorage (`flat_bench_press`)
3. **Snapshot page loads** and reads the lift ID
4. **Exercise dropdown filtered** to show only relevant exercises
5. **First row auto-populated** with the main compound lift

## Example Flow

```
User selects: Flat Bench Press
     ↓
Snapshot shows only:
✓ Flat Bench Press
✓ Close-Grip Bench Press  
✓ Incline Bench Press
✓ Dumbbell variations
✓ Overhead Press
✓ Tricep work (Pressdown, Extensions)
✓ Rows (for balance)
✓ Face Pulls, Lateral Raises

NOT shown:
✗ Deadlift variations
✗ Squat variations
✗ Leg exercises
```

## Benefits

1. **Reduced Clutter**: Only 15-18 relevant exercises shown instead of 40+
2. **Better UX**: Users don't have to search through irrelevant exercises
3. **Accurate Diagnostics**: AI gets proper context about the lift being improved
4. **Logical Grouping**: Includes main lift + variations + accessories + antagonists

## Technical Details

- **Storage**: Uses localStorage for persistence across page navigation
- **Fallback**: If no lift selected, shows top 5 compound lifts
- **Auto-population**: First row defaults to the selected compound lift
- **Real-time**: Changes immediately when lift selection is stored

## Files Modified

- ✅ `frontend-v2/client/src/pages/onboarding.tsx` - Store lift ID
- ✅ `frontend-v2/client/src/pages/snapshot.tsx` - Filter exercises by lift

## Testing

1. Go to http://localhost:5000
2. Select "Flat Bench Press" on onboarding
3. Continue to snapshot
4. Click exercise dropdown → Should only see bench/chest/tricep/row exercises
5. Try different lifts to verify filtering works correctly

---

Now the snapshot page shows **only relevant exercises** based on your selected compound lift! 🎯
