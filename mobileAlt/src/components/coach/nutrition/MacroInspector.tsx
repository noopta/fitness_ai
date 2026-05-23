// MacroInspector — selected macro's large ring + status text + dismiss X.
// Spec: handoff §06.

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontWeight } from '../../../constants/theme';
import { MacroRing, MACRO_LABEL, type MacroState } from './MacroRing';

interface Props {
  macro: MacroState;
  onDismiss: () => void;
  /** Anakin's prescription / over-target note, depending on state. */
  coachNote?: string | null;
}

export function MacroInspector({ macro, onDismiss, coachNote }: Props) {
  const target = macro.target ?? 0;
  const pct = target > 0 ? macro.used / target : 0;
  const remaining = Math.max(0, target - macro.used);
  const over = Math.max(0, macro.used - target);
  const isOver = macro.used > target && target > 0;

  return (
    <View style={styles.row}>
      <MacroRing macro={macro} size={56} stroke={6} onDark />

      <View style={styles.textCol}>
        <Text style={styles.eyebrow}>
          {MACRO_LABEL[macro.key].toUpperCase()}
          {target > 0 ? ` · ${Math.round(pct * 100)}%` : ' · NO TARGET'}
        </Text>
        <View style={styles.line2}>
          <Text style={styles.bigNum} allowFontScaling={false}>{Math.round(macro.used)}</Text>
          <Text style={styles.bigUnit}>
            {target > 0 ? ` /${Math.round(target)}g · ` : 'g logged'}
          </Text>
          {target > 0 && (
            <Text style={[styles.toGo, isOver && styles.toGoOver]}>
              {isOver ? `${Math.round(over)}g over` : `${Math.round(remaining)}g to go`}
            </Text>
          )}
        </View>
        {coachNote ? (
          <Text style={styles.coachNote} numberOfLines={2}>{coachNote}</Text>
        ) : null}
      </View>

      <Pressable
        style={styles.dismiss}
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Close macro inspector"
      >
        <Ionicons name="close" size={12} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  textCol: { flex: 1, marginLeft: 14 },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: fontWeight.bold,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  line2: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3, flexWrap: 'wrap' },
  bigNum: {
    fontSize: 16,
    fontWeight: fontWeight.bold,
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  bigUnit: { fontSize: 12, color: 'rgba(255,255,255,0.70)' },
  toGo: { fontSize: 12, color: '#f59e0b', fontWeight: fontWeight.semibold },
  toGoOver: { color: '#ef4444' },
  coachNote: { fontSize: 10.5, color: 'rgba(255,255,255,0.70)', marginTop: 5, lineHeight: 14 },
  dismiss: {
    width: 24, height: 24, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 10,
  },
});
