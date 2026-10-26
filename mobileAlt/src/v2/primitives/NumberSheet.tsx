// One number, typed on the number pad — the guided session's weight and reps
// (Oct 2026). Built like ManualSheet, not on PromptSheet: no Modal, an overlay
// on the screen that rides the keyboard frame-for-frame
// (useReanimatedKeyboardAnimation), so it opens with the keyboard, stays
// attached to it, and never floats with a gap. PromptSheet's Modal +
// KeyboardAvoidingView misplaced the sheet under SDK 55 edge-to-edge (behind
// the keyboard, mid-screen, or not at all) and lagged on open.
//
// The field starts empty with the current value as its placeholder, so typing
// replaces it — "315" typed over "315" used to become 315315.
//
// Render it once at the screen root (it fills the screen when open). It keeps
// keyboard-controller on while the screen is mounted, so tracking is live
// before the first open.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Keyboard, type KeyboardTypeOptions } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardController, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { Pressable } from './Pressable';
import { TextAction } from './TextAction';
import { v2, T } from '../theme';
import { KEYBOARD_DONE_ID } from '../../components/ui/KeyboardDoneBar';

export interface NumberSheetProps {
  visible: boolean;
  title: string;
  sub?: string;
  /** Shown greyed in the empty field; typing replaces it. */
  current?: string;
  unit?: string;
  decimal?: boolean;
  /** Inclusive bounds; anything outside is refused with a line under the field. */
  min?: number;
  max?: number;
  saveLabel?: string;
  /** A second answer that isn't a number (the session's "It's bodyweight"). */
  secondary?: { label: string; onPress: () => void };
  onSubmit: (value: number) => void;
  onClose: () => void;
}

/** Pure: the typed text → a number within bounds, or why not. */
export function parseNumberInput(text: string, opts: { decimal?: boolean; min?: number; max?: number }): { value: number } | { error: string } | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = opts.decimal ? parseFloat(t) : parseInt(t, 10);
  if (!Number.isFinite(n)) return { error: 'Enter a number.' };
  if (opts.min != null && n < opts.min) return { error: `At least ${opts.min}.` };
  if (opts.max != null && n > opts.max) return { error: `That’s more than ${opts.max} — check it.` };
  return { value: opts.decimal ? Math.round(n * 10) / 10 : n };
}

export function NumberSheet({ visible, title, sub, current, unit, decimal, min = 0, max, saveLabel = 'Use this', secondary, onSubmit, onClose }: NumberSheetProps) {
  const insets = useSafeAreaInsets();
  const kc = useKeyboardController();
  const { height: kb, progress } = useReanimatedKeyboardAnimation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  // Keyboard tracking on for the screen's life. Not switched off on unmount — that would race Home
  // turning it on for chat; every v2 page re-asserts its own setting when it regains focus (Home.tsx).
  useEffect(() => { kc.setEnabled(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) { setText(''); setError(null); } }, [visible]);

  // The sheet sits on the keyboard: lifted by its height, with the home-indicator padding only while it's down.
  const base = Math.max(insets.bottom, 16);
  const ride = useAnimatedStyle(() => ({
    transform: [{ translateY: kb.value }],
    paddingBottom: base * (1 - progress.value) + 14 * progress.value,
  }));

  const close = () => { Keyboard.dismiss(); onClose(); };
  const submit = () => {
    const r = parseNumberInput(text, { decimal, min, max });
    if (!r) { close(); return; } // nothing typed: keep what was there
    if ('error' in r) { setError(r.error); return; }
    Keyboard.dismiss();
    onSubmit(r.value);
  };

  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.sheet, ride]} accessibilityViewIsModal>
        <View style={styles.grabber} />
        <Text style={[T.headlineSm, { fontSize: 20, lineHeight: 26 }]}>{title}</Text>
        {sub ? <Text style={[T.caption, { marginTop: 4 }]}>{sub}</Text> : null}
        <View style={styles.field}>
          <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} ref={input} value={text} onChangeText={(v) => { setText(v.replace(decimal ? /[^0-9.,]/g : /[^0-9]/g, '')); setError(null); }}
            placeholder={current ?? ''} placeholderTextColor={v2.color.placeholder} keyboardType={(decimal ? 'decimal-pad' : 'number-pad') as KeyboardTypeOptions}
            autoFocus maxLength={decimal ? 6 : 3} style={styles.input} onSubmitEditing={submit} returnKeyType="done"
            cursorColor={v2.color.crimson} selectionColor={v2.color.crimson} accessibilityLabel={title} />
          {unit ? <Text style={[T.body, { color: v2.color.muted }]}>{unit}</Text> : null}
        </View>
        {error ? <Text style={[T.caption, { color: v2.color.crimson, marginTop: 6 }]}>{error}</Text> : null}
        <View style={styles.actions}>
          <TextAction primary onPress={submit}>{saveLabel}</TextAction>
          {secondary ? <TextAction arrow={false} onPress={() => { Keyboard.dismiss(); secondary.onPress(); }}>{secondary.label}</TextAction> : null}
          <TextAction muted arrow={false} onPress={close}>Cancel</TextAction>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: v2.color.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: v2.color.white, borderTopLeftRadius: v2.radius.sheet, borderTopRightRadius: v2.radius.sheet, paddingHorizontal: v2.space.gutter, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: v2.color.hairline, marginBottom: 14 },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 8, borderBottomWidth: 1, borderBottomColor: v2.color.ink, paddingBottom: 6, marginTop: 14 },
  input: { flex: 1, fontFamily: v2.font.semibold, fontSize: 30, color: v2.color.ink, padding: 0, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 18 },
});
