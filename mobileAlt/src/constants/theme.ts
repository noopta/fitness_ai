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
