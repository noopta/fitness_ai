import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { PHOTOS } from './assets/photos/manifest';
import { preloadPhotos } from './dither/photoCache';

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
  // The scene leaving during a crossfade. Both the incoming (new index) and the
  // outgoing (prevIndex) scenes stay mounted for the transition, each keyed by
  // its own index so neither remounts (no reveal-replay flicker).
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const indexRef = useRef(0);
  const progress = useSharedValue(1);   // 0 at transition start → 1 settled

  // Decode every scene photo once, up front, so navigating to a scene paints the
  // dithered image on its first frame instead of flashing the deep wash + bloom.
  useEffect(() => {
    void preloadPhotos(Object.values(PHOTOS) as unknown as number[]);
  }, []);

  const advance = useCallback((delta: 1 | -1) => {
    const current = indexRef.current;
    const next = Math.max(0, Math.min(SCENE_COUNT - 1, current + delta));
    if (next === current) return;
    indexRef.current = next;
    setPrevIndex(current);
    setIndex(next);
    // Crossfade: hold the outgoing scene on top and fade it out to reveal the
    // incoming scene (which plays its own staggered reveals underneath) — no
    // blank frame, no hard cut.
    progress.value = 0;
    progress.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(setPrevIndex)(null);
    });
    void AsyncStorage.setItem('cinematicOnboardingIndex.v1', String(next));
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
  // Each scene keyed by its index so it mounts fresh (reveals replay) on arrival
  // and is preserved (not remounted) while it fades out as the previous scene.
  const renderScene = (i: number): React.ReactNode => {
    switch (i) {
      case 0: return <Scene01Problem      key={`scene-${i}`} />;
      case 1: return <Scene02FalseChoice  key={`scene-${i}`} />;
      case 2: return <Scene03Evidence     key={`scene-${i}`} />;
      case 3: return <Scene04Moat         key={`scene-${i}`} />;
      case 4: return <Scene05Results      key={`scene-${i}`} />;
      case 5: return <Scene06Agent        key={`scene-${i}`} />;
      case 6: return <Scene07SignIn       key={`scene-${i}`} onSignedIn={onSignedIn} />;
      default: return null;
    }
  };

  // Incoming scene sits at full opacity (its own reveals animate it in); the
  // outgoing scene fades out on top of it. incoming (index) under, outgoing over.
  const incomingStyle = useAnimatedStyle(() => ({ opacity: 1 }));
  const outgoingStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const layers = prevIndex === null ? [index] : [index, prevIndex];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <GestureDetector gesture={composed}>
        <View style={StyleSheet.absoluteFill}>
          {layers.map((i) => (
            <Animated.View
              key={`layer-${i}`}
              style={[StyleSheet.absoluteFill, i === index ? incomingStyle : outgoingStyle]}
              pointerEvents={i === index ? 'auto' : 'none'}
            >
              {renderScene(i)}
            </Animated.View>
          ))}
        </View>
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
