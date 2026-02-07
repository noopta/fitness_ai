# AI Diagnosis Improvements 🧠

## Overview

The AI diagnostic chat has been completely redesigned to be **data-driven** and **tailored** to each user's specific strength profile, rather than asking generic questions.

---

## What Changed

### 1. **Detailed Biomechanics Knowledge Base** ✅

Created `backend/src/data/biomechanics.ts` with comprehensive information for each compound lift:

#### For Each Lift, We Now Have:

**Movement Phases**:
- Exact range of motion for each phase (e.g., "0-20% of ROM")
- Primary muscles activated (with fiber type and role)
- Secondary/stabilizer muscles
- Mechanical focus of the phase
- Common failure points

**Strength Ratios**:
- Expected ratios between the target lift and related exercises
- Interpretation guidelines (e.g., "Close-grip bench should be 85-95% of flat bench")
- What weak ratios indicate

**Common Weaknesses**:
- Comprehensive list of typical limiting factors
- How they manifest in the lift

#### Example: Flat Bench Press Biomechanics

```typescript
{
  phaseName: 'Bottom Position (0-2 inches off chest)',
  primaryMuscles: [
    {
      muscle: 'Pectoralis Major (sternal head)',
      activationLevel: 'primary',
      fiberType: 'fast-twitch',
      role: 'Primary mover for horizontal adduction and reversal out of stretch'
    },
    // ... more muscles
  ],
  mechanicalFocus: 'Stretch-shortening cycle, chest stretch reflex, reversal strength',
  commonFailurePoint: 'Weak off chest - often indicates insufficient pec strength or poor stretch reflex utilization'
}
```

**Covered Lifts**:
- Flat Bench Press
- Incline Bench Press
- Deadlift
- Barbell Back Squat
- Barbell Front Squat

---

### 2. **Initial Snapshot Analysis** ✅

Added `generateInitialAnalysis()` function in `backend/src/services/llmService.ts`:

#### What It Does:

1. **Analyzes User's Snapshot Data**:
   - Takes all entered exercises with weights, sets, and reps
   - Compares strength ratios (e.g., close-grip vs flat bench)
   - Identifies which muscles appear stronger/weaker

2. **Uses Biomechanics Knowledge**:
   - Understands which muscles are used in which lift phases
   - Knows expected strength ratios
   - Identifies common weaknesses

3. **Generates 3 Tailored Questions**:
   - Questions are specific to the user's strength profile
   - Target different aspects: lift phase, muscle group, technique
   - Reference the biomechanics and user's actual data

#### Example Output:

```json
{
  "analysis": "Your close-grip bench is 75% of your flat bench (expected 85-95%), suggesting your triceps may be a limiting factor. Your overhead press is relatively strong at 68% of flat bench, indicating good shoulder strength. Your barbell row is only 60% of flat bench (expected 70-80%), which may indicate upper back stability issues.",
  
  "tailoredQuestions": [
    "Given that your close-grip bench is relatively weak compared to your flat bench, do you notice the bar slowing down most in the final 2-3 inches of lockout?",
    
    "Your barbell row is weaker than expected - do you feel your shoulders becoming unstable or the bar drifting forward/backward during heavier bench sets?",
    
    "Where in the bench press ROM do you feel you're struggling most: off your chest, mid-range (2-4 inches), or at lockout?"
  ],
  
  "identifiedWeaknesses": [
    "Triceps lockout strength (close-grip bench ratio suggests weakness)",
    "Upper back stability (barbell row ratio below optimal)"
  ]
}
```

---

### 3. **Updated Diagnostic Flow** ✅

Modified `backend/src/routes/sessions.ts` to implement the new flow:

#### Old Flow:
```
User clicks "Start Diagnosis" 
  → AI asks generic first question
  → User answers
  → AI asks follow-up questions
  → Repeat until diagnosis complete
```

#### New Flow:
```
User enters snapshot data
  ↓
User clicks "Start Diagnosis"
  ↓
Backend analyzes snapshot with biomechanics knowledge
  ↓
AI generates 3 tailored questions based on user's specific strength ratios
  ↓
Present all 3 questions to user at once
  ↓
User answers (can answer all at once or separately)
  ↓
AI asks additional follow-ups if needed
  ↓
Diagnosis complete → Generate plan
```

---

## Technical Implementation

### Files Modified:

1. **`backend/src/data/biomechanics.ts`** (NEW)
   - Comprehensive biomechanics data for all lifts
   - Movement phases with muscle activations
   - Strength ratios and interpretations
   - ~700 lines of detailed knowledge

2. **`backend/src/services/llmService.ts`**
   - Added `generateInitialAnalysis()` function
   - Imports biomechanics data
   - Uses GPT-4o to analyze snapshot and generate questions
   - Returns analysis + 3 tailored questions

3. **`backend/src/routes/sessions.ts`**
   - Updated `POST /api/sessions/:id/messages` endpoint
   - Checks if first interaction (no previous assistant messages)
   - Calls `generateInitialAnalysis()` on first message
   - Presents all 3 tailored questions at once

---

## Example User Experience

### Scenario: User enters bench press snapshot

**User's Snapshot**:
- Flat Bench Press: 185 lbs × 3 sets × 8 reps
- Close-Grip Bench: 140 lbs × 3 sets × 8 reps (76% ratio)
- Overhead Press: 115 lbs × 3 sets × 8 reps (62% ratio)
- Barbell Row: 135 lbs × 3 sets × 8 reps (73% ratio)

**AI Analysis** (behind the scenes):
- Close-grip ratio is low (76% vs expected 85-95%) → Triceps weakness
- OHP ratio is slightly low (62% vs expected 65-70%) → Shoulder strength okay
- Row ratio is borderline (73% vs expected 70-80%) → Upper back stability okay

**AI's First Message** (user sees):
> "Based on your strength profile, I have a few specific questions to help diagnose your limiting factors:
>
> **1.** Given that your close-grip bench (140 lbs) is only 76% of your flat bench (185 lbs), which is lower than the typical 85-95%, do you find the bar slows down significantly in the final 2-3 inches of lockout?
>
> **2.** Your overhead press is relatively proportional to your bench press, suggesting decent shoulder strength. However, do you feel more fatigue in your chest or your triceps when approaching failure on bench?
>
> **3.** When you miss a rep on flat bench, where does it typically fail: right off your chest, in the mid-range (2-4 inches up), or in the last few inches of lockout?
>
> Please answer these questions - they'll help me identify exactly what's holding back your progress."

**User's Response**:
> "1. Yes, the lockout is definitely the hardest part for me. The bar slows way down at the top.
> 2. My triceps burn out first, especially on the last few reps.
> 3. I can usually get it off my chest fine, but it grinds to a halt about halfway up and barely makes it to lockout."

**AI's Diagnosis**:
Based on the responses and strength ratios:
- **Primary Limiter**: Triceps lockout strength (confirmed by low close-grip ratio + subjective feedback)
- **Secondary**: Mid-range pressing strength
- **Prescription**: Close-grip bench, JM press, overhead tricep extensions

---

## Benefits

### ✅ Data-Driven
- Questions are based on actual lift data, not generic templates
- Uses strength ratios to identify specific weaknesses
- Leverages biomechanics knowledge

### ✅ Personalized
- Every user gets different questions based on their profile
- References their actual exercises and weights
- Targets their specific weak points

### ✅ Efficient
- 3 focused questions upfront instead of 8 generic ones
- Less back-and-forth required
- Faster to complete diagnosis

### ✅ Expert-Level
- Uses real biomechanics principles
- Considers muscle fiber types, activation patterns, and movement phases
- Professional coaching-level analysis

### ✅ Better AI Context
- AI understands lift mechanics deeply
- Can make informed recommendations
- Generates more accurate plans

---

## Strength Ratio Examples

### Flat Bench Press:
- **Close-Grip Bench**: 85-95% (if < 80% → triceps weak)
- **Incline Bench**: 80-90% (if < 75% → upper chest/front delts weak)
- **Overhead Press**: 60-70% (if < 55% → shoulders weak)
- **Barbell Row**: 70-80% (if < 65% → back stability weak)

### Deadlift:
- **Back Squat**: 75-90% (if much less → posterior chain weak)
- **RDL**: 65-75% (if weak → hamstrings limiting)
- **Rack Pull**: 115-130% (if only slightly stronger → lockout is limiter)
- **Deficit Deadlift**: 85-95% (if much weaker → off-floor weakness)

### Back Squat:
- **Front Squat**: 80-90% (if gap is large → quads or upper back weak)
- **Deadlift**: 110-130% of squat (if less → posterior chain weak)
- **Pause Squat**: 85-95% (if much weaker → relying on bounce, true strength weak)

---

## API Changes

### POST `/api/sessions/:id/messages` (First Message)

**Request**:
```json
{
  "message": "start" // or any first message
}
```

**Response**:
```json
{
  "complete": false,
  "message": "Based on your strength profile, I have a few specific questions...\n\n**1.** [Question 1]\n\n**2.** [Question 2]\n\n**3.** [Question 3]",
  "analysis": "Your close-grip bench is 75% of your flat bench (expected 85-95%)..."
}
```

### Subsequent Messages

Same as before - regular diagnostic conversation continues until complete.

---

## Testing Checklist

- [x] Biomechanics data created for all lifts
- [x] Initial analysis function implemented
- [x] Sessions route updated to use analysis
- [x] No TypeScript/linter errors
- [ ] Test with real snapshot data
- [ ] Verify questions are tailored
- [ ] Check strength ratio calculations
- [ ] Ensure diagnosis quality improves

---

## Future Enhancements

1. **More Lifts**: Add overhead press, deadlift variations, Olympic lifts
2. **Video Analysis**: Integrate with form check video uploads
3. **Progress Tracking**: Compare ratios over time
4. **Auto-Detection**: Automatically flag weak ratios before user even asks
5. **Visualization**: Show strength ratio spider chart

---

## Summary

**Before**: Generic AI questions that don't consider user's actual strength profile.

**After**: Data-driven, biomechanics-based analysis that generates personalized diagnostic questions tailored to each user's specific weaknesses.

**Result**: Faster, more accurate diagnosis that feels like working with an expert strength coach who has analyzed your training data! 🎯
