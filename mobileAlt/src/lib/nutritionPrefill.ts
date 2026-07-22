// Tiny cross-screen bus for the Nutrition Profile "Add" deep-link. The
// Recommendations subscreen sets a pending food name and navigates to the
// Coach tab; the Coach screen switches to its Nutrition sub-tab and the
// nutrition surface consumes the value to open the Describe log sheet
// prefilled. A module-level slot is enough — it's a single, short-lived hop
// and avoids threading params through the whole Coach tab tree.

let pending: string | null = null;

export function setNutritionPrefill(name: string): void {
  pending = name.trim() || null;
}

// Non-destructive read — lets the Coach screen decide to switch tabs without
// eating the value the nutrition surface still needs.
export function peekNutritionPrefill(): string | null {
  return pending;
}

// Read-and-clear — the nutrition surface calls this when it opens the sheet.
export function consumeNutritionPrefill(): string | null {
  const v = pending;
  pending = null;
  return v;
}

// Separate from the prefill: the empty state's "Go to Coach → Nutrition" link
// wants to land on the Nutrition sub-tab WITHOUT opening the log sheet, so it
// can't reuse the prefill slot (a set prefill opens Describe).
let tabRequested = false;

export function requestNutritionTab(): void {
  tabRequested = true;
}

export function consumeNutritionTabRequest(): boolean {
  const v = tabRequested;
  tabRequested = false;
  return v;
}
