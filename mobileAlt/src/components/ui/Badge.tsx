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
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  default: { backgroundColor: colors.foreground },
  secondary: { backgroundColor: colors.muted },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  success: { backgroundColor: '#DCFCE7' },
  warning: { backgroundColor: '#FEF3C7' },
  destructive: { backgroundColor: '#FEE2E2' },
  pro: { backgroundColor: colors.foreground },

  text: { fontSize: fontSize.xs, fontWeight: '600' },
  text_default: { color: colors.primaryForeground },
  text_secondary: { color: colors.mutedForeground },
  text_outline: { color: colors.foreground },
  text_success: { color: '#15803D' },
  text_warning: { color: '#B45309' },
  text_destructive: { color: '#DC2626' },
  text_pro: { color: colors.primaryForeground },
});
