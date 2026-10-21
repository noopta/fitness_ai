import React, { useEffect, useState } from 'react';
import {
  InputAccessoryView, Keyboard, TouchableOpacity, Text,
  View, StyleSheet, Platform, KeyboardEvent,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';

// Shared ID used as inputAccessoryViewID on every TextInput in a screen.
// Only one bar needs to be rendered per screen — all inputs share it.
export const KEYBOARD_DONE_ID = 'axiom-keyboard-done';

/**
 * A "Done" affordance above the keyboard, on both platforms.
 *
 * iOS gets a real InputAccessoryView, anchored by the OS.
 *
 * Android used to get NOTHING — this component returned null with a comment
 * claiming "numeric keyboards already have a Done/Enter key". That is only true
 * for numeric inputs. On a `multiline` TextInput (coach chat, message compose,
 * notes) Android shows a newline key instead, so there was no way to dismiss the
 * keyboard from inside the app at all. Reported as "the keyboard is
 * unescapable" on the Chat tab.
 *
 * InputAccessoryView is iOS-only, so on Android we position a bar ourselves,
 * anchored to the top of the IME using keyboard events. It only mounts while
 * the keyboard is actually open, so it costs nothing the rest of the time.
 *
 * Usage (Oct 2026 — the standard for every input in the app):
 *   1. v2: already mounted once in app/(v2)/_layout.tsx. Inside a <Modal>,
 *      render <KeyboardDoneBar force /> (a Modal is its own window).
 *   2. Add inputAccessoryViewID={KEYBOARD_DONE_ID} to every TextInput / Input
 *      (iOS only needs this; Android ignores the prop). Without it iOS shows
 *      its own floating "Done" pill over the content instead of this strip.
 */
// One bar at a time: the v2 layout mounts it for every screen, and older
// screens and sheets that render their own don't stack a second pill on
// Android. The earliest mounted instance draws it; `force` (a Modal, which is
// its own window) always draws.
let nextId = 1;
const mounted: number[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function KeyboardDoneBar({ force = false }: { force?: boolean } = {}) {
  // Hooks must run unconditionally, so the platform split happens at render.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [id] = useState(() => nextId++);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (force) return;
    mounted.push(id);
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    notify();
    return () => { mounted.splice(mounted.indexOf(id), 1); listeners.delete(l); notify(); };
  }, [id, force]);
  const owner = force || mounted[0] === id;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onShow = (e: KeyboardEvent) => setKeyboardHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    // `Did` rather than `Will`: Android does not emit the Will* events
    // reliably, and we only need the final resting height.
    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  if (!owner) return null;

  if (Platform.OS === 'ios') {
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

  if (Platform.OS !== 'android' || keyboardHeight === 0) return null;

  return (
    // box-none so only the button itself is tappable — the bar must never
    // swallow taps meant for the input or content behind it.
    <View
      pointerEvents="box-none"
      style={[styles.androidAnchor, { bottom: keyboardHeight }]}
    >
      <TouchableOpacity
        onPress={Keyboard.dismiss}
        hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        style={styles.androidPill}
        accessibilityRole="button"
        accessibilityLabel="Dismiss keyboard"
      >
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
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
  // Android: a right-aligned pill floating just above the IME. Deliberately
  // not a full-width bar — a full-width strip would cover the input it is
  // meant to sit above on screens whose input is already keyboard-adjacent.
  androidAnchor: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 100,
    elevation: 100,
  },
  androidPill: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
    marginBottom: 6,
  },
  doneText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    // Ink, never a color — handoff §2 (semantic color only).
    color: colors.foreground,
    letterSpacing: -0.1,
  },
});
