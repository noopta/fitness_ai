import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { DeltaTag } from './DeltaTag';
import type { LiftRowData } from './LiftRow';
import type { MuscleLedgerEntry, MuscleTrend, IntensityZone } from '../../lib/athleteModel';

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
  /** Optional Athlete-Model ledger entry for this muscle (level-2 drill only). */
  ledgerEntry?: MuscleLedgerEntry | null;
}

const TREND_META: Record<MuscleTrend, { label: string; color: string }> = {
  improving:           { label: 'Improving',   color: '#15803D' },
  plateau:             { label: 'Plateaued',   color: '#B45309' },
  declining:           { label: 'Declining',   color: '#DC2626' },
  'insufficient-data': { label: 'Building up', color: '#71717A' },
};

const ZONE_META: Array<{ key: IntensityZone; label: string; color: string }> = [
  { key: 'strength',    label: 'Strength',  color: '#09090B' },
  { key: 'hypertrophy', label: 'Hypertrophy', color: '#52525B' },
  { key: 'endurance',   label: 'Endurance', color: '#A1A1AA' },
  { key: 'power',       label: 'Power',     color: '#6366F1' },
];

/** Compact per-muscle ledger block — trend, weekly volume, zone split,
 *  confidence. Rendered inside the drill sheet for level-2 muscle taps. */
function MuscleLedgerBlock({ entry }: { entry: MuscleLedgerEntry }) {
  const trend = TREND_META[entry.trend];
  const zones = ZONE_META.filter((z) => (entry.zoneDistribution[z.key] ?? 0) > 0.01);
  return (
    <View style={styles.ledgerBlock}>
      <View style={styles.ledgerStatRow}>
        <View style={styles.ledgerStat}>
          <Text style={styles.ledgerStatLabel}>TREND</Text>
          <Text style={[styles.ledgerStatValue, { color: trend.color }]}>{trend.label}</Text>
        </View>
        <View style={styles.ledgerStat}>
          <Text style={styles.ledgerStatLabel}>WEEKLY SETS</Text>
          <Text style={styles.ledgerStatValue}>{entry.weeklyHardSets}</Text>
        </View>
        <View style={styles.ledgerStat}>
          <Text style={styles.ledgerStatLabel}>CONFIDENCE</Text>
          <Text style={styles.ledgerStatValue}>{Math.round(entry.confidence * 100)}%</Text>
        </View>
      </View>

      {zones.length > 0 && (
        <>
          <Text style={[styles.eyebrow, { marginTop: 14 }]}>Training mix</Text>
          {/* Stacked zone bar */}
          <View style={styles.zoneBar}>
            {zones.map((z) => (
              <View
                key={z.key}
                style={{
                  flex: Math.max(0.001, entry.zoneDistribution[z.key]),
                  backgroundColor: z.color,
                }}
              />
            ))}
          </View>
          <View style={styles.zoneLegend}>
            {zones.map((z) => (
              <View key={z.key} style={styles.zoneLegendItem}>
                <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
                <Text style={styles.zoneLegendText}>
                  {z.label} {Math.round(entry.zoneDistribution[z.key] * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
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
  visible, onClose, axisName, current, target, feedingLifts, onApplyFix, ledgerEntry,
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

        {ledgerEntry && <MuscleLedgerBlock entry={ledgerEntry} />}

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
  let matches = lifts.filter(l => bucket.includes(l.category) && l.current1RMLbs > 0);

  // Level 2 muscle-axis: narrow further to lifts whose name actually trains
  // this muscle (e.g., "Triceps" should not list bench press above tricep
  // pressdowns just because bench has secondary tricep activation).
  const muscleKeyword = MUSCLE_LIFT_KEYWORDS[axisLabel];
  if (muscleKeyword) {
    const filtered = matches.filter(l => muscleKeyword.test(l.name));
    // If the muscle-keyword filter would leave us with nothing (unusual for
    // a user with diverse lifts), fall back to the broader category match
    // rather than show an empty list.
    if (filtered.length > 0) matches = filtered;
  }

  if (matches.length === 0) return [];
  // Order by current1RMLbs descending so the "top contributing lift" reads
  // as the most-impressive first. Take top 3 to keep the list scannable.
  matches.sort((a, b) => b.current1RMLbs - a.current1RMLbs);
  const top = matches.slice(0, 3);
  const total = top.reduce((sum, l) => sum + l.current1RMLbs, 0) || 1;
  return top.map(l => ({
    name: l.name,
    e1rmDisplay: `${l.current1RMLbs} lb`,
    contribPct: Math.round((l.current1RMLbs / total) * 100),
  }));
}

// Map design-axis label → backend lift categories that count toward it.
// Used both for level-1 movement axes (Push/Pull/Squat/Hinge/Core/Power)
// and level-2 muscle axes (Chest/Lats/Quads/etc.) so the same drill sheet
// can describe lifts feeding any node in the radar tree.
const axisToCategoryBucket: Record<string, string[]> = {
  // Level 1 — movement buckets
  Push:  ['push'],
  Pull:  ['pull'],
  Squat: ['legs'],
  Hinge: ['hinge'],
  Core:  ['core'],
  Power: ['cardio'],
  // Level 2 — muscles (point at the same backend categories; the sheet's
  // lift list is best-effort. Muscle-specific filtering happens via the
  // primary-muscle field in deriveFeedingLifts, see below).
  Chest:         ['push'],
  'Front Delt':  ['push'],
  Triceps:       ['push'],
  'Lateral Delt':['push'],
  Lats:          ['pull'],
  'Mid-back':    ['pull'],
  'Rear Delt':   ['pull'],
  Biceps:        ['pull'],
  Forearms:      ['pull'],
  Quads:         ['legs'],
  Glutes:        ['legs', 'hinge'],
  Adductors:     ['legs'],
  Calves:        ['legs'],
  Hamstrings:    ['hinge'],
  Erectors:      ['hinge'],
  'Lower Back':  ['hinge', 'core'],
  Abs:           ['core'],
  Obliques:      ['core'],
  'Hip Power':   ['cardio', 'hinge'],
  'Posterior Chain': ['hinge'],
  Grip:          ['pull'],
};

// Map muscle label → keywords that appear in canonical lift names that train
// that muscle. Used to narrow the level-2 sheet down to only relevant lifts
// (e.g., tapping "Triceps" should show pressdowns + skullcrushers, not bench
// press, even though bench has triceps activation).
const MUSCLE_LIFT_KEYWORDS: Record<string, RegExp> = {
  Chest:         /bench|fly|push.?up|dips|pec deck/i,
  'Front Delt':  /overhead press|shoulder press|arnold|front raise|push press/i,
  Triceps:       /triceps|skullcrusher|pressdown|close grip|dips/i,
  'Lateral Delt':/lateral raise|upright row/i,
  Lats:          /pull.?up|pulldown|lat|row|chin/i,
  'Mid-back':    /row|face pull|rear delt|reverse fly|shrug/i,
  'Rear Delt':   /rear delt|face pull|reverse fly|band pull/i,
  Biceps:        /curl|chin.?up|biceps/i,
  Forearms:      /hammer|wrist|farmer|grip|forearm/i,
  Quads:         /squat|lunge|leg press|leg extension|step up|hack/i,
  Glutes:        /squat|hip thrust|deadlift|lunge|bulgarian|glute/i,
  Adductors:     /sumo|wide stance|adductor|copenhagen/i,
  Calves:        /calf|raise/i,
  Hamstrings:    /deadlift|leg curl|nordic|good morning|romanian|stiff leg|glute ham/i,
  Erectors:      /deadlift|good morning|back extension|hyperextension/i,
  'Lower Back':  /deadlift|good morning|back extension|hyperextension|plank/i,
  Abs:           /crunch|sit.?up|leg raise|ab wheel|rollout|hanging|plank/i,
  Obliques:      /russian twist|side|oblique|woodchop|pallof|landmine/i,
  'Hip Power':   /clean|snatch|swing|jerk|power|jump/i,
  'Posterior Chain': /deadlift|romanian|good morning|swing/i,
  Grip:          /farmer|deadlift|pull.?up|chin|hold/i,
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

  // Per-muscle ledger block (level-2 drill)
  ledgerBlock: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E7',
  },
  ledgerStatRow: { flexDirection: 'row', gap: 8 },
  ledgerStat: { flex: 1 },
  ledgerStatLabel: {
    fontSize: 9, fontWeight: '700', letterSpacing: 0.6,
    color: '#A1A1AA',
  },
  ledgerStatValue: { fontSize: 14, fontWeight: '700', color: '#09090B', marginTop: 2 },
  zoneBar: {
    flexDirection: 'row', height: 8, borderRadius: 4,
    overflow: 'hidden', marginTop: 8,
  },
  zoneLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  zoneLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zoneDot: { width: 7, height: 7, borderRadius: 3.5 },
  zoneLegendText: { fontSize: 11, color: '#52525B' },
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
