// Shared segmented control for the Nutrition Profile surfaces. The profile's
// Today|7 days|30 days selector and the trend screen's 7d|30d toggle were
// specced as the same treatment, so they're one component rather than two
// copies of the same five styles.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { fontWeight } from '../../../constants/theme';
import { NP } from './npTokens';

export interface NpSegmentOption<T extends string> {
  value: T;
  label: string;
  /** Spoken label — the visible one is abbreviated to fit three across. */
  a11yLabel?: string;
}

export function NpSegmented<T extends string>({
  options, value, onChange, style,
}: {
  options: ReadonlyArray<NpSegmentOption<T>>;
  value: T;
  onChange: (next: T) => void;
  style?: object;
}) {
  return (
    <View style={[styles.segment, style]}>
      {options.map(opt => {
        const on = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segItem, on && styles.segItemOn]}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={opt.a11yLabel ?? opt.label}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: NP.muted, borderRadius: 10, padding: 4, gap: 4 },
  segItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segItemOn: { backgroundColor: NP.cardBg, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  segText: { fontSize: 13, fontWeight: fontWeight.semibold, color: NP.mutedInk },
  segTextOn: { color: NP.ink, fontWeight: fontWeight.bold },
});
