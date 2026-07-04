// Data contract for the shareable workout cards.
// Mirrors the backend `ShareableWorkout` (services/shareableWorkout.ts) — built
// once at log time and consumed immutably by the celebration sheet. `pr` being
// null drives the PR-led vs. fallback rendering throughout the templates.
// (Shareable Workout Log — Mobile Spec §4.)

export interface SharePR {
  lift: string;     // "Bench Press"
  metric: string;   // "e1RM"
  value: string;    // "215" (legacy lb)
  unit: string;     // "lb" (legacy)
  delta: string;    // "+5 lb" (legacy)
  valueKg?: number; // canonical e1RM in kg (newer backend)
  deltaKg?: number; // canonical delta in kg (newer backend)
}

export interface ShareableWorkout {
  title: string;
  loggedAt: string;        // ISO; formatted to "Wed · Jun 18 · 7:42 PM"
  durationMin: number;     // 58
  sets: number;            // total working sets
  // Total volume as a raw number rendered with a thousands separator. The
  // backend emits both units (`volumeKg` canonical + `volumeLb` legacy);
  // `displayShareable()` picks the sharer's unit before the cards render.
  // `volumeUnit` is the matching label ('lb' | 'kg'); cards fall back to 'lb'.
  volumeLb: number;        // 24150 → rendered "24,150"
  volumeKg?: number;       // canonical (newer backend)
  volumeUnit?: string;     // 'lb' | 'kg'
  // `detail` stays lb-formatted for older payloads; the structured fields (newer
  // backend) let displayShareable() reformat cleanly in kg without string parsing.
  exercises: Array<{
    name: string;
    detail: string;        // "5 × 5 · 185 lb"
    sets?: number;
    reps?: string;
    weightKg?: number | null; // null ⇒ bodyweight / unloaded
    bodyweight?: boolean;
  }>;
  pr: SharePR | null;      // null ⇒ use volume/title fallback
}

// The five card templates. Hero (A1b/A1c) and HeroPhoto (A1d) carry a theme;
// the Receipt and both Glass cards are theme-fixed.
export type ShareTemplate = 'hero' | 'receipt' | 'heroPhoto' | 'glassLifts' | 'glassChip';

export type ShareTheme = 'light' | 'dark';

// Normalized, resolution-independent crop. scale: 1 = cover (image exactly
// fills the window). offsetX/Y: fraction of the window (-0.5..0.5), 0 = centered.
// Survives template switches (A1d ↔ B5 ↔ B3 reuse the same photo + crop).
export interface CropTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SharePhoto {
  uri: string;
  crop: CropTransform;
}

// Local UI state for the share builder.
export interface ShareDraft {
  template: ShareTemplate;
  theme: ShareTheme;        // hero & heroPhoto only
  photo: SharePhoto | null;
}

export const DEFAULT_CROP: CropTransform = { scale: 1, offsetX: 0, offsetY: 0 };

// Templates available per branch (does the user want to attach a photo?).
export const NO_PHOTO_TEMPLATES: ShareTemplate[] = ['hero', 'receipt'];
export const PHOTO_TEMPLATES: ShareTemplate[] = ['heroPhoto', 'glassLifts', 'glassChip'];

export const PHOTO_REQUIRED: Record<ShareTemplate, boolean> = {
  hero: false,
  receipt: false,
  heroPhoto: true,
  glassLifts: true,
  glassChip: true,
};

/** Does this template expose the Light/Dark toggle? */
export const HAS_THEME_TOGGLE: Record<ShareTemplate, boolean> = {
  hero: true,
  receipt: false,
  heroPhoto: true,
  glassLifts: false,
  glassChip: false,
};
