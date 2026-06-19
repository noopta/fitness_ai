// Share-sheet chrome — the Light/Dark theme toggle (spec §7) and the template
// picker. These float over the preview and are NEVER part of the captured card.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../constants/theme';
import { ShareTemplate, ShareTheme } from './types';

// ─── Theme toggle ───────────────────────────────────────────────────────────

const TOGGLE_LABELS: Record<ShareTheme, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  light: { label: 'Light', icon: 'sunny-outline' },
  dark: { label: 'Dark', icon: 'moon-outline' },
};

export function ThemeToggle({
  value, onChange, surface,
}: {
  value: ShareTheme;
  onChange: (t: ShareTheme) => void;
  /** The card surface the toggle floats over, so it stays legible. */
  surface: ShareTheme;
}) {
  const onDark = surface === 'dark';
  const track = onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
  const selBg = onDark ? '#ffffff' : '#09090b';
  const selFg = onDark ? '#09090b' : '#ffffff';
  const unselFg = onDark ? 'rgba(255,255,255,0.6)' : colors.mutedForeground;

  return (
    <View style={[tg.track, { backgroundColor: track }]}>
      {(['light', 'dark'] as ShareTheme[]).map((t) => {
        const active = t === value;
        const meta = TOGGLE_LABELS[t];
        return (
          <TouchableOpacity
            key={t}
            activeOpacity={0.8}
            onPress={() => onChange(t)}
            style={[tg.seg, active && { backgroundColor: selBg }]}
          >
            <Ionicons name={meta.icon} size={13} color={active ? selFg : unselFg} />
            <Text style={[tg.segText, { color: active ? selFg : unselFg }]}>{meta.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tg = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radius.full, padding: 3, gap: 2 },
  seg: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.full,
  },
  segText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
});

// ─── Template picker ─────────────────────────────────────────────────────────

const TEMPLATE_META: Record<ShareTemplate, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  hero: { label: 'Hero', icon: 'square-outline' },
  receipt: { label: 'Receipt', icon: 'receipt-outline' },
  heroPhoto: { label: 'Hero', icon: 'image-outline' },
  glassLifts: { label: 'Glass', icon: 'list-outline' },
  glassChip: { label: 'Chip', icon: 'ellipse-outline' },
};

export function TemplatePicker({
  templates, value, onSelect,
}: {
  templates: ShareTemplate[];
  value: ShareTemplate;
  onSelect: (t: ShareTemplate) => void;
}) {
  return (
    <View style={tp.row}>
      {templates.map((t) => {
        const active = t === value;
        const meta = TEMPLATE_META[t];
        return (
          <TouchableOpacity
            key={t}
            activeOpacity={0.8}
            onPress={() => onSelect(t)}
            style={[tp.chip, active ? tp.chipActive : tp.chipIdle]}
          >
            <Ionicons name={meta.icon} size={16} color={active ? colors.primaryForeground : colors.foreground} />
            <Text style={[tp.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>{meta.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tp = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipIdle: { backgroundColor: colors.background, borderColor: colors.border },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
