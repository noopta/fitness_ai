// Headline-size bare input: the goal, typed as the title. No field chrome, no
// border, no background — a crimson caret is the only sign it's an input.

import React from 'react';
import { TextInput, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { v2, T } from '../theme';

interface Props {
  value: string;
  onChange?: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  size?: number;
  readOnly?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<TextStyle>;
  tone?: 'light' | 'dark';
  multiline?: boolean;
}

export function GoalInput({ value, onChange, onSubmit, placeholder = 'What are you working toward?', size = 34, readOnly, autoFocus, style, tone = 'light', multiline = true }: Props) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      placeholder={placeholder}
      placeholderTextColor={v2.color.placeholder}
      editable={!readOnly}
      autoFocus={autoFocus}
      multiline={multiline}
      blurOnSubmit
      returnKeyType="go"
      cursorColor={v2.color.crimson}
      selectionColor={v2.color.crimson}
      autoCorrect={false}
      style={[
        styles.input,
        { fontSize: size, lineHeight: Math.round(size * 1.15), letterSpacing: -size * 0.02, color: tone === 'dark' ? v2.color.darkInk : v2.color.ink },
        style,
      ]}
      accessibilityLabel={placeholder}
    />
  );
}

const styles = StyleSheet.create({
  input: { ...T.headline, fontFamily: v2.font.bold, padding: 0, margin: 0, textAlignVertical: 'top' },
});
