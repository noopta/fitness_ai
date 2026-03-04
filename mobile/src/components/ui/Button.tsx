import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { colors, radius, fontSize, fontWeight } from '@/constants/theme';

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Size = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const variantStyles: Record<Variant, { bg: string; text: string; border?: string }> = {
  default: { bg: colors.primary, text: colors.primaryForeground },
  secondary: { bg: colors.secondary, text: colors.secondaryForeground },
  outline: { bg: 'transparent', text: colors.foreground, border: colors.border },
  ghost: { bg: 'transparent', text: colors.foreground },
  destructive: { bg: colors.destructive, text: colors.destructiveForeground },
};

const sizeStyles: Record<Size, { paddingH: number; paddingV: number; fontSize: number }> = {
  sm: { paddingH: 12, paddingV: 6, fontSize: fontSize.sm },
  default: { paddingH: 16, paddingV: 10, fontSize: fontSize.sm },
  lg: { paddingH: 24, paddingV: 14, fontSize: fontSize.base },
  icon: { paddingH: 10, paddingV: 10, fontSize: fontSize.sm },
};

export function Button({
  children,
  onPress,
  variant = 'default',
  size = 'default',
  disabled,
  loading,
  style,
  textStyle,
}: ButtonProps) {
  const v = variantStyles[variant];
  const s = sizeStyles[size];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          paddingHorizontal: s.paddingH,
          paddingVertical: s.paddingV,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : typeof children === 'string' ? (
        <Text style={[styles.text, { color: v.text, fontSize: s.fontSize }, textStyle]}>
          {children}
        </Text>
      ) : (
        children
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
    gap: 8,
  },
  text: {
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
