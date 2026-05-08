import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { DeltaTag } from './DeltaTag';
import type { LiftRowData } from './LiftRow';

const SCREEN_H = Dimensions.get('window').height;

interface AxisLift {
  name: string;
  e1rmDisplay: string; // "185" or "+45 lb" — bodyweight lifts pre-formatted by caller
  contribPct: number;  // 0..100 — relative contribution to this axis
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Axis name e.g. "Pull". Null hides the sheet content. */
  axisName: string | null;
  /** Current 0..100 score. */
  current: number | null;
  /** Target 0..100 score. */
  target: number | null;
  /** Up to 3 lifts feeding this axis with their contribution share. */
  feedingLifts: AxisLift[];
  /** Tap the apply-fix CTA — caller routes to the relevant program edit. */
  onApplyFix?: () => void;
}

/**
 * Drill-down on a single radar axis. Opens when the user taps an axis label.
 *
 * Layout per the handoff:
 *  - axis name + big number + delta vs target
 *  - amber "Lagging" callout when current < target by ≥ 10 points
 *  - list of contributing lifts with %-contribution and current e1RM
 *  - sticky CTA at the bottom
 *
 * If we don't yet have feedingLifts (backend doesn't expose this mapping),
 * the list area falls back to a friendly note rather than rendering empty.
 */
export function RadarAxisDrillSheet({
  visible, onClose, axisName, current, target, feedingLifts, onApplyFix,
}: Props) {
  if (!axisName) {
    return (
      <BottomSheet visible={visible} onClose={onClose} height={1}>
        <View />
      </BottomSheet>
    );
  }

  const delta = current != null && target != null ? current - target : null;
  const isLagging = delta != null && delta <= -10;

  return (
    <BottomSheet visible={visible} onClose={onClose} height={SCREEN_H * 0.66} style={styles.sheet}>
      <View style={styles.handle} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{axisName} · axis</Text>
            <Text style={styles.title}>{axisName} strength</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.bigNumber} allowFontScaling={false}>
              {current != null ? Math.round(current) : '—'}
            </Text>
            {delta != null && (
              <DeltaTag
                value={Math.round(delta)}
                suffix={` vs target ${target}`}
                size={11}
              />
            )}
          </View>
        </View>

        {isLagging && (
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>Lagging.</Text>
            <Text style={styles.warningBody}>
              {' '}Your {axisName.toLowerCase()} is the limiting axis on the radar. Adding 1
              variation per week typically closes this gap in ~6 weeks.
            </Text>
          </View>
        )}

        <Text style={[styles.eyebrow, { marginTop: 18 }]}>Lifts feeding this axis</Text>
        <View style={{ marginTop: 8 }}>
          {feedingLifts.length === 0 ? (
            <Text style={styles.emptyNote}>
              Log a few sessions for this movement bucket to see which lifts are pulling the score
              up — and which are holding it back.
            </Text>
          ) : (
            feedingLifts.map((l, i, arr) => (
              <View
                key={l.name}
                style={[
                  styles.liftRow,
                  i < arr.length - 1 && styles.liftRowBorder,
                ]}
              >
                <Text style={styles.liftName}>{l.name}</Text>
                <Text style={styles.contrib}>{l.contribPct}%</Text>
                <Text style={styles.e1rm} allowFontScaling={false}>{l.e1rmDisplay}</Text>
              </View>
            ))
          )}
        </View>

        <TouchableOpacity
          style={styles.cta}
          onPress={onApplyFix}
          accessibilityRole="button"
          accessibilityLabel={`Apply Anakin's ${axisName.toLowerCase()} fix`}
        >
          <Text style={styles.ctaText}>Apply Anakin's {axisName.toLowerCase()} fix</Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * Helper: synthesize feeding-lifts for a radar axis from the screen's
 * already-loaded lift list. Picks lifts whose canonical category matches
 * the axis bucket. Contribution is rough (proportional to current e1RM).
 *
 * Exported so the screen can build the prop without duplicating the mapping.
 */
export function deriveFeedingLifts(
  axisLabel: string,
  lifts: Array<{ name: string; category: string; current1RMLbs: number }>,
): AxisLift[] {
  const bucket = axisToCategoryBucket[axisLabel];
  if (!bucket) return [];
  const matches = lifts.filter(l => bucket.includes(l.category) && l.current1RMLbs > 0);
  if (matches.length === 0) return [];
  const total = matches.reduce((sum, l) => sum + l.current1RMLbs, 0) || 1;
  return matches
    .slice(0, 3)
    .map(l => ({
      name: l.name,
      e1rmDisplay: `${l.current1RMLbs} lb`,
      contribPct: Math.round((l.current1RMLbs / total) * 100),
    }));
}

// Map design-axis label → backend lift categories that count toward it.
const axisToCategoryBucket: Record<string, string[]> = {
  Push:  ['push'],
  Pull:  ['pull'],
  Squat: ['legs'],
  Hinge: ['hinge'],
  Core:  ['core'],
  Power: ['cardio'], // best fit we have for the "Power" axis until backend ships it
};

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF' },
  handle: {
    width: 36, height: 4, borderRadius: 999, backgroundColor: '#D4D4D8',
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    textTransform: 'uppercase', color: '#71717A',
  },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginTop: 4, color: '#09090B' },
  bigNumber: {
    fontSize: 32, fontWeight: '800', letterSpacing: -0.6,
    color: '#09090B', fontVariant: ['tabular-nums'], lineHeight: 36,
  },
  warning: {
    marginTop: 14, padding: 12, borderRadius: 12,
    backgroundColor: '#FEF3C7',
  },
  warningTitle: { color: '#B45309', fontSize: 12, fontWeight: '700' },
  warningBody: { color: '#B45309', fontSize: 12, lineHeight: 18 },
  emptyNote: { fontSize: 13, color: '#71717A', lineHeight: 19 },
  liftRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
  },
  liftRowBorder: { borderBottomWidth: 1, borderBottomColor: '#E4E4E7' },
  liftName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#09090B' },
  contrib: { fontSize: 11, color: '#71717A', fontFamily: 'Menlo' },
  e1rm: {
    fontSize: 14, fontWeight: '700', color: '#09090B',
    fontVariant: ['tabular-nums'], minWidth: 60, textAlign: 'right',
  },
  cta: {
    marginTop: 24, height: 44, backgroundColor: '#09090B',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
