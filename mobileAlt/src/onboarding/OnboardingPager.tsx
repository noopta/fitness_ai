import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Pressable, StatusBar,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Scene01Problem } from './scenes/Scene01Problem';
import { Scene02FalseChoice } from './scenes/Scene02FalseChoice';
import { Scene03Evidence } from './scenes/Scene03Evidence';
import { Scene04Moat } from './scenes/Scene04Moat';
import { Scene05Results } from './scenes/Scene05Results';
import { Scene06Agent } from './scenes/Scene06Agent';
import { Scene07SignIn } from './scenes/Scene07SignIn';
import { s } from './theme';
import { Asset } from 'expo-asset';
import { DITHERED } from './assets/dithered/manifest';

const SCENE_COUNT = 7;
const SWIPE_THRESHOLD = 45;
export const ONBOARDING_SEEN_KEY = 'cinematicOnboardingSeen.v1';

interface Props {
  onSignedIn: () => void;             // parent routes after successful auth
}

/**
 * Per spec §09. Horizontal pager with crossfade transitions on index change.
 * Gestures:
 *   - swipe left  → next
 *   - swipe right → previous
 *   - tap-to-advance (except on the last scene)
 *   - Continue / Back buttons
 *
 * Persists the active index to AsyncStorage so restart restores position.
 */
export function OnboardingPager({ onSignedIn }: Props) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const fade = useSharedValue(1);

  // Preload the baked dither images so a scene paints instantly on arrival
  // (no flash of the deep wash before the photo appears).
  useEffect(() => {
    void Asset.loadAsync(Object.values(DITHERED));
  }, []);

  const advance = useCallback((delta: 1 | -1) => {
    setIndex((current) => {
      const next = Math.max(0, Math.min(SCENE_COUNT - 1, current + delta));
      if (next !== current) {
        // Snap the scene to invisible BEFORE the remount commits, so the mount
        // hitch (new Skia canvas + reanimated nodes) happens at opacity 0 and is
        // hidden, then fade the finished scene in. DitherImage no longer self-
        // fades and photos are preloaded, so this is the ONLY fade on a scene
        // change — no double "blink".
        fade.value = 0;
        fade.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
        void AsyncStorage.setItem('cinematicOnboardingIndex.v1', String(next));
      }
      return next;
    });
  }, []);

  const isLast = index === SCENE_COUNT - 1;

  // ─── Gestures ──────────────────────────────────────────────────────────
  const pan = Gesture.Pan()
    .onEnd((e) => {
      'worklet';
      const dx = e.translationX;
      const dy = e.translationY;
      // require predominantly horizontal motion past threshold
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      runOnJS(advance)(dx < 0 ? 1 : -1);
    });

  // Tap-to-advance — disabled on the last scene (the sign-in buttons own taps)
  const tap = Gesture.Tap()
    .maxDistance(8)
    .onEnd(() => {
      'worklet';
      if (isLast) return;
      runOnJS(advance)(1);
    });

  const composed = Gesture.Simultaneous(pan, tap);

  // ─── Scene render ──────────────────────────────────────────────────────
  // Keyed so Reveal/CountUp animations replay every time we arrive on a scene.
  const sceneKey = `scene-${index}`;
  let SceneNode: React.ReactNode;
  switch (index) {
    case 0: SceneNode = <Scene01Problem      key={sceneKey} />; break;
    case 1: SceneNode = <Scene02FalseChoice  key={sceneKey} />; break;
    case 2: SceneNode = <Scene03Evidence     key={sceneKey} />; break;
    case 3: SceneNode = <Scene04Moat         key={sceneKey} />; break;
    case 4: SceneNode = <Scene05Results      key={sceneKey} />; break;
    case 5: SceneNode = <Scene06Agent        key={sceneKey} />; break;
    case 6: SceneNode = <Scene07SignIn       key={sceneKey} onSignedIn={onSignedIn} />; break;
  }

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <GestureDetector gesture={composed}>
        <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
          {SceneNode}
        </Animated.View>
      </GestureDetector>

      {/* Bottom bar — progress dots + buttons */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom + 8, 26) }]} pointerEvents="box-none">
        <View style={styles.dotsRow}>
          {Array.from({ length: SCENE_COUNT }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dotBase,
                i === index ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        <View style={styles.btnRow}>
          {/* Back chevron — disabled on scene 0 */}
          <Pressable
            onPress={() => advance(-1)}
            disabled={index === 0}
            style={({ pressed }) => [
              styles.backBtn,
              index === 0 && { opacity: 0.3 },
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={16} color="#fff" />
          </Pressable>

          {/* Continue — hidden on last scene */}
          {!isLast && (
            <TouchableOpacity style={styles.continueBtn} onPress={() => advance(1)} activeOpacity={0.85}>
              <Text style={styles.continueText}>Continue</Text>
              <Ionicons name="arrow-forward" size={15} color="#09090b" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070708' },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 24,
    flexDirection: 'column',
    gap: 14,
  },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dotBase: { height: 4, borderRadius: 2 },
  dotActive:   { width: 22, backgroundColor: '#fff' },
  dotInactive: { width: 4,  backgroundColor: 'rgba(255,255,255,0.28)' },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  continueBtn: {
    height: 44, paddingHorizontal: 20, borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff',
  },
  continueText: { color: '#09090b', fontSize: 14.5, fontWeight: '600' },
});

// Helper consumed by _layout to gate onboarding to first launches only.
export async function hasSeenCinematicOnboarding(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function markCinematicOnboardingSeen(): Promise<void> {
  try { await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1'); } catch { /* ignore */ }
}
