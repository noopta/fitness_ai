// One-line "not a medical professional" note (Apple 1.4.1 / audit Oct 2026).
// Small and muted on purpose — present wherever Anakin gives a verdict, a
// safety flag or starts a conversation, without shouting over the content.
import React from 'react';
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

export const MEDICAL_DISCLAIMER =
  'Anakin is an AI coach, not a medical professional. For pain, injury or health conditions, see a qualified clinician.';

export function MedicalDisclaimer({ style, color }: { style?: StyleProp<TextStyle>; color?: string }) {
  return (
    <Text style={[styles.text, color ? { color } : null, style]} accessibilityRole="text">
      {MEDICAL_DISCLAIMER}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 12, lineHeight: 17, color: '#71717a', marginTop: 8 },
});
