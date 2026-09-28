// A line of agent work: `VERB — what Anakin did`.
//
// Verb is the tool class from the registry. Write verbs (Logged / Adjusted /
// Proposed) render crimson, reads muted. Delegated children indent 16.
// `streaming` shows a blinking caret; `dim` fades older lines to .45.
// Never render a receipt the stream didn't emit.

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, cancelAnimation, useReducedMotion } from 'react-native-reanimated';
import { isWriteVerb, type ReceiptVerb } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Enter } from './Enter';

interface Props {
  verb: ReceiptVerb;
  text: string;
  indent?: boolean;
  streaming?: boolean;
  dim?: boolean;
  /** For dark grounds (home brief). */
  tone?: 'light' | 'dark';
  index?: number;
  animate?: boolean;
}

export function Caret({ color = v2.color.crimson, height = 14 }: { color?: string; height?: number }) {
  const op = useSharedValue(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) { op.value = 1; return; }
    op.value = withRepeat(withTiming(0, { duration: 450 }), -1, true);
    return () => cancelAnimation(op);
  }, [op, reduced]);
  const s = useAnimatedStyle(() => ({ opacity: op.value }));
  return <Animated.View style={[{ width: 2, height, backgroundColor: color, marginLeft: 3, marginBottom: -2 }, s]} />;
}

export function Receipt({ verb, text, indent, streaming, dim, tone = 'light', index = 0, animate = true }: Props) {
  const write = isWriteVerb(verb);
  const verbColor = write ? v2.color.crimson : tone === 'dark' ? v2.color.darkMuted : v2.color.muted;
  const textColor = tone === 'dark' ? v2.color.darkMuted : v2.color.muted;
  const body = (
    <View style={[styles.row, indent && styles.indent, dim && styles.dim]}>
      <Text style={[styles.verb, { color: verbColor }]}>{verb.toUpperCase()}</Text>
      <Text style={[styles.dash, { color: textColor }]}> — </Text>
      <Text style={[styles.text, { color: textColor }]}>
        {text}
        {streaming ? <Caret /> : null}
      </Text>
    </View>
  );
  return animate ? <Enter index={index} exit={false}>{body}</Enter> : body;
}

/** A stack of receipts with the older lines dimmed. */
export function ReceiptList({ items, tone = 'light', liveIndex = -1, animate = true }: {
  items: { id?: string; verb: ReceiptVerb; text: string; indent?: boolean }[];
  tone?: 'light' | 'dark';
  liveIndex?: number;
  animate?: boolean;
}) {
  return (
    <View style={styles.list}>
      {items.map((r, i) => (
        <Receipt
          key={r.id ?? `${i}-${r.verb}`}
          verb={r.verb}
          text={r.text}
          indent={r.indent}
          tone={tone}
          index={animate ? i : 0}
          animate={animate}
          streaming={i === liveIndex}
          dim={liveIndex >= 0 ? i < liveIndex && i !== items.length - 1 : i < items.length - 1 && items.length > 3}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 7 },
  row: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  indent: { paddingLeft: 16 },
  dim: { opacity: 0.45 },
  verb: { ...T.eyebrow, letterSpacing: 1.1, fontSize: 10.5 },
  dash: { ...T.caption },
  text: { ...T.caption, flexShrink: 1 },
});
