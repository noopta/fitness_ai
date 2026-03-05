// Axiom Design System — Monochrome "Hybrid Flow" palette
export const colors = {
  // Base
  background: '#FFFFFF',
  foreground: '#000000',

  // Primary action (black pill buttons)
  primary: '#000000',
  primaryForeground: '#FFFFFF',

  // Secondary text / captions
  muted: '#F3F4F6',           // gray-100 — subtle backgrounds, icon containers
  mutedForeground: '#6B7280', // gray-500 — secondary text

  // Cards
  card: '#FFFFFF',
  cardForeground: '#000000',

  // Borders
  border: '#E5E7EB', // gray-200

  // Semantic — only for badges/alerts
  destructive: '#DC2626',
  destructiveForeground: '#FFFFFF',
  success: '#16A34A',
  warning: '#D97706',
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
