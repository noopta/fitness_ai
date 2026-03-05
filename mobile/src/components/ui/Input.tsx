import React from 'react';
import {
  TextInput, View, Text, StyleSheet, TextInputProps, ViewStyle,
} from 'react-native';
import { colors, radius, spacing, fontSize } from '../../constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, containerStyle, style, ...props }: InputProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, error && styles.inputError, style]}
        placeholderTextColor={colors.mutedForeground}
        {...props}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: '500',
  },
  input: {
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    color: colors.foreground,
    fontSize: fontSize.base,
  },
  inputError: { borderColor: colors.destructive },
  error: {
    fontSize: fontSize.xs,
    color: colors.destructive,
  },
});
