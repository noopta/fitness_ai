import React from 'react';
import {
  InputAccessoryView, Keyboard, TouchableOpacity, Text,
  View, StyleSheet, Platform,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';

// Shared ID used as inputAccessoryViewID on every TextInput in a screen.
// Only one bar needs to be rendered per screen — all inputs share it.
export const KEYBOARD_DONE_ID = 'axiom-keyboard-done';

/**
 * Renders a "Done" toolbar above the iOS keyboard.
 * On Android, numeric keyboards already have a Done/Enter key — render nothing.
 *
 * Usage:
 *   1. Render <KeyboardDoneBar /> once anywhere in the screen tree.
 *   2. Add inputAccessoryViewID={KEYBOARD_DONE_ID} to every TextInput / Input.
 */
export function KeyboardDoneBar() {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={Keyboard.dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    // Match the sheet surface, not the iOS system grey — the bar should read
    // as part of our UI (monochrome zinc system), not a foreign OS strip.
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  doneText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    // Ink, never a color — handoff §2 (semantic color only).
    color: colors.foreground,
    letterSpacing: -0.1,
  },
});
