// The Ask pattern — one question with its reason, ≤4 hairline option rows.
//
// On pick: the other rows fade to .25 and the chosen row's arrow slides 6pt,
// then the caller transitions. Always give a reason. After a pick, post an
// Adjusted receipt (the caller does that — this component only reports the
// pick).

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pressable } from './Pressable';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { v2, T } from '../theme';
import { Enter } from './Enter';
import { haptics } from '../haptics';

export interface AskProps {
  question: string;
  reason?: string;
  options: string[];
  onPick?: (option: string, index: number) => void;
  picked?: number | null;
  /** Lock after a pick until the parent moves on (default true). */
  lockOnPick?: boolean;
  tone?: 'light' | 'dark';
  /** Size of the question: headline (default) or read (inline in chat). */
  size?: 'headline' | 'read';
}

function OptionRow({ label, picked, faded, onPress, last, tone }: { label: string; picked: boolean; faded: boolean; onPress: () => void; last: boolean; tone: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  const arrow = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(picked ? 6 : 0, { duration: 200, easing: v2.motion.easeEnter }) }] }));
  const row = useAnimatedStyle(() => ({ opacity: withTiming(faded ? 0.25 : 1, { duration: 200 }) }));
  return (
    <Pressable onPress={onPress} disabled={faded || picked} accessibilityRole="button">
      <Animated.View style={[styles.opt, { borderTopColor: dark ? v2.color.darkHairline : v2.color.hairline }, last && { borderBottomWidth: 1, borderBottomColor: dark ? v2.color.darkHairline : v2.color.hairline }, row]}>
        <Text style={[picked ? T.rowStrong : T.row, dark && { color: v2.color.darkInk }]}>{label}</Text>
        <Animated.Text style={[T.row, { color: v2.color.placeholder }, arrow]}>→</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export function Ask({ question, reason, options, onPick, picked: pickedProp, lockOnPick = true, tone = 'light', size = 'headline' }: AskProps) {
  const [local, setLocal] = useState<number | null>(null);
  const picked = pickedProp !== undefined ? pickedProp : local;
  const dark = tone === 'dark';
  const pick = (o: string, i: number) => {
    if (picked != null && lockOnPick) return;
    haptics.select();
    setLocal(i);
    onPick?.(o, i);
  };
  return (
    <View>
      <Enter exit={false}>
        <Text style={[size === 'headline' ? T.headlineSm : T.read, dark && { color: v2.color.darkInk }]}>{question}</Text>
        {reason ? <Text style={[T.caption, { marginTop: 10, maxWidth: 320 }, dark && { color: v2.color.darkMuted }]}>{reason}</Text> : null}
      </Enter>
      <View style={styles.list}>
        {options.slice(0, 4).map((o, i) => (
          <Enter key={o} index={i + 1} exit={false}>
            <OptionRow label={o} picked={picked === i} faded={picked != null && picked !== i} onPress={() => pick(o, i)} last={i === Math.min(options.length, 4) - 1} tone={tone} />
          </Enter>
        ))}
      </View>
    </View>
  );
}

/** 6pt dots, current and past in crimson. */
export function Dots({ states, tone = 'light' }: { states: boolean[]; tone?: 'light' | 'dark' }) {
  return (
    <View style={styles.dots}>
      {states.map((on, i) => (
        <View key={i} style={[styles.dot, { backgroundColor: on ? v2.color.crimson : tone === 'dark' ? v2.color.darkHairline : v2.color.hairline }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 26 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: v2.space.rowH, paddingVertical: v2.space.rowY, borderTopWidth: 1 },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
