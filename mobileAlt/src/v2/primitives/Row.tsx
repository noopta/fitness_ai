// Hairline list row: name · sub · value or →.
//
// 1px hairline top, min height 52, closing hairline on the last row. The
// trailing → is placeholder grey. `emphasis` bolds the name; `muted` dims the
// whole row (a past phase, a done week). Crimson never appears in a row.

import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { v2, T } from '../theme';
import { haptics } from '../haptics';

export interface RowProps {
  name: string;
  sub?: string | null;
  value?: string | number | null;
  arrow?: boolean;
  emphasis?: boolean;
  muted?: boolean;
  last?: boolean;
  onPress?: () => void;
  /** Big numeral value (24/700) — the detail-page and leaderboard style. */
  bigValue?: boolean;
  valueStyle?: StyleProp<TextStyle>;
  /** Optional element rendered under the name/sub (bars, bands). */
  below?: React.ReactNode;
  /** Optional leading element. */
  leading?: React.ReactNode;
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Row({ name, sub, value, arrow, emphasis, muted, last, onPress, bigValue, valueStyle, below, leading, tone = 'light', style, testID }: RowProps) {
  const dark = tone === 'dark';
  const ink = dark ? v2.color.darkInk : v2.color.ink;
  const mutedC = dark ? v2.color.darkMuted : v2.color.muted;
  const line = dark ? v2.color.darkHairline : v2.color.hairline;
  const showArrow = arrow ?? (!!onPress && value == null);
  const body = (
    <View style={[styles.row, { borderTopColor: line }, last && { borderBottomWidth: 1, borderBottomColor: line }, muted && styles.muted, style]}>
      <View style={styles.main}>
        {leading}
        <View style={styles.text}>
          <Text style={[emphasis ? T.rowStrong : T.row, { color: ink }]} numberOfLines={1}>{name}</Text>
          {sub ? <Text style={[T.caption, { color: mutedC, marginTop: 3 }]} numberOfLines={1}>{sub}</Text> : null}
          {below}
        </View>
      </View>
      {value != null && value !== '' ? (
        <Text style={[bigValue ? styles.big : T.body, { color: bigValue ? ink : mutedC }, T.num, valueStyle]} numberOfLines={1}>{String(value)}</Text>
      ) : showArrow ? (
        <Text style={[T.row, { color: v2.color.placeholder }]}>→</Text>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => { haptics.select(); onPress(); }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      accessibilityRole="button"
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

/** Section eyebrow used above row groups. */
export function Eyebrow({ children, tone = 'light', style }: { children: React.ReactNode; tone?: 'light' | 'dark'; style?: StyleProp<TextStyle> }) {
  return <Text style={[T.eyebrow, tone === 'dark' && { color: v2.color.darkMuted }, style]}>{children}</Text>;
}

/** A 1px hairline. */
export function Hairline({ tone = 'light', style }: { tone?: 'light' | 'dark'; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: tone === 'dark' ? v2.color.darkHairline : v2.color.hairline, width: '100%' }, style]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    minHeight: v2.space.rowH, paddingVertical: v2.space.rowY, borderTopWidth: 1,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  text: { flex: 1, minWidth: 0 },
  muted: { opacity: 0.4 },
  big: { fontFamily: v2.font.bold, fontSize: 24, letterSpacing: -0.5, lineHeight: 28 },
});
