// ProteinCelebration — a small, self-contained confetti + badge burst shown
// once when the user first hits their daily protein goal. Pure react-native
// Animated (no new native dependency), so it ships without a rebuild. Renders
// as a non-interactive full-screen overlay that auto-dismisses.

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, Vibration, useWindowDimensions } from 'react-native';
import { colors, radius, spacing, fontSize, fontWeight } from '../../../constants/theme';

const CONFETTI_COUNT = 28;
const CONFETTI_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a78bfa'];
const DURATION = 2200;

interface Props {
  visible: boolean;
  onDone?: () => void;
  /** Headline shown in the center pill. */
  label?: string;
}

interface Piece {
  startX: number;
  color: string;
  size: number;
  delay: number;
  rotateTo: number;
  drift: number;
}

function ConfettiPiece({ piece, progress, fallHeight }: { piece: Piece; progress: Animated.Value; fallHeight: number }) {
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-40, fallHeight + 40] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.rotateTo}deg`] });
  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: piece.startX,
        top: 0,
        width: piece.size,
        height: piece.size * 0.5,
        borderRadius: 1,
        backgroundColor: piece.color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    />
  );
}

export function ProteinCelebration({ visible, onDone, label = 'Protein goal hit 💪' }: Props) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;

  // Stable random piece layout per mount of a celebration.
  const pieces = useMemo<Piece[]>(() => {
    return Array.from({ length: CONFETTI_COUNT }, () => ({
      startX: Math.random() * width,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 8,
      delay: Math.random() * 250,
      rotateTo: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 540),
      drift: (Math.random() - 0.5) * 120,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, width]);

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    badgeScale.setValue(0.6);
    badgeOpacity.setValue(0);
    Vibration.vibrate([0, 30, 50, 60]);

    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.spring(badgeScale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(badgeScale, { toValue: 0.9, duration: 300, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(badgeOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.delay(1100),
        Animated.timing(badgeOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start(({ finished }) => {
      if (finished) onDone?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <ConfettiPiece key={i} piece={p} progress={progress} fallHeight={height} />
      ))}
      <View style={styles.center} pointerEvents="none">
        <Animated.View
          style={[styles.badge, { opacity: badgeOpacity, transform: [{ scale: badgeScale }] }]}
        >
          <Text style={styles.badgeText}>{label}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  badge: {
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  badgeText: { color: colors.background, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
