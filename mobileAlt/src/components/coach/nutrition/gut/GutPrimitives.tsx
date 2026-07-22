// Gut-health shared primitives — handoff §6. All opaque, hairline-bordered,
// token-driven. Status is never color-alone (dot + label pairing, §10).
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { colors } from '../../../../constants/theme';

export type BandStatus = 'ok' | 'low' | 'vlow';

const STATUS_STYLES: Record<BandStatus, { soft: string; ink: string; base: string; label: string }> = {
  ok:   { soft: colors.successSoft,     ink: colors.successInk,     base: colors.success,     label: 'On track' },
  low:  { soft: colors.warningSoft,     ink: colors.warningInk,     base: colors.warning,     label: 'Low' },
  vlow: { soft: colors.destructiveSoft, ink: colors.destructiveInk, base: colors.destructive, label: 'Very low' },
};

// Limit-direction nutrients read inverted ("Over" not "Very low").
export function statusLabel(status: BandStatus, direction?: 'meet' | 'limit'): string {
  if (direction === 'limit') {
    return status === 'ok' ? 'On track' : status === 'low' ? 'High' : 'Over';
  }
  return STATUS_STYLES[status].label;
}

export function StatusPill({ status, direction }: { status: BandStatus; direction?: 'meet' | 'limit' }) {
  const s = STATUS_STYLES[status];
  return (
    <View style={{ backgroundColor: s.soft, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8, alignSelf: 'flex-start' }}>
      <Text style={{ color: s.ink, fontSize: 10, fontWeight: '700' }}>{statusLabel(status, direction)}</Text>
    </View>
  );
}

export function StatusDot({ status }: { status: BandStatus }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_STYLES[status].base }} />;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: selected ? 0 : 1, borderColor: colors.border, borderRadius: 999,
        paddingVertical: 5, paddingHorizontal: 11,
        backgroundColor: selected ? colors.foreground : colors.background,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color: selected ? colors.primaryForeground : '#3f3f46' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CitationChip({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.citationSoft, borderWidth: 1, borderColor: colors.citationBorder,
        borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: colors.citation, fontSize: 10, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// Progress bar — track muted, fill ink (calories) or status color. §6.
export function ProgressBar({
  pct, height = 6, fill,
}: { pct: number; height?: number; fill?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: Math.max(0, Math.min(1, pct / 100)), duration: 600, useNativeDriver: false }).start();
  }, [pct, anim]);
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: colors.muted, overflow: 'hidden' }}>
      <Animated.View
        style={{
          height, borderRadius: 999,
          backgroundColor: fill ?? colors.foreground,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

export function PillarBar({
  label, score, status, detail,
}: { label: string; score: number; status: BandStatus; detail: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.rowBetween}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StatusDot status={status} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>{label}</Text>
        </View>
        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{detail}</Text>
      </View>
      <ProgressBar pct={score} height={5} fill={STATUS_STYLES[status].base} />
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options, value, onChange,
}: { options: Array<{ key: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 8, padding: 2 }}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={{
            flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center',
            backgroundColor: value === o.key ? colors.foreground : 'transparent',
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '600', color: value === o.key ? colors.primaryForeground : '#3f3f46' }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Eyebrow({ children }: { children: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: '#a1a1aa' }}>
      {children}
    </Text>
  );
}

export const EST_NOTE = 'est. ±30%';

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
