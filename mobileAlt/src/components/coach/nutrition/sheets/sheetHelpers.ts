// Tiny helpers shared by the Nutrition sheets. Lives here so the sheet
// implementations stay focused on their own UI / state.

export type MealSlotApi = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';

/** YYYY-MM-DD local date string (matches the backend's expectation). */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Pick a sensible default meal slot for "right now". Backend's enum is
 * lowercase; the timeline's display labels are uppercase, so this is the
 * lowercase API form. We never default to "meal" — that's a fallback for
 * old logs without a slot.
 */
export function slotForNow(): MealSlotApi {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 21) return 'dinner';
  return 'snack';
}
