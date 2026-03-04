import { TextInput, View, Text, StyleSheet, TextInputProps, ViewStyle } from 'react-native';
import { colors, radius, fontSize, fontWeight } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, hint, containerStyle, style, ...props }: InputProps) {
  return (
    <View style={containerStyle}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.mutedForeground}
        {...props}
      />
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.foreground,
    fontSize: fontSize.base,
  },
  hint: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 4,
  },
});
