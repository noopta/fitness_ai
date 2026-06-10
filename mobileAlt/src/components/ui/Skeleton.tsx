import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { colors, radius } from '../../constants/theme';

interface Props {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

// Pulsing-opacity placeholder. Lighter implementation than a moving-gradient
// shimmer (no LinearGradient dep, no MaskedView) — visually reads as the same
// "loading" cue to users while staying easy to compose into per-screen
// skeletons. One shared Animated.Value per mount drives the pulse so dozens
// of skeleton blocks on a single screen animate in sync (rather than each one
// drifting independently, which reads as noisy).
export function Skeleton({ width, height = 14, borderRadius = radius.sm, style }: Props) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.muted,
          opacity,
        },
        style,
      ]}
    />
  );
}

// Convenience wrappers for the common shapes. Avoids `<Skeleton borderRadius={9999}>`
// noise at call sites and lets us tweak the canonical sizes in one place.

export function SkeletonText({ width, height = 14, style }: { width?: number | string; height?: number; style?: ViewStyle }) {
  return <Skeleton width={width} height={height} borderRadius={radius.sm} style={style} />;
}

export function SkeletonCircle({ size = 40, style }: { size?: number; style?: ViewStyle }) {
  return <Skeleton width={size} height={size} borderRadius={size / 2} style={style} />;
}

export function SkeletonCard({ height = 120, style }: { height?: number; style?: ViewStyle }) {
  return <Skeleton width="100%" height={height} borderRadius={radius.lg} style={style} />;
}

// Coach-tab specific skeleton: mirrors the dashboard layout (header row,
// tab bar, hero card, two stat cards, today's workout card) so users see a
// stable shape before content lands instead of a centered spinner.
export function CoachDashboardSkeleton() {
  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* Header: avatar + name/subtitle + cta */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SkeletonCircle size={48} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonText width={120} height={18} />
          <SkeletonText width={90} height={12} />
        </View>
        <SkeletonText width={88} height={28} />
      </View>

      {/* Tab bar */}
      <View style={{ flexDirection: 'row', gap: 16, paddingTop: 4 }}>
        {[60, 60, 70, 70, 50].map((w, i) => (
          <SkeletonText key={i} width={w} height={16} />
        ))}
      </View>

      {/* Hero / today's workout card */}
      <SkeletonCard height={160} />

      {/* Two side-by-side stat cards */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><SkeletonCard height={88} /></View>
        <View style={{ flex: 1 }}><SkeletonCard height={88} /></View>
      </View>

      {/* List rows */}
      <View style={{ gap: 10 }}>
        <SkeletonText width="40%" height={16} />
        {[0, 1, 2].map(i => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <SkeletonCircle size={36} />
            <View style={{ flex: 1, gap: 6 }}>
              <SkeletonText width="70%" height={14} />
              <SkeletonText width="40%" height={10} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
