import React from 'react';
import {
  TouchableOpacity, Text, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
} from 'react-native';
import { colors, radius, fontSize, fontWeight } from '../../constants/theme';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
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
  onPress, children, variant = 'default', size = 'default',
  disabled, loading, style, textStyle, fullWidth = false,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        styles.base,
        styles[variant],
        styles[`size_${size}`],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.primaryForeground}
        />
      ) : (
        <Text style={[styles.text, styles[`text_${variant}`], styles[`textSize_${size}`], textStyle]}>
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
  disabled: { opacity: 0.5 },

  // Variants
  default: { backgroundColor: colors.primary },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: colors.destructive },
  secondary: { backgroundColor: colors.secondary },

  // Sizes
  size_sm: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm },
  size_default: { paddingHorizontal: 16, paddingVertical: 11 },
  size_lg: { paddingHorizontal: 24, paddingVertical: 14 },

  // Text
  text: { fontWeight: fontWeight.semibold },
  text_default: { color: colors.primaryForeground },
  text_outline: { color: colors.foreground },
  text_ghost: { color: colors.foreground },
  text_destructive: { color: colors.destructiveForeground },
  text_secondary: { color: colors.foreground },

  textSize_sm: { fontSize: fontSize.sm },
  textSize_default: { fontSize: fontSize.base },
  textSize_lg: { fontSize: fontSize.lg },
});
