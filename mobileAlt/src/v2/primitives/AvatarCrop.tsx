// Profile photo crop (handoff A-02). After the camera or library: "Move and
// scale" — pinch to zoom, drag to move — inside a circle that shows exactly
// what others will see. Use photo crops the square under the circle.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Modal, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Defs, Mask, Rect, Circle } from 'react-native-svg';
import { cropRect } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { TextAction } from './TextAction';

export interface Picked { uri: string; width: number; height: number }

export function AvatarCrop({ picked, onCancel, onUse }: { picked: Picked | null; onCancel: () => void; onUse: (dataUri: string) => Promise<void> | void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const S = Math.min(width - v2.space.gutter * 2, 420);
  const scale = useSharedValue(1), saved = useSharedValue(1);
  const tx = useSharedValue(0), ty = useSharedValue(0), sx = useSharedValue(0), sy = useSharedValue(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { scale.value = 1; saved.value = 1; tx.value = 0; ty.value = 0; }, [picked?.uri]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = picked?.width ?? 1, h = picked?.height ?? 1;
  const base = S / Math.min(w, h);
  // Keep the image covering the circle's square.
  const clamp = (v: number, s: number, dim: number) => { 'worklet'; const lim = Math.max(0, (dim * base * s - S) / 2); return Math.max(-lim, Math.min(lim, v)); };
  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(5, saved.value * e.scale)); tx.value = clamp(tx.value, scale.value, w); ty.value = clamp(ty.value, scale.value, h); })
    .onEnd(() => { saved.value = scale.value; });
  const pan = Gesture.Pan()
    .onStart(() => { sx.value = tx.value; sy.value = ty.value; })
    .onUpdate((e) => { tx.value = clamp(sx.value + e.translationX, scale.value, w); ty.value = clamp(sy.value + e.translationY, scale.value, h); });
  const style = useAnimatedStyle(() => ({ width: w * base, height: h * base, transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  const use = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const rect = cropRect(picked, S, scale.value, tx.value, ty.value);
      const out = await ImageManipulator.manipulateAsync(picked.uri, [{ crop: rect }, { resize: { width: 512, height: 512 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (out.base64) await onUse(`data:image/jpeg;base64,${out.base64}`);
    } finally { setBusy(false); }
  };
  return (
    <Modal visible={!!picked} animationType="slide" onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
          <Text style={[T.caption, { textAlign: 'center' }]}>Move and scale</Text>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
              <View style={{ width: S, height: S, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: v2.color.surface }}>
                {picked ? <Animated.View style={style}><Image source={{ uri: picked.uri }} style={StyleSheet.absoluteFill} /></Animated.View> : null}
                {/* The circle is what others see; outside it is dimmed. */}
                <Svg width={S} height={S} style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Defs><Mask id="hole"><Rect width={S} height={S} fill="white" /><Circle cx={S / 2} cy={S / 2} r={S / 2} fill="black" /></Mask></Defs>
                  <Rect width={S} height={S} fill="rgba(255,255,255,0.72)" mask="url(#hole)" />
                </Svg>
              </View>
            </GestureDetector>
            <Text style={[T.caption, { marginTop: 14 }]}>Pinch to zoom, drag to move.</Text>
          </View>
          <View style={styles.actions}>
            <TextAction primary onPress={() => void use()} loading={busy}>Use photo</TextAction>
            <TextAction muted arrow={false} size={15} onPress={onCancel}>Choose another</TextAction>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white, paddingHorizontal: v2.space.gutter },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28 },
});
