// The two ends of the barcode flow around the Portion sheet (handoff Nov 2026):
// ScanOverlay sits on the live camera, LoggedStage is the confirmation with Undo.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation, useReducedMotion } from 'react-native-reanimated';
import type { ReceiptVerb } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Pressable } from '../primitives/Pressable';
import { Mark } from '../primitives/Mark';
import { TextAction } from '../primitives/TextAction';
import { ReceiptList } from '../primitives/Receipt';

const C = v2.color;
const FINDER_W = 260;
const FINDER_H = 160;
const SWEEP_MS = 2200;
const UNDO_MS = 6000;

const Corner = ({ style }: { style: object }) => <View style={[styles.corner, style]} />;

export function ScanOverlay({ locked, headline, receipts, live, modes, activeMode, onMode, onClose, onReview, onRescan }: {
  locked: boolean;
  headline: string;
  receipts: { verb: ReceiptVerb; text: string }[];
  live: boolean;
  modes: { key: string; label: string }[];
  activeMode: string;
  onMode: (key: string) => void;
  onClose: () => void;
  /** Set once the sheet has been dismissed. */
  onReview?: () => void;
  onRescan?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const reduced = useReducedMotion();
  const top = Math.round(H * 0.36 - FINDER_H / 2);

  const sweep = useSharedValue(-70);
  useEffect(() => {
    if (locked || reduced) { cancelAnimation(sweep); sweep.value = 0; return; }
    sweep.value = -70;
    sweep.value = withRepeat(withTiming(70, { duration: SWEEP_MS, easing: v2.motion.easeIO }), -1, true);
    return () => cancelAnimation(sweep);
  }, [locked, reduced, sweep]);
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value }] }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { top: insets.top + 12 }]}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.back}>← Fuel</Text></Pressable>
        <Text style={styles.topRight}>Scan</Text>
      </View>

      <View pointerEvents="none" style={[styles.finder, { top }]}>
        <Corner style={{ left: 0, top: 0, borderLeftWidth: 2, borderTopWidth: 2, borderTopLeftRadius: 10 }} />
        <Corner style={{ right: 0, top: 0, borderRightWidth: 2, borderTopWidth: 2, borderTopRightRadius: 10 }} />
        <Corner style={{ left: 0, bottom: 0, borderLeftWidth: 2, borderBottomWidth: 2, borderBottomLeftRadius: 10 }} />
        <Corner style={{ right: 0, bottom: 0, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 10 }} />
        <Animated.View style={[styles.line, locked && { backgroundColor: C.crimson }, lineStyle]} />
      </View>

      <View style={[styles.status, { top: top + FINDER_H + 36 }]} pointerEvents="box-none">
        <Text style={styles.headline}>{headline}</Text>
        <View style={{ marginTop: 14 }}><ReceiptList items={receipts} tone="dark" liveIndex={live ? receipts.length - 1 : -1} animate={false} /></View>
        {onReview ? (
          <View style={styles.review}>
            <TextAction tone="dark" onPress={onReview}>Review</TextAction>
            {onRescan ? <TextAction tone="dark" muted arrow={false} size={15} onPress={onRescan}>Rescan</TextAction> : null}
          </View>
        ) : null}
      </View>

      <View style={[styles.modes, { bottom: Math.max(48, insets.bottom + 20) }]}>
        {modes.map((m) => (
          <Pressable key={m.key} onPress={() => onMode(m.key)} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: m.key === activeMode }}>
            <Text style={[styles.mode, { color: m.key === activeMode ? C.darkInk : C.darkMuted }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function LoggedStage({ read, receipts, onBack, onScanAnother, onUndo }: {
  read: string;
  receipts: { verb: ReceiptVerb; text: string }[];
  onBack: () => void;
  onScanAnother: () => void;
  onUndo: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [canUndo, setCanUndo] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setCanUndo(false), UNDO_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={[styles.logged, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Text style={[T.body, { color: C.muted }]}>← Fuel</Text></Pressable>
      <View style={{ flex: 1 }} />
      <View style={styles.readRow}>
        <Mark size={18} style={{ marginTop: 4 }} />
        <Text style={styles.read}>{read}</Text>
      </View>
      <View style={{ marginTop: 22 }}><ReceiptList items={receipts} /></View>
      <View style={styles.loggedActions}>
        <TextAction onPress={onScanAnother}>Scan another</TextAction>
        {canUndo ? <TextAction muted arrow={false} onPress={onUndo}>Undo</TextAction> : null}
      </View>
      <View style={{ flex: 1.2 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: v2.space.gutter, right: v2.space.gutter, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontFamily: v2.font.regular, fontSize: 15, lineHeight: 23, color: C.darkMuted },
  topRight: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 19.5, color: C.darkMuted },
  finder: { position: 'absolute', alignSelf: 'center', width: FINDER_W, height: FINDER_H, justifyContent: 'center' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: C.darkInk },
  line: { position: 'absolute', left: 20, right: 20, top: FINDER_H / 2, height: 1, backgroundColor: 'rgba(255,255,255,.6)' },
  status: { position: 'absolute', left: v2.space.gutter, right: v2.space.gutter },
  headline: { fontFamily: v2.font.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48, color: C.darkInk },
  review: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 18 },
  modes: { position: 'absolute', left: v2.space.gutter, right: v2.space.gutter, flexDirection: 'row', justifyContent: 'space-evenly' },
  mode: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 23 },
  logged: { flex: 1, backgroundColor: C.white, paddingHorizontal: v2.space.gutter },
  readRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  read: { flex: 1, fontFamily: v2.font.medium, fontSize: 20, lineHeight: 26, letterSpacing: -0.2, color: C.ink },
  loggedActions: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 22 },
});
