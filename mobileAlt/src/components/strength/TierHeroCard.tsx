import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Defs, Pattern, Path, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue, withTiming, runOnJS, Easing,
  useReducedMotion, interpolate,
} from 'react-native-reanimated';
import { TierLadder } from './TierLadder';
import { DeltaTag } from './DeltaTag';

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
  tier, tierIndex, percentile, wilks, delta30d, onPress,
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

  // Tick the React state whenever the worklet value changes — but only on
  // integer steps so we don't churn JS for every sub-pixel frame.
  useDerivedValue(() => {
    'worklet';
    const intVal = Math.round(wilksAnim.value);
    runOnJS(setDisplayWilks)(intVal);
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
      <Animated.View style={[styles.card, pressStyle]}>
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

          <View style={styles.deltaPill}>
            <DeltaTag value={delta30d} suffix="" size={10} invert />
            <Text style={styles.deltaPillSuffix}>  30D</Text>
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
});
