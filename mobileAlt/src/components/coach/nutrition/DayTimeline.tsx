// DayTimeline — primary scroll surface. Renders logged meals followed by
// ghost-slot suggestions for the rest of the day. Spec: handoff §06.
//
// Implementation notes
// - One absolutely-positioned vertical spine behind the dots — we don't paint
//   the line per-row, which keeps it crisp regardless of row height.
// - Each row is a [time gutter · dot · payload card] composition. Logged dot
//   is solid zinc-950; ghost dot is a dashed ring on transparent.
// - 90 pt bottom-pad reserves space for the floating ActionDock.

import React from 'react';
import {
  View, Text, StyleSheet, Pressable, TouchableOpacity, ScrollView,
} from 'react-native';
import { colors, fontWeight } from '../../../constants/theme';

export interface LoggedMeal {
  id: string;
  /** "07:42" / "12:55" — local 24h, used to format the gutter time. */
  time: string;
  slot: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'LATE';
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface GhostSlot {
  id: string;
  time: string;
  slot: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'LATE';
  suggestedName: string;
  budgetKcal: number;
}

interface Props {
  meals: LoggedMeal[];
  ghosts: GhostSlot[];
  onMealPress?: (m: LoggedMeal) => void;
  onGhostPress?: (g: GhostSlot) => void;
}

// "07:42" → "7:42a", drops minutes :00.
function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t;
  const period = h < 12 ? 'a' : 'p';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh}${period}` : `${hh}:${String(m).padStart(2, '0')}${period}`;
}

function MealRow({ meal, onPress }: { meal: LoggedMeal; onPress?: () => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.gutter}>
        <Text style={styles.gutterTime}>{formatTime(meal.time)}</Text>
        <Text style={styles.gutterSlot}>{meal.slot}</Text>
      </View>
      <View style={styles.dotCol}>
        <View style={styles.dotLogged} />
      </View>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${meal.name}, ${Math.round(meal.calories)} kcal`}
      >
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{meal.name}</Text>
          <Text style={styles.cardKcal}>{Math.round(meal.calories)}</Text>
        </View>
        <Text style={styles.cardSubtitle}>
          P {Math.round(meal.proteinG)} · C {Math.round(meal.carbsG)} · F {Math.round(meal.fatG)}
        </Text>
      </Pressable>
    </View>
  );
}

function GhostSlotRow({ slot, onPress }: { slot: GhostSlot; onPress?: () => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.gutter}>
        <Text style={styles.gutterTime}>{formatTime(slot.time)}</Text>
        <Text style={styles.gutterSlot}>{slot.slot}</Text>
      </View>
      <View style={styles.dotCol}>
        <View style={styles.dotGhost} />
      </View>
      <Pressable
        style={[styles.card, styles.cardGhost]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Suggested ${slot.slot.toLowerCase()}: ${slot.suggestedName}`}
      >
        <View style={styles.cardTopRow}>
          <Text style={styles.cardEyebrow}>SUGGESTED</Text>
          <Text style={styles.cardSuggestedKcal}>~{slot.budgetKcal} kcal</Text>
        </View>
        <Text style={[styles.cardTitle, styles.cardTitleGhost]} numberOfLines={2}>
          {slot.suggestedName}
        </Text>
      </Pressable>
    </View>
  );
}

export function DayTimeline({ meals, ghosts, onMealPress, onGhostPress }: Props) {
  const items: Array<{ kind: 'meal'; data: LoggedMeal } | { kind: 'ghost'; data: GhostSlot }> = [
    ...meals.map((m) => ({ kind: 'meal' as const, data: m })),
    ...ghosts.map((g) => ({ kind: 'ghost' as const, data: g })),
  ];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Vertical spine — one element behind every dot. */}
      <View style={styles.spine} pointerEvents="none" />

      {items.map((it) =>
        it.kind === 'meal' ? (
          <MealRow key={it.data.id} meal={it.data} onPress={() => onMealPress?.(it.data)} />
        ) : (
          <GhostSlotRow key={it.data.id} slot={it.data} onPress={() => onGhostPress?.(it.data)} />
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 90, position: 'relative' },
  spine: {
    position: 'absolute',
    left: 14 + 40 + 4, // screen H-padding + gutter + a couple px to center under the dot
    top: 16,
    bottom: 8,
    width: 1,
    backgroundColor: colors.border,
  },
  row: { flexDirection: 'row', marginTop: 7, marginBottom: 7 },
  gutter: { width: 40, paddingTop: 4 },
  gutterTime: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.foreground, fontVariant: ['tabular-nums'] },
  gutterSlot: { fontSize: 8.5, color: colors.mutedForeground, letterSpacing: 0.6, marginTop: 2 },
  dotCol: { width: 18, alignItems: 'center', paddingTop: 8 },
  dotLogged: {
    width: 12, height: 12, borderRadius: 999,
    backgroundColor: '#09090b',
    borderWidth: 3, borderColor: colors.muted,
  },
  dotGhost: {
    width: 12, height: 12, borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1.5, borderColor: colors.mutedForeground,
    borderStyle: 'dashed',
  },
  card: {
    flex: 1,
    marginLeft: 6,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.card,
  },
  cardPressed: { backgroundColor: '#fafafa' },
  cardGhost: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: fontWeight.bold, color: colors.foreground, marginRight: 8 },
  cardTitleGhost: { fontWeight: fontWeight.semibold, marginTop: 4 },
  cardKcal: { fontSize: 13, fontWeight: fontWeight.bold, color: colors.foreground, fontVariant: ['tabular-nums'] },
  cardEyebrow: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 1 },
  cardSuggestedKcal: { fontSize: 10.5, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  cardSubtitle: {
    fontSize: 10.5, color: colors.mutedForeground, marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
});
