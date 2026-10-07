// Bottom sheet for v2 — the one the design handoff uses for Backdate, Analyze,
// Barcode not found, the post menu, Share, Switch to classic, Swap and Life
// happened. A dimmed scrim over the screen (tap to close), a white sheet that
// rises from the bottom with a grabber, its own safe-area padding, and keyboard
// avoidance inside the Modal (Modals never inherit the app's avoidance).
//
// PromptSheet is a one-field text prompt on top of it. It replaces
// Alert.prompt, which only exists on iOS — on Android those taps did nothing.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, type KeyboardTypeOptions } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './Pressable';
import { TextAction } from './TextAction';
import { v2, T } from '../theme';

export function Sheet({ visible, onClose, title, sub, children }: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  sub?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        {visible ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.scrim}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
          </Animated.View>
        ) : null}
        {visible ? (
          <Animated.View entering={SlideInDown.duration(280).easing(v2.motion.easeEnter)} exiting={SlideOutDown.duration(220)}
            style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
            <View style={styles.grabber} />
            {title ? <Text style={[T.headlineSm, { fontSize: 20, lineHeight: 26 }]}>{title}</Text> : null}
            {sub ? <Text style={[T.caption, { marginTop: 6 }]}>{sub}</Text> : null}
            <View style={{ marginTop: title || sub ? 16 : 0 }}>{children}</View>
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function PromptSheet({ visible, title, sub, initial = '', placeholder, keyboardType = 'default', unit, saveLabel = 'Save', onSubmit, onClose }: {
  visible: boolean;
  title: string;
  sub?: string;
  initial?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  unit?: string;
  saveLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setValue(initial); setBusy(false); } }, [visible, initial]);
  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    try { await onSubmit(v); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title} sub={sub}>
      <View style={styles.field}>
        <TextInput value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={v2.color.placeholder}
          keyboardType={keyboardType} autoFocus selectTextOnFocus style={styles.input} onSubmitEditing={() => void submit()}
          returnKeyType="done" cursorColor={v2.color.crimson} selectionColor={v2.color.crimson} accessibilityLabel={title} />
        {unit ? <Text style={T.body}>{unit}</Text> : null}
      </View>
      <View style={styles.actions}>
        <TextAction primary onPress={() => void submit()} loading={busy}>{saveLabel}</TextAction>
        <TextAction muted arrow={false} onPress={onClose}>Cancel</TextAction>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.45)' },
  sheet: { backgroundColor: v2.color.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: v2.space.gutter, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: v2.color.hairline, marginBottom: 16 },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 8, borderBottomWidth: 1, borderBottomColor: v2.color.ink, paddingBottom: 6 },
  input: { flex: 1, fontFamily: v2.font.semibold, fontSize: 28, color: v2.color.ink, padding: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 22 },
});
