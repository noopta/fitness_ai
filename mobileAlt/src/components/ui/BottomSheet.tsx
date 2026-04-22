import React, { useState, useEffect } from 'react';
import { Modal, StyleSheet, Pressable, Dimensions, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS,
} from 'react-native-reanimated';

const SCREEN_H = Dimensions.get('window').height;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: number | string;
  style?: ViewStyle;
}

export function BottomSheet({ visible, onClose, children, height = '75%', style }: BottomSheetProps) {
  const [mounted, setMounted] = useState(visible);
  const slideY      = useSharedValue(SCREEN_H);
  const backdropAlpha = useSharedValue(0);

  const sheetAnim = useAnimatedStyle(() => ({
    transform: [{ translateY: slideY.value }],
  }));
  const backdropAnim = useAnimatedStyle(() => ({
    opacity: backdropAlpha.value,
  }));

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideY.value      = withTiming(0,       { duration: 320, easing: Easing.out(Easing.ease) });
      backdropAlpha.value = withTiming(1,     { duration: 320 });
    } else if (mounted) {
      slideY.value      = withTiming(SCREEN_H, { duration: 260, easing: Easing.in(Easing.ease) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
      backdropAlpha.value = withTiming(0, { duration: 260 });
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View
        style={[StyleSheet.absoluteFill, bs.backdrop, backdropAnim]}
        pointerEvents="none"
      />
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View style={[bs.sheet, { height }, sheetAnim, style]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

const bs = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
});
