import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated';
import { Sparkline } from './Sparkline';
import { DeltaTag } from './DeltaTag';

export interface LiftRowData {
  name: string;
  e1rm: number | null;
  unit: 'lb' | 'kg';
  delta30d: number | null;
  spark: number[];
}

interface Props {
  lift: LiftRowData;
  /** Used to stagger the sparkline draw across rows (80ms each, per spec). */
  rowIndex: number;
  onPress?: (lift: LiftRowData) => void;
  /** Fires after a 500ms hold — caller typically opens an action menu. */
  onLongPress?: (lift: LiftRowData) => void;
}

/**
 * Single lift row in the "Working e1RMs" list. Grid:
 *   1fr · 60px sparkline · 56px e1RM · auto delta
 *
 * Press → opens LiftDetailSheet. Long-press (500ms) → caller's
 * onLongPress handler (typically a native Alert action menu).
 */
export function LiftRow({ lift, rowIndex, onPress, onLongPress }: Props) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const negative = lift.delta30d != null && lift.delta30d < 0;

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
      onPress={() => onPress?.(lift)}
      onLongPress={() => onLongPress?.(lift)}
      delayLongPress={500}
      accessibilityRole="button"
      accessibilityLabel={
        `${lift.name}, ${lift.e1rm != null ? `e1RM ${lift.e1rm} ${lift.unit}` : 'no e1RM'}`
      }
    >
      <Animated.View style={[styles.row, animStyle]}>
        <Text style={styles.name} numberOfLines={1}>{lift.name}</Text>
        <View style={styles.sparkSlot}>
          <Sparkline
            values={lift.spark}
            width={60}
            height={20}
            stroke={negative ? '#EF4444' : '#18181B'}
            rowIndex={rowIndex}
          />
        </View>
        <View style={styles.e1rmSlot}>
          {lift.e1rm != null ? (
            <Text style={styles.e1rm} allowFontScaling={false}>
              {lift.e1rm}
              <Text style={styles.unit}> {lift.unit}</Text>
            </Text>
          ) : (
            <Text style={styles.e1rmPlaceholder} allowFontScaling={false}>—</Text>
          )}
        </View>
        <DeltaTag value={lift.delta30d} suffix="" size={10} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  name: { flex: 1, fontSize: 13, fontWeight: '600', color: '#09090B' },
  sparkSlot: { width: 60 },
  e1rmSlot: { minWidth: 56, alignItems: 'flex-end' },
  e1rm: {
    fontSize: 16,
    fontWeight: '700',
    color: '#09090B',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 10, color: '#71717A', fontWeight: '500' },
  e1rmPlaceholder: {
    fontSize: 16,
    fontWeight: '700',
    color: '#71717A',
    fontFamily: 'Menlo',
  },
});
