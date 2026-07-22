// Shared tokens for the effects-first Nutrition Profile screens (spec §3).
// Status is never colour-only — always paired with a pill label + dot (§10).
import { colors } from '../../../constants/theme';
import type { NpStatus } from '../../../lib/api';

// Soft-background + ink-text pairs for the status pills, and the status dot.
export const STATUS_STYLE: Record<NpStatus, { dot: string; pillBg: string; pillInk: string; label: string }> = {
  ok:   { dot: '#22C55E', pillBg: '#DCFCE7', pillInk: '#15803D', label: 'On track' },
  warn: { dot: '#F59E0B', pillBg: '#FEF3C7', pillInk: '#B45309', label: 'Improve' },
  low:  { dot: '#EF4444', pillBg: '#FEE2E2', pillInk: '#B91C1C', label: 'Low' },
};

// A driver/coverage bar fill colour by status (sub-target bars use warn/low).
export function barColor(status: NpStatus): string {
  return STATUS_STYLE[status].dot;
}

export const NP = {
  heroBg: colors.foreground,
  heroInk: '#FFFFFF',
  heroMicro: 'rgba(255,255,255,0.55)',
  heroRule: 'rgba(255,255,255,0.15)',
  cardBg: colors.background,
  border: colors.border,
  muted: colors.muted,
  mutedInk: colors.mutedForeground,
  ink: colors.foreground,
};
