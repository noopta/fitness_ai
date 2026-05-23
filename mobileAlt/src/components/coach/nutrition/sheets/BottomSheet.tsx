// Shared bottom-sheet primitive used by every Nutrition sheet.
//
// Drives the animation with Reanimated so the backdrop *fades* in while the
// sheet content *slides* up from the bottom. React Native's built-in Modal
// `animationType="slide"` slides the entire surface (backdrop + sheet)
// together, which reads as the whole black panel sweeping up the screen —
// the spec wants the smoother fade-darken behaviour the rest of the app
// uses for in-app browsers and the UpgradeSheet.
//
// Sheet-stack discipline (spec §10): one sheet visible at a time. The
// parent owns visibility via openSheet union state, so opening a new
// sheet implicitly closes the others.

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, useWindowDimensions,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
  runOnJS, useReducedMotion,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontWeight } from '../../../../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /**
   * Optional subtitle below the title — a one-liner that orients the user.
   * Spec calls for at least the drag-handle pill; keep this concise.
   */
  subtitle?: string;
  children: React.ReactNode;
  /**
   * Whether the user can dismiss by tapping the dimmed backdrop. Defaults
   * to true; flip to false when mid-action (e.g. saving a meal) so taps
   * don't kill the request in flight.
   */
  dismissOnBackdrop?: boolean;
}

const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const ENTER_MS = 280;
const EXIT_MS = 220;

export function BottomSheet({
  visible, onClose, title, subtitle, children, dismissOnBackdrop = true,
}: Props) {
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.min(height * 0.92, height - 40);
  const reduced = useReducedMotion();

  // We track an internal "mounted" state so the exit animation gets to play
  // before the Modal actually unmounts. visible=true → mount + animate in;
  // visible=false → animate out + unmount on completion.
  const [mounted, setMounted] = useState(visible);
  const backdrop = useSharedValue(0);
  const translateY = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduced) {
        backdrop.value = 1;
        translateY.value = 0;
      } else {
        backdrop.value = withTiming(1, { duration: ENTER_MS, easing: EASE });
        translateY.value = withTiming(0, { duration: ENTER_MS, easing: EASE });
      }
    } else if (mounted) {
      if (reduced) {
        backdrop.value = 0;
        translateY.value = height;
        setMounted(false);
      } else {
        backdrop.value = withTiming(0, { duration: EXIT_MS, easing: EASE });
        translateY.value = withTiming(
          height,
          { duration: EXIT_MS, easing: EASE },
          (finished) => { if (finished) runOnJS(setMounted)(false); },
        );
      }
    }
    // height should change rarely (orientation flip); not part of the
    // animation dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduced]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value * 0.55 }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFillObject, styles.backdropBase, backdropStyle]} />
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={dismissOnBackdrop ? onClose : undefined}
          accessibilityLabel="Close sheet"
          accessibilityRole="button"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[styles.sheet, { maxHeight: sheetMaxHeight }, sheetStyle]}
          >
            <SafeAreaView edges={['bottom']} style={styles.safe}>
              {/* Drag-handle pill — purely visual; the wrapper doesn't
                  support swipe-to-close gestures for v1. */}
              <View style={styles.handle} />

              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} accessibilityRole="header">{title}</Text>
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Close ${title}`}
                >
                  <Ionicons name="close" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <View style={styles.body}>{children}</View>
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdropBase: { backgroundColor: '#000' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  safe: { flex: 0 },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: fontWeight.bold, color: colors.foreground, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2, lineHeight: 16 },
  body: { paddingTop: 4, paddingBottom: 16 },
});
