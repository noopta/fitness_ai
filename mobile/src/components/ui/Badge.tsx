import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, fontSize } from '../../constants/theme';

type Variant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'pro';

interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
  style?: ViewStyle;
}

export function Badge({ children, variant = 'default', style }: BadgeProps) {
  return (
    <View style={[styles.base, styles[variant], style]}>
      <Text style={[styles.text, styles[`text_${variant}`]]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  default: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.muted },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  success: { backgroundColor: '#14532d' },
  warning: { backgroundColor: '#78350f' },
  destructive: { backgroundColor: '#7f1d1d' },
  pro: { backgroundColor: '#4c1d95' },

  text: { fontSize: fontSize.xs, fontWeight: '600' },
  text_default: { color: colors.primaryForeground },
  text_secondary: { color: colors.mutedForeground },
  text_outline: { color: colors.foreground },
  text_success: { color: '#86efac' },
  text_warning: { color: '#fcd34d' },
  text_destructive: { color: '#fca5a5' },
  text_pro: { color: '#c4b5fd' },
});
