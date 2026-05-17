import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Vibration } from 'react-native';
import Svg, { Defs, Pattern, Path, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue, withTiming, withSequence,
  runOnJS, Easing, useReducedMotion,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TierLadder } from './TierLadder';
import { DeltaTag } from './DeltaTag';
import { ConfidenceRing } from './ConfidenceRing';

const CELEBRATED_KEY_PREFIX = 'strength:tierCelebrated:';

interface Props {
  /** Display tier name, e.g. "Intermediate II". */
  tier: string;
  /** 1..6 — current tier rung. */
  tierIndex: number;
  /** Optional. Top X percentile. */
  percentile: number | null;
  /** Optional. Wilks (or strength-index analog). Animates count-up on mount. */
  wilks: number | null;
  /** 30-day delta. null → renders em-dash placeholder. */
  delta30d: number | null;
  /** Athlete-Model completeness 0-1. When provided, renders the confidence
   *  ring + footer line. Omit on flag-off accounts (no Athlete Model). */
  confidence?: number | null;
  /** Tap → opens TierExplainerSheet (callback wires to the existing sheet system). */
  onPress?: () => void;
}

/**
 * Dark elevated hero card — the centerpiece of the Strength Profile screen.
 * Faint 20px grid pattern at 6% opacity, 16px outer margin, 20px radius.
 * Inside: tier label + percentile + Wilks count-up + 30D delta pill + ladder.
 *
 * Press feedback: scaleX 0.97 + opacity 0.96 on pressIn, springs back on
 * pressOut. Whole card is the hit area; opens the tier explainer sheet.
 */
export function TierHeroCard({
  tier, tierIndex, percentile, wilks, delta30d, confidence, onPress,
}: Props) {
  const reducedMotion = useReducedMotion();

  // Press scale
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  // Wilks count-up — 0 → wilks over 700ms on mount
  const wilksAnim = useSharedValue(0);
  const [displayWilks, setDisplayWilks] = useState<number | null>(wilks);

  useEffect(() => {
    if (wilks == null) return;
    if (reducedMotion) {
      setDisplayWilks(wilks);
      wilksAnim.value = wilks;
      return;
    }
    wilksAnim.value = 0;
    setDisplayWilks(0);
    wilksAnim.value = withTiming(wilks, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [wilks, reducedMotion, wilksAnim]);

  // ── Tier-up celebration ─────────────────────────────────────────────────
  // When tierIndex crosses to a higher rung between sessions, the card
  // pulses 1× to 1.4× scale on the active ladder segment (driven by ladder
  // re-mount key change), the hero card flashes a 1px white border for
  // 600ms, and we fire a soft haptic. Persisted per-tier in AsyncStorage so
  // a user who already saw the 'reached Intermediate II' celebration doesn't
  // see it again when they reopen the app.
  const flashBorder = useSharedValue(0);
  const lastCelebratedTier = useRef<number | null>(null);

  useEffect(() => {
    if (tierIndex < 1) return;
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(CELEBRATED_KEY_PREFIX + tierIndex);
        if (cancelled || seen) return;
        // Only celebrate when we know the previous tier (refs in-session).
        // Fresh installs skip the celebration on first paint.
        if (lastCelebratedTier.current == null) {
          lastCelebratedTier.current = tierIndex;
          // Persist anyway — the user is on tierIndex and shouldn't see it later.
          await AsyncStorage.setItem(CELEBRATED_KEY_PREFIX + tierIndex, '1');
          return;
        }
        if (tierIndex > lastCelebratedTier.current) {
          if (!reducedMotion) {
            flashBorder.value = withSequence(
              withTiming(1, { duration: 80 }),
              withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }),
            );
            // Soft success haptic via built-in Vibration (avoids adding
            // expo-haptics; pattern is short-short for a "double tap" feel).
            try { Vibration.vibrate([0, 30, 50, 60]); } catch { /* simulator */ }
          }
          await AsyncStorage.setItem(CELEBRATED_KEY_PREFIX + tierIndex, '1');
        }
        lastCelebratedTier.current = tierIndex;
      } catch { /* AsyncStorage failure → skip celebration */ }
    })();
    return () => { cancelled = true; };
  }, [tierIndex, reducedMotion, flashBorder]);

  // Border width is fixed (so layout never reflows); we animate opacity
  // by interpolating the stroke color's alpha channel from 0 → 1. Avoids
  // the layout-thrash crash that comes from animating borderWidth on iOS.
  const flashStyle = useAnimatedStyle(() => ({
    borderColor: `rgba(255,255,255,${flashBorder.value})`,
  }));

  // Tick the React state whenever the worklet value changes — but only on
  // integer steps so we don't churn JS for every sub-pixel frame.
  // Reanimated 4 expects useDerivedValue to return a value; we return the
  // tick number so the hook is structurally well-formed.
  useDerivedValue(() => {
    'worklet';
    const intVal = Math.round(wilksAnim.value);
    runOnJS(setDisplayWilks)(intVal);
    return intVal;
  });

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: 90 });
        opacity.value = withTiming(0.96, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 160 });
        opacity.value = withTiming(1, { duration: 160 });
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Tier ${tierIndex} of 6, ${tier}${percentile != null ? `, top ${percentile} percent` : ''}. Tap to view tier ladder.`}
    >
      <Animated.View style={[styles.card, pressStyle, flashStyle]}>
        {/* Faint grid background */}
        <Svg width="100%" height="100%" style={styles.grid} pointerEvents="none">
          <Defs>
            <Pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <Path d="M0 20H20M20 0V20" stroke="#FFFFFF" strokeWidth="0.5" fill="none" />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#grid)" />
        </Svg>

        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Tier · {tierIndex} of 6</Text>
            <Text style={styles.tierName} numberOfLines={1}>{tier}</Text>
            <View style={styles.subRow}>
              {percentile != null ? (
                <Text style={styles.subText}>Top {percentile}%</Text>
              ) : (
                <Text style={[styles.subText, styles.placeholder]}>—</Text>
              )}
              {displayWilks != null && (
                <>
                  <Text style={styles.subDot}>·</Text>
                  <Text style={styles.subText} allowFontScaling={false}>{displayWilks} Wilks</Text>
                </>
              )}
            </View>
          </View>

          {/* Right column — confidence ring (Athlete Model) over the 30D pill */}
          <View style={styles.rightCol}>
            {confidence != null && <ConfidenceRing value={confidence} size={56} />}
            <View style={styles.deltaPill}>
              <DeltaTag value={delta30d} suffix="" size={10} invert />
              <Text style={styles.deltaPillSuffix}>  30D</Text>
            </View>
          </View>
        </View>

        {/* Ladder */}
        <View style={{ marginTop: 16 }}>
          <TierLadder tierIndex={tierIndex} />
        </View>
        <View style={styles.tierLabelsRow}>
          <Text style={styles.tierLabel}>Novice</Text>
          <Text style={styles.tierLabel}>Inter.</Text>
          <Text style={styles.tierLabel}>Adv.</Text>
          <Text style={styles.tierLabel}>Elite</Text>
        </View>

        {/* Read-confidence footer line — present only with an Athlete Model */}
        {confidence != null && (
          <Text style={styles.confidenceFooter}>
            Read confidence · {Math.round(confidence * 100)}% · sharpens as you log
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#09090B',
    borderRadius: 20,
    padding: 20,
    paddingBottom: 18,
    overflow: 'hidden',
    position: 'relative',
    // Border is always present; alpha is animated via flashStyle so the
    // celebration flash doesn't reflow layout.
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0)',
  },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.06,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
  },
  tierName: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: '#FFFFFF',
    marginTop: 4,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 },
  subText: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  subDot:  { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  placeholder: { fontFamily: 'Menlo', color: 'rgba(255,255,255,0.4)' },
  rightCol: { alignItems: 'flex-end', gap: 8 },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  deltaPillSuffix: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  tierLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  tierLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.45)',
  },
  confidenceFooter: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '500',
  },
});
