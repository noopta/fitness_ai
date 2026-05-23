// DayTimeline — primary scroll surface. Renders logged meals followed by
// ghost-slot suggestions for the rest of the day. Spec: handoff §06, §08, §09.
//
// Implementation notes
// - One absolutely-positioned vertical spine behind the dots — we don't paint
//   the line per-row, which keeps it crisp regardless of row height.
// - Each row is [time gutter · dot · payload card]. Logged dot is solid
//   zinc-950; ghost dot is a dashed ring on transparent.
// - 90 pt bottom-pad reserves space for the floating ActionDock.
// - Logged meals mount with a FadeInDown stagger (60ms per row, cap 360ms).
//   Reduced motion users get an instant mount.
// - Swipe-left on a logged meal reveals a Delete action. The handler is
//   surfaced via onDeleteMeal; the screen is responsible for the confirm
//   dialog so the timeline stays presentational.
// - Long-press on a logged meal calls onLongPressMeal — the screen owns
//   the action sheet.

import React from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import Animated, {
  FadeInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
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
  onDeleteMeal?: (m: LoggedMeal) => void;
  onLongPressMeal?: (m: LoggedMeal) => void;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

// Maximum delay we'll spend staggering rows on mount — cap at 6 rows ×
// 60ms = 360ms. Beyond that the cascade reads as slow rather than playful.
const STAGGER_CAP_INDEX = 6;

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

/** The action surface that slides in behind a swiped-left meal row. */
function DeleteAction() {
  return (
    <View style={styles.swipeAction}>
      <Ionicons name="trash-outline" size={18} color="#ffffff" />
      <Text style={styles.swipeActionText}>Delete</Text>
    </View>
  );
}

function MealRow({
  meal, index, onPress, onDelete, onLongPress, reducedMotion,
}: {
  meal: LoggedMeal;
  index: number;
  onPress?: () => void;
  onDelete?: () => void;
  onLongPress?: () => void;
  reducedMotion: boolean;
}) {
  const entering = reducedMotion
    ? undefined
    : FadeInDown.delay(Math.min(index, STAGGER_CAP_INDEX) * 60).duration(320);

  const card = (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
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
  );

  return (
    <Animated.View entering={entering} style={styles.row}>
      <View style={styles.gutter}>
        <Text style={styles.gutterTime}>{formatTime(meal.time)}</Text>
        <Text style={styles.gutterSlot}>{meal.slot}</Text>
      </View>
      <View style={styles.dotCol}>
        <View style={styles.dotLogged} />
      </View>
      <View style={styles.cardWrap}>
        {onDelete ? (
          <Swipeable
            friction={1.6}
            rightThreshold={48}
            overshootRight={false}
            renderRightActions={() => <DeleteAction />}
            onSwipeableOpen={(direction) => {
              if (direction === 'right') onDelete();
            }}
          >
            {card}
          </Swipeable>
        ) : (
          card
        )}
      </View>
    </Animated.View>
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

export function DayTimeline({
  meals, ghosts, onMealPress, onGhostPress, onDeleteMeal, onLongPressMeal, onScroll,
}: Props) {
  const reducedMotion = useReducedMotion();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      {/* Vertical spine — one element behind every dot. */}
      <View style={styles.spine} pointerEvents="none" />

      {meals.map((m, i) => (
        <MealRow
          key={m.id}
          meal={m}
          index={i}
          reducedMotion={reducedMotion}
          onPress={() => onMealPress?.(m)}
          onDelete={onDeleteMeal ? () => onDeleteMeal(m) : undefined}
          onLongPress={onLongPressMeal ? () => onLongPressMeal(m) : undefined}
        />
      ))}
      {ghosts.map((g) => (
        <GhostSlotRow key={g.id} slot={g} onPress={() => onGhostPress?.(g)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 90, position: 'relative' },
  spine: {
    position: 'absolute',
    left: 14 + 40 + 4,
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
  cardWrap: { flex: 1, marginLeft: 6, overflow: 'hidden', borderRadius: 12 },
  card: {
    flex: 1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.card,
  },
  cardPressed: { backgroundColor: '#fafafa' },
  cardGhost: { borderStyle: 'dashed', backgroundColor: 'transparent', marginLeft: 6 },
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

  // Swipe-to-delete action — slides in behind the card from the right.
  swipeAction: {
    backgroundColor: colors.destructive,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 6,
    borderRadius: 12,
    marginVertical: 0,
  },
  swipeActionText: {
    color: '#ffffff',
    fontWeight: fontWeight.bold,
    fontSize: 12,
  },
});
