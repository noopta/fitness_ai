// Axiom Design System — Light palette
export const colors = {
  // Base
  background: '#ffffff',
  foreground: '#09090b',

  // Primary action
  primary: '#09090b',
  primaryForeground: '#ffffff',

  // Secondary text / captions
  muted: '#f4f4f5',           // zinc-100 — subtle backgrounds, icon containers
  mutedForeground: '#71717a', // zinc-500 — secondary text

  // Cards
  card: '#ffffff',
  cardForeground: '#09090b',

  // Borders
  border: '#e4e4e7', // zinc-200

  // Semantic — only for badges/alerts
  destructive: '#ef4444',
  destructiveForeground: '#FFFFFF',
  success: '#22c55e',
  warning: '#f59e0b',

  // PR / "new personal record" accent for the shareable workout cards.
  // successInk reads on light surfaces; successOnDark on dark/glass cards.
  // (Shareable Workout Log spec §5 — used only on the share cards.)
  successInk: '#15803d',
  successOnDark: '#4ade80',

  // Gut-health feature (design handoff v1.0 §2/§9.1). Status soft fills +
  // inks for StatusPill; citation trio; nutrition-feature macro hues.
  successSoft: '#dcfce7',
  warningSoft: '#fef3c7',
  warningInk: '#b45309',
  destructiveSoft: '#fee2e2',
  destructiveInk: '#b91c1c',
  citation: '#3f6ea5',
  citationSoft: '#f0f5fb',
  citationBorder: '#dbe7f4',

  /**
   * Macro accents (Nutrition v17b).
   *
   * Doctrine: only used for the macro-ring stroke and the per-item gram
   * numerals inside the dark inspector. Never on backgrounds, cards,
   * borders, or any chrome — the page itself stays monochrome.
   */
  macro: {
    protein: '#3b82f6',
    carbs:   '#f59e0b',
    fat:     '#ec4899',
    fiber:   '#22c55e',
  },

  /**
   * Gut-health feature macro hues (handoff §2 "sanctioned extension") —
   * the new nutrition surfaces use these; legacy v17b surfaces keep `macro`
   * until they're migrated.
   */
  gutMacro: {
    protein: '#2a78d6',
    carbs:   '#f59e0b',
    fat:     '#7c5cff',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  display: 38,
};

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
