# LiftOff MVP - Quick Testing Guide

## 🚀 Current Status

✅ **Backend running**: `http://localhost:3001` (PID: Check terminal 9)
✅ **Frontend running**: `http://localhost:5000`
✅ **All improvements deployed**

---

## 🧪 Test Scenarios

### 1. Test Landing Page Updates

**URL**: `http://localhost:5000`

**Check**:
- [ ] Hero title: "Break through your plateau. One lift at a time."
- [ ] Subtitle mentions: "Traditional coaches analyze mechanics" and "LiftOff brings that expertise to AI"
- [ ] Value pills show: "Lift phase analysis", "Strength ratio insights", "Targeted accessories"
- [ ] Comparison section title: "From your working weights to targeted accessories"
- [ ] Subtitle mentions: "Our AI—trained on lift biomechanics..."
- [ ] Bottom "Join waitlist" button is **bold** (not faded)
- [ ] Click bottom button → **scrolls to top** and focuses email input

---

### 2. Test Client-Side Caching

**Full Flow Test**:

1. **Onboarding Page** (`http://localhost:5000/mvp`):
   - Select a lift (e.g., "Flat Bench Press")
   - Enter: Weight 185 lbs, Sets 3, Reps 5
   - Enter: Height 5'10", Weight 180 lbs
   - **Refresh page** (F5)
   - ✅ **All data should persist**
   - Can modify any field

2. **Snapshot Page** (after clicking "Continue to snapshot"):
   - Add exercises (e.g., Close-Grip Bench 140 lbs, Overhead Press 115 lbs)
   - **Refresh page** (F5)
   - ✅ **All rows should persist**
   - Can add/remove rows
   - Can modify weights, sets, reps

3. **Diagnostic Chat**:
   - Already caches messages (existing functionality)

**Manual Cache Clear**:
```javascript
// In browser console:
localStorage.clear(); location.reload();
// Should start fresh
```

---

### 3. Test Loading Indicators

**Diagnostic Chat Test**:

1. Go to snapshot page
2. Fill in at least one exercise
3. Click "Continue"
4. **Watch for**:
   - [ ] Loading bubble appears: "AI is analyzing..."
   - [ ] Three animated dots
   - [ ] Cannot type in input (shows "AI is thinking...")
   - [ ] Send button is disabled and pulsing
   - [ ] After ~3-5 seconds, first AI question appears

5. **Type an answer and hit send**:
   - [ ] Loading bubble appears again
   - [ ] Input disabled
   - [ ] Send button disabled
   - [ ] Next question appears

---

### 4. Test Expanded Exercise Database

**Indirect Test** (via AI prescription):

1. Complete the full MVP flow
2. Generate a plan
3. Check the accessories list:
   - [ ] Should see variety of exercises
   - [ ] May include niche exercises (e.g., Meadows Row, Zercher Squat, Kroc Row)
   - [ ] Should see isolation work (e.g., Cable Fly, Hammer Curl)

**Direct Test** (via API):

```bash
# In terminal or browser:
curl http://localhost:3001/api/lifts/flat_bench_press/exercises
```

Should return 110+ exercises with detailed metadata.

---

## 🔍 Detailed Feature Checks

### Landing Page AI Messaging

**Before**:
> "Apps give you static programs. In-person coaches diagnose your lift mechanics and weak points. LiftOff bridges that gap..."

**After**:
> "Traditional coaches analyze your mechanics in person—expensive and time-consuming. LiftOff brings that expertise to AI: we feed your working weights, strength ratios, and lift biomechanics into advanced analysis..."

**Key phrases to look for**:
- ✅ "Traditional coaches analyze mechanics in person"
- ✅ "expensive and time-consuming"
- ✅ "brings that expertise to AI"
- ✅ "working weights, strength ratios, and lift biomechanics"
- ✅ "Highly detailed. Highly accurate. No guesswork."

---

### Bottom Button Behavior

**Test**:
1. Scroll to bottom of landing page
2. Find "Join waitlist" button
3. Click it

**Expected**:
- ✅ Page scrolls smoothly to top
- ✅ Email input gets focus (cursor blinks in field)
- ✅ Button is **bold** from the start (not faded)

**Before** (buggy):
- Button was faded
- Button called submit() directly
- No scroll to top

**After** (fixed):
- Button always bold
- Scrolls to top
- Focuses input after 500ms delay

---

### Caching Persistence

**Test Matrix**:

| Page | Cached Items | Test Action |
|------|--------------|-------------|
| **Onboarding** | 8 fields | Refresh page |
| **Snapshot** | All rows (JSON) | Refresh page, add row, refresh |
| **Diagnostic** | All messages | Already cached (existing) |

**localStorage Keys**:
```javascript
// Onboarding
liftoff_cached_lift
liftoff_cached_current_weight
liftoff_cached_current_sets
liftoff_cached_current_reps
liftoff_cached_height_feet
liftoff_cached_height_inches
liftoff_cached_weight_lbs
liftoff_cached_constraints

// Snapshot
liftoff_cached_snapshot_rows (JSON)

// Session (existing)
liftoff_session_id
liftoff_selected_lift
```

---

### Loading States

**Expected UI**:

1. **Initial Load**:
```
┌─────────────────────────────────────┐
│ [Bot 🤖] AI is analyzing...         │
│                                     │
└─────────────────────────────────────┘
```

2. **During Response**:
- Input field: "AI is thinking..." (gray, disabled)
- Send button: Gray, pulsing icon

3. **Ready for Input**:
- Input field: "Type your answer..." (white, enabled)
- Send button: Blue, enabled (if text present)

---

### Exercise Database Verification

**Sample API Response** (flat bench press exercises):

```json
[
  {
    "id": "flat_bench_press",
    "name": "Flat Bench Press",
    "category": "compound",
    "targetMuscle": ["chest", "triceps", "anterior_deltoid"],
    ...
  },
  {
    "id": "larsen_press",
    "name": "Larsen Press",
    "category": "accessory",
    "targetMuscle": ["chest", "triceps", "core"],
    ...
  },
  {
    "id": "meadows_row",
    "name": "Meadows Row",
    "category": "accessory",
    "targetMuscle": ["lats", "rhomboids"],
    ...
  }
]
```

**New exercises to spot-check**:
- Floor Press, Spoto Press, Pin Press
- Z Press, Bradford Press
- Meadows Row, Kroc Row, Seal Row
- Zercher Squat, Hack Squat, Nordic Curl
- Farmer's Walk, Dead Hang

---

## 🐛 Known Issues / Edge Cases

### Caching
- **Issue**: First-time users vs. returning users
- **Solution**: If no cache, uses defaults; otherwise loads cache
- **Test**: Clear localStorage, go through flow once, then refresh repeatedly

### Loading Indicators
- **Issue**: Fast responses might not show loading
- **Solution**: Loading bubble has minimum display time via animation
- **Test**: If AI responds instantly, bubble may flash briefly (expected)

### Exercise Database
- **Issue**: Some exercises have similar names
- **Solution**: Each has unique `id` for exact matching
- **Test**: Search for "Bench Press" → should see Flat, Incline, Decline, Close-Grip, etc.

---

## 📊 Success Criteria

### Landing Page
✅ Users understand the AI + data approach
✅ Bottom button works correctly
✅ Messaging emphasizes coaching expertise automated

### Caching
✅ Users can resume MVP flow after refresh
✅ All fields persist across refreshes
✅ Users can modify cached data

### Loading
✅ Users see clear feedback during AI processing
✅ Cannot spam send button
✅ Clear visual distinction between states

### Exercises
✅ AI has 110+ exercises to choose from
✅ Recommendations include variety (compound, accessory, isolation)
✅ Niche exercises available for specific prescriptions

---

## 🚀 Quick Test Commands

**Check backend running**:
```bash
curl http://localhost:3001/api/lifts
```

**Check frontend running**:
```bash
# Open browser
start http://localhost:5000
```

**Clear cache and test**:
```javascript
// In browser console on localhost:5000
localStorage.clear();
location.reload();
```

**Monitor backend logs**:
```bash
# Check terminal 9.txt for backend output
Get-Content c:\Users\anupt\.cursor\projects\c-Users-anupt-Documents-GitHub-Projects-strengthTrainingApp\terminals\9.txt -Wait
```

---

## ✅ Pre-Deploy Checklist

Before deploying to production:

- [ ] Test full MVP flow (onboarding → snapshot → diagnostic → plan)
- [ ] Test caching (refresh at each step)
- [ ] Test loading indicators (watch diagnostic chat)
- [ ] Verify landing page copy
- [ ] Test bottom waitlist button
- [ ] Verify backend has 110+ exercises
- [ ] Check generated plans include variety
- [ ] Test on mobile (caching + loading states)
- [ ] Clear localStorage and test fresh user experience

---

**Everything is ready for testing!** 🎉

Access the app at: **http://localhost:5000**
