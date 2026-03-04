# Imperial Units Support (Canadian-Style)

## Overview

The app now supports **both metric and imperial units**, allowing users to enter:
- **Height**: in centimeters (cm) OR feet and inches (ft/in)
- **Weight**: in kilograms (kg) OR pounds (lbs)

This follows the **Canadian metric system** approach where users can choose their preferred units.

## Where It Works

### 1. Lift Selection Page (Profile Section)

**Height Input:**
- Toggle between `cm` and `ft/in` buttons
- **Metric**: Single input field for centimeters (e.g., 175 cm)
- **Imperial**: Two input fields for feet and inches (e.g., 5 feet 10 inches)

**Weight Input:**
- Toggle between `kg` and `lbs` buttons
- **Metric**: Enter weight in kilograms (e.g., 80 kg)
- **Imperial**: Enter weight in pounds (e.g., 175 lbs)

### 2. Snapshot Entry Page (Exercise Weights)

**Exercise Weight Input:**
- Toggle between `kg` and `lbs` buttons above the weight field
- **Metric**: Enter weight in kilograms (e.g., 100 kg)
- **Imperial**: Enter weight in pounds (e.g., 225 lbs)

**Display:**
- Saved snapshots show both units: "100.0kg (225lbs)"

## Conversion Details

### Height Conversion
- **Imperial to Metric**: (feet × 12 + inches) × 2.54 = cm
- Example: 5'10" = (5 × 12 + 10) × 2.54 = 177.8 cm

### Weight Conversion
- **Imperial to Metric**: pounds × 0.453592 = kg
- Example: 175 lbs = 175 × 0.453592 = 79.4 kg

### Storage
All measurements are **stored in metric** (cm and kg) in the database, but users can input and view in their preferred units.

## User Experience

### Profile Input Example (Imperial User)
1. Click "ft/in" button for height
2. Enter "5" in feet field
3. Enter "10" in inches field
4. Click "lbs" button for weight
5. Enter "175" in weight field
6. ✅ Stored as 177.8 cm and 79.4 kg

### Exercise Snapshot Example (Imperial User)
1. Select exercise (e.g., "Flat Bench Press")
2. Click "lbs" button
3. Enter "225" for weight
4. Enter sets and reps
5. Click "Add to Snapshot"
6. ✅ Displayed as "102.1kg (225lbs)"

## UI Design

### Toggle Buttons
- Small, compact buttons above each input
- Active unit highlighted in primary color
- Inactive unit in secondary color
- Smooth transition between units

### Input Fields
- **Metric**: Single input field
- **Imperial Height**: Two side-by-side fields labeled "feet" and "inches"
- **Imperial Weight**: Single input field

### Display Format
- Snapshots show: `[kg value]kg ([lbs value]lbs)`
- Example: `100.0kg (220lbs)`

## Benefits

✅ **Flexibility**: Users choose their preferred measurement system
✅ **Canadian-Style**: Supports mixed metric/imperial preference
✅ **Accurate Conversions**: Proper conversion factors used
✅ **Clear UI**: Easy-to-use toggle buttons
✅ **Consistent Storage**: All data stored in metric for consistency
✅ **Dual Display**: Saved weights show both units for reference

## Technical Implementation

- Frontend handles unit selection and conversion
- Backend always receives metric values
- Conversions happen on form submit
- Display shows both units for transparency
- No backend changes required

## Try It Out!

1. Go to **Lift Selection** page
2. Scroll to **Your Profile** section
3. Click the unit toggle buttons to switch between metric and imperial
4. Enter your measurements in your preferred units
5. Continue to **Snapshot Entry** to try weight unit toggles

---

Perfect for users who think in feet/inches and pounds! 🇨🇦 🇺🇸
