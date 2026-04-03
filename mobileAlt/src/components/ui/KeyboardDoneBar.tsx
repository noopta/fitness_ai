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
    backgroundColor: '#f1f1f1',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#c7c7cc',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  doneText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: '#007AFF', // iOS system blue — matches native look
  },
});
