import React from 'react';
import {
  TouchableOpacity, Text, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
} from 'react-native';
import { colors, radius, fontSize, fontWeight } from '../../constants/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'default';
type Size = 'sm' | 'default' | 'lg';

interface ButtonProps {
  onPress?: () => void;
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function Button({
  onPress, children, variant = 'primary', size = 'default',
  disabled, loading, style, textStyle, fullWidth = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  // 'default' maps to 'primary' for backward compat
  const resolvedVariant = variant === 'default' ? 'primary' : variant;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.82}
      style={[
        styles.base,
        styles[resolvedVariant],
        styles[`size_${size}`],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={resolvedVariant === 'primary' ? colors.primaryForeground : colors.foreground}
        />
      ) : (
        <Text style={[styles.text, styles[`text_${resolvedVariant}`], styles[`textSize_${size}`], textStyle]}>
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.4 },

  // Variants
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.muted },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: colors.destructive },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Sizes
  size_sm: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm },
  size_default: { paddingHorizontal: 18, paddingVertical: 13 },
  size_lg: { paddingHorizontal: 24, paddingVertical: 16 },

  // Text base
  text: { fontWeight: fontWeight.semibold },
  text_primary: { color: colors.primaryForeground },
  text_secondary: { color: colors.foreground },
  text_ghost: { color: colors.foreground },
  text_destructive: { color: colors.destructiveForeground },
  text_outline: { color: colors.foreground },

  // Text sizes
  textSize_sm: { fontSize: fontSize.sm },
  textSize_default: { fontSize: fontSize.base },
  textSize_lg: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
