import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, fontSize, fontWeight } from '@/constants/theme';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

interface BadgeProps {
  children: string;
  variant?: Variant;
  style?: ViewStyle;
}

const variantStyles: Record<Variant, { bg: string; text: string; border?: string }> = {
  default: { bg: colors.primary, text: colors.primaryForeground },
  secondary: { bg: colors.secondary, text: colors.secondaryForeground },
  outline: { bg: 'transparent', text: colors.foreground, border: colors.border },
  destructive: { bg: colors.destructive, text: colors.destructiveForeground },
};

export function Badge({ children, variant = 'default', style }: BadgeProps) {
  const v = variantStyles[variant];
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { color: v.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
