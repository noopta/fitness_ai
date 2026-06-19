// The photo window for "with photo" cards. Renders the user's pump pic at the
// given CropTransform inside an aspect-locked, clipped window. When `interactive`
// it layers pinch-zoom + drag-to-pan + double-tap-reset directly on the live
// card (the framing UI *is* the card — spec §6). When static (other templates'
// previews and at capture), it just applies the persisted crop.
//
// scale 1 = cover (image fills the window, no letterboxing). Pan is clamped so
// the image edges can never pull inside the window at the current scale.

import React, { useEffect } from 'react';
import { View, Image, StyleSheet, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { CropTransform, DEFAULT_CROP } from './types';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

interface Props {
  uri: string;
  crop: CropTransform;
  width: number;
  height: number;
  borderRadius?: number;
  interactive?: boolean;
  onCropChange?: (c: CropTransform) => void;
  children?: React.ReactNode;
  style?: ViewStyle;
}

export function PhotoWindow({
  uri, crop, width, height, borderRadius = 0, interactive = false, onCropChange, children, style,
}: Props) {
  const scale = useSharedValue(crop.scale);
  const offX = useSharedValue(crop.offsetX);
  const offY = useSharedValue(crop.offsetY);
  // Saved at gesture start so pinch/pan compose from the right baseline.
  const startScale = useSharedValue(crop.scale);
  const startX = useSharedValue(crop.offsetX);
  const startY = useSharedValue(crop.offsetY);

  // Keep shared values in sync with the persisted crop when not mid-gesture
  // (e.g. a template switch re-letterboxes the same crop into a new window).
  useEffect(() => {
    scale.value = crop.scale;
    offX.value = crop.offsetX;
    offY.value = crop.offsetY;
  }, [crop.scale, crop.offsetX, crop.offsetY]);

  const report = (s: number, x: number, y: number) => {
    onCropChange?.({ scale: s, offsetX: x, offsetY: y });
  };

  const pinch = Gesture.Pinch()
    .onStart(() => { startScale.value = scale.value; })
    .onUpdate((e) => {
      'worklet';
      const next = Math.min(Math.max(startScale.value * e.scale, MIN_SCALE), MAX_SCALE);
      scale.value = next;
      const max = Math.max((next - 1) / 2, 0);
      offX.value = Math.min(Math.max(offX.value, -max), max);
      offY.value = Math.min(Math.max(offY.value, -max), max);
    })
    .onEnd(() => { runOnJS(report)(scale.value, offX.value, offY.value); });

  const pan = Gesture.Pan()
    .onStart(() => { startX.value = offX.value; startY.value = offY.value; })
    .onUpdate((e) => {
      'worklet';
      const max = Math.max((scale.value - 1) / 2, 0);
      offX.value = Math.min(Math.max(startX.value + e.translationX / width, -max), max);
      offY.value = Math.min(Math.max(startY.value + e.translationY / height, -max), max);
    })
    .onEnd(() => { runOnJS(report)(scale.value, offX.value, offY.value); });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      scale.value = withTiming(DEFAULT_CROP.scale, { duration: 180 });
      offX.value = withTiming(DEFAULT_CROP.offsetX, { duration: 180 });
      offY.value = withTiming(DEFAULT_CROP.offsetY, { duration: 180 });
      runOnJS(report)(DEFAULT_CROP.scale, DEFAULT_CROP.offsetX, DEFAULT_CROP.offsetY);
    });

  const gesture = Gesture.Simultaneous(Gesture.Race(doubleTap, pan), pinch);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offX.value * width },
      { translateY: offY.value * height },
      { scale: scale.value },
    ],
  }));

  const windowStyle: ViewStyle = { width, height, borderRadius, overflow: 'hidden' };

  const body = (
    <View style={[windowStyle, style]}>
      <Animated.Image
        source={{ uri }}
        style={[{ width, height }, imgStyle]}
        resizeMode="cover"
      />
      {children ? <View style={StyleSheet.absoluteFill}>{children}</View> : null}
    </View>
  );

  if (!interactive) {
    // Static render — apply the persisted crop without gesture handling.
    return (
      <View style={[windowStyle, style]}>
        <Image
          source={{ uri }}
          style={{
            width, height,
            transform: [
              { translateX: crop.offsetX * width },
              { translateY: crop.offsetY * height },
              { scale: crop.scale },
            ],
          }}
          resizeMode="cover"
        />
        {children ? <View style={StyleSheet.absoluteFill}>{children}</View> : null}
      </View>
    );
  }

  return <GestureDetector gesture={gesture}>{body}</GestureDetector>;
}
