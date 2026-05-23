// WeightInspector — default resting state of the Inspector slot. Body weight
// number, 30-day sparkline, log input, Anakin's coach note. Spec §06.
//
// When the user has already logged today, the input becomes read-only and
// shows the timestamp; the Log button becomes Update (we open the same
// inline-edit affordance — for v1 this just clears the lock so they can re-
// enter a new value).

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, useWindowDimensions,
  Pressable, Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontWeight } from '../../../constants/theme';
import { WeightSparkline } from './WeightSparkline';

export interface WeightState {
  /** Most-recent reading, in lb. */
  current: number | null;
  /** Last 30 days of readings (oldest → newest), in lb. */
  series: number[];
  /** Forecast next-week projection. Renders as the dashed segment. */
  projection?: number;
  /** "−0.65/wk" (signed string the inspector renders as-is). */
  weeklyDelta?: string | null;
  /** Anakin's single-sentence note tied to current state. */
  coachNote?: string | null;
  /** Has the user logged today already? Controls input lock. */
  loggedToday?: boolean;
  /** Formatted "Logged at 7:42 AM" timestamp; only used when loggedToday. */
  loggedTodayLabel?: string;
}

interface Props {
  weight: WeightState;
  /** Body-weight unit hint shown in the input placeholder. */
  unit?: 'lb' | 'kg';
  onLog: (value: number) => void | Promise<void>;
  onPressBody?: () => void;
}

export function WeightInspector({ weight, unit = 'lb', onLog, onPressBody }: Props) {
  const [draft, setDraft] = useState('');
  const [locked, setLocked] = useState(!!weight.loggedToday);
  const { width } = useWindowDimensions();
  const sparklineWidth = Math.max(120, width - 14 * 2 - 24 - 56 - 12); // screen - margins - icon disc - gap

  const submit = async () => {
    const v = parseFloat(draft);
    if (!Number.isFinite(v) || v < 50 || v > 700) {
      // Warning feedback — short single buzz. expo-haptics intentionally not
      // a dep in this app (TierHeroCard takes the same approach).
      Vibration.vibrate(40);
      return;
    }
    await Promise.resolve(onLog(v));
    setDraft('');
    setLocked(true);
    Vibration.vibrate([0, 30, 60, 30]); // short-short "double tap" success
  };

  const hasHistory = (weight.current != null) || weight.series.length > 0;

  return (
    <Pressable onPress={onPressBody} disabled={!onPressBody}>
      <View style={styles.topRow}>
        <View style={styles.iconDisc}>
          <Ionicons name="scale-outline" size={22} color="#ffffff" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.eyebrow}>BODY WEIGHT · 30D</Text>
          {hasHistory ? (
            <View style={styles.weightRow}>
              <Text style={styles.numeral} allowFontScaling={false}>
                {weight.current != null ? weight.current.toFixed(1) : '—'}
              </Text>
              <Text style={styles.unitLabel}>{unit}</Text>
              {weight.weeklyDelta && (
                <Text style={styles.delta} numberOfLines={1}>{weight.weeklyDelta}/wk</Text>
              )}
            </View>
          ) : (
            <Text style={styles.startTitle}>Start tracking your weight.</Text>
          )}
          {weight.coachNote && hasHistory && (
            <Text style={styles.coachNote} numberOfLines={1}>{weight.coachNote}</Text>
          )}
          {!hasHistory && (
            <Text style={styles.coachNote} numberOfLines={2}>
              Logs sharpen the calorie projection after 3 entries.
            </Text>
          )}
        </View>
      </View>

      {hasHistory && weight.series.length > 0 && (
        <View style={styles.sparklineRow}>
          <WeightSparkline
            data={weight.series}
            projection={weight.projection}
            width={sparklineWidth}
            height={36}
          />
        </View>
      )}

      <View style={styles.logRow}>
        <TextInput
          style={[styles.input, locked && styles.inputLocked]}
          editable={!locked}
          value={locked ? (weight.loggedTodayLabel ?? 'Logged today') : draft}
          onChangeText={setDraft}
          placeholder={`Enter weight (${unit})`}
          placeholderTextColor="rgba(255,255,255,0.45)"
          keyboardType="decimal-pad"
        />
        <TouchableOpacity
          style={styles.logButton}
          activeOpacity={0.82}
          onPress={() => {
            if (locked) {
              setLocked(false);
              return;
            }
            submit();
          }}
        >
          <Text style={styles.logButtonText}>{locked ? 'Update' : 'Log'}</Text>
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  iconDisc: {
    width: 56, height: 56, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  weightRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  numeral: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    lineHeight: 28,
  },
  unitLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginLeft: 4,
    marginBottom: 4,
  },
  delta: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: fontWeight.semibold,
    marginLeft: 10,
    marginBottom: 4,
    fontVariant: ['tabular-nums'],
  },
  coachNote: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.70)',
    marginTop: 4,
    lineHeight: 14,
  },
  startTitle: { fontSize: 16, fontWeight: fontWeight.semibold, color: '#ffffff', marginTop: 4 },
  sparklineRow: { marginTop: 8, marginLeft: 68, marginRight: 0 },
  logRow: { flexDirection: 'row', marginTop: 12, alignItems: 'center' },
  input: {
    flex: 1,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    color: '#ffffff',
    fontSize: 13,
  },
  inputLocked: { opacity: 0.6 },
  logButton: {
    marginLeft: 8,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButtonText: { color: '#09090b', fontWeight: fontWeight.bold, fontSize: 13 },
});
