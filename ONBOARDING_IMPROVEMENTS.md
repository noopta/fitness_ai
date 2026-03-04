# Onboarding Flow Improvements 🎯

## Changes Made

### 1. Removed "Training Goal" Section ✅

**Rationale**: Users can be assumed to always want to build strength when using LiftOff for lift diagnostics.

**Changes**:
- Removed the "Training Goal" radio group selection (Strength/Balanced/Size)
- Removed `goal` state variable
- Removed unused `RadioGroup` and `RadioGroupItem` imports
- Default goal is now hardcoded to `"strength_peak"` in the session creation

**Files Modified**: `frontend-v2/client/src/pages/onboarding.tsx`

---

### 2. Added Current Lift Stats Input ✅

**Rationale**: Immediately capture the user's current working weight, sets, and reps for their target lift to provide better AI context.

**New Section**: "Your Current [Selected Lift]"
- **Working Weight (lbs)**: User's typical working weight for the lift
- **Sets**: Working sets per session
- **Reps**: Reps per set

**Benefits**:
- AI gets baseline context immediately
- User doesn't have to re-enter this data on the snapshot screen
- Creates a clear starting point for diagnosis
- The first row on the snapshot screen is pre-filled with this data

**Files Modified**: 
- `frontend-v2/client/src/pages/onboarding.tsx` (added input fields and validation)
- `frontend-v2/client/src/pages/snapshot.tsx` (pre-fill first row with this data)

---

### 3. Enhanced Snapshot Pre-filling ✅

**What Changed**:
- The snapshot screen now loads the target lift stats from `localStorage`
- First row is automatically populated with:
  - **Exercise**: Selected compound lift name
  - **Weight**: User's entered working weight
  - **Sets**: User's entered sets
  - **Reps**: User's entered reps

**Technical Implementation**:
- Added state management for `currentWeight`, `currentSets`, `currentReps` in onboarding
- Stored these values in `localStorage`:
  - `liftoff_target_lift_weight`
  - `liftoff_target_lift_sets`
  - `liftoff_target_lift_reps`
- Updated snapshot's `useEffect` to load and pre-fill first row
- Added `value` and `onChange` handlers to all Input components for proper state binding
- Changed Select component from `defaultValue` to `value` with `onValueChange` handler

---

## User Flow Improvements

### Before:
1. Select target lift
2. Choose training goal (Strength/Balanced/Size)
3. Enter profile info (optional)
4. Continue to snapshot
5. Manually enter target lift data from scratch

### After:
1. Select target lift
2. ✨ **Enter current working stats for that lift** (required)
3. Enter profile info (optional)
4. Continue to snapshot
5. ✨ **First row automatically filled with target lift data**
6. Add additional relevant exercises

---

## Validation Updates

**Continue Button** now requires:
- Selected lift ✅
- Current weight ✅
- Current sets ✅
- Current reps ✅
- (Profile info remains optional)

The button is disabled until all required fields are filled.

---

## Benefits for AI Context

By capturing the target lift stats upfront:

1. **Immediate Baseline**: AI knows exactly where the user is starting from
2. **Better Comparisons**: Can compare target lift to accessory work
3. **Strength Ratios**: Can calculate ratios between main lift and supporting movements
4. **Focused Diagnosis**: AI can ask more targeted questions based on current performance
5. **Cleaner Flow**: User doesn't feel like they're repeating information

---

## LocalStorage Keys Used

| Key | Value | Purpose |
|-----|-------|---------|
| `liftoff_session_id` | Session UUID | Track user's diagnostic session |
| `liftoff_selected_lift` | Lift ID (e.g., "flat_bench_press") | Target lift for diagnosis |
| `liftoff_target_lift_weight` | Number (lbs) | Current working weight |
| `liftoff_target_lift_sets` | Number | Current working sets |
| `liftoff_target_lift_reps` | Number | Current working reps |

---

## UI/UX Enhancements

### New Section Design:
- **Icon**: TrendingUp (indicates progress/improvement)
- **Dynamic Title**: "Your Current [Flat Bench Press]" (updates based on selection)
- **Helper Text**: "Enter your current working weight, sets, and reps for this lift. This helps our AI understand your baseline."
- **Input Labels**: Clear labels with helper text below each input
- **Grid Layout**: 3-column responsive grid (weight, sets, reps)

### Visual Hierarchy:
1. Select Target Lift (card selection)
2. ⬇️
3. Enter Current Stats (immediately below selection)
4. ⬇️
5. Profile Info (optional, less emphasis)
6. ⬇️
7. Continue button (enabled when required fields filled)

---

## Testing Checklist

- [ ] Select a lift → New "Current Lift Stats" section appears
- [ ] Title updates dynamically based on selected lift
- [ ] Continue button disabled until weight, sets, reps entered
- [ ] Enter all required fields → Continue button enables
- [ ] Click Continue → Navigate to snapshot screen
- [ ] Snapshot screen first row pre-filled with entered data
- [ ] Can edit pre-filled data
- [ ] Can add more exercises
- [ ] Full flow works end-to-end

---

## Code Quality

- ✅ No TypeScript errors
- ✅ No linter errors
- ✅ Proper state management
- ✅ Clean localStorage usage
- ✅ Responsive design maintained
- ✅ Accessibility preserved
- ✅ Consistent with existing UI patterns

---

## Next Steps

The onboarding flow is now streamlined and focused on capturing essential lift data upfront. This provides better context for:

1. **AI Diagnostic Chat**: Can reference baseline stats
2. **Plan Generation**: Can prescribe accessories relative to main lift
3. **Progress Tracking**: Future feature - track improvement over time

---

## Summary

**Removed**: Unnecessary "Training Goal" selection (assume strength)

**Added**: Required current lift stats input (weight, sets, reps)

**Improved**: Snapshot screen pre-filling for better UX

**Result**: Faster, more focused onboarding that captures critical data upfront!
