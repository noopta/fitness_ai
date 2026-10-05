// Food review sheet (bug fixes 5 Oct 2026, 4b). A bottom sheet, 28 pt top
// radius, ~90% of the height, over the search page.
//
//   meta    source · slot picker ("Lunch ▾", defaults from the time of day)
//   title   24/700
//   rows    ingredient + portion stepper (− value +; the dotted value types)
//   totals  4 columns, 24/700 — kcal ink, macros in hue — computed, never edited
//   line    "Leaves 868 kcal and 34 g protein for the rest of today."
//   micros  "Of today's targets": 5 most relevant, 96 pt name + 2 pt line + %;
//           the plan's focus nutrient in crimson with one sentence.
//   actions Log it → (crimson text) · Save as recipe
//
// The action row rides 12 pt above the keyboard; the content scrolls in what
// is left (react-native-keyboard-controller).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useQuery } from '@tanstack/react-query';
import {
  portionFrom, portionMacros, portionTotals, portionMealNutrients, stepPortion, setPortionAmount, portionLabel,
  relevantMicros, mealSlotFor, type Portioned,
} from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { haptics } from '../haptics';
import { TextAction } from '../primitives/TextAction';
import { nutritionApi } from '../../lib/api';
import { todayStr } from '../../lib/localDate';
import { useMeals } from '../data';
import type { FoodResult } from '../api';

const C = v2.color;
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type Slot = typeof SLOTS[number];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ReviewSheet({ result, onClose, onLogged }: { result: FoodResult; onClose: () => void; onLogged: (mealId: string | null) => void }) {
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const [items, setItems] = useState<Portioned[]>(() => [portionFrom(result)]);
  const [slot, setSlot] = useState<Slot>(mealSlotFor());
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedRecipe, setSavedRecipe] = useState(false);
  useEffect(() => { setItems([portionFrom(result)]); setSavedRecipe(false); }, [result]);

  const meals = useMeals();
  const micros = useQuery({ queryKey: ['v2', 'np', 'micros', 'today'], staleTime: 60_000, queryFn: () => nutritionApi.getMicrosDaily() as Promise<any> });

  const t = portionTotals(items);
  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const targets = meals.data?.targets ?? meals.data?.plan ?? null;
  const eaten = rows.reduce((a, m) => ({ kcal: a.kcal + (Number(m.calories) || 0), p: a.p + (Number(m.proteinG) || 0) }), { kcal: 0, p: 0 });
  const leaves = targets?.calories ? { kcal: Math.round(targets.calories - eaten.kcal - t.calories), p: Math.round((targets.proteinG ?? 0) - eaten.p - t.proteinG) } : null;

  const mealN = useMemo(() => portionMealNutrients(items), [items]);
  const micro = useMemo(() => relevantMicros(mealN, micros.data?.nutrients ?? []), [mealN, micros.data]);
  const focusRow = micro.find((m) => m.focus);

  // Keyboard: the action row sits 12 pt above it; otherwise above the home indicator.
  const { height: kb } = useReanimatedKeyboardAnimation();
  const base = Math.max(insets.bottom, 12);
  const actionPad = useAnimatedStyle(() => ({ paddingBottom: Math.max(base, -kb.value + 12) }));

  const log = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const date = todayStr();
      let m: any;
      const one = items[0];
      if (result.kind === 'recipe' && items.length === 1) {
        m = await nutritionApi.logRecipe(result.id, { date, mealType: slot, servings: one.amount });
      } else {
        m = await nutritionApi.logMeal({
          date, mealType: slot, name: items.length === 1 ? result.name : items.map((i) => i.name).join(', ').slice(0, 200),
          calories: t.calories, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG,
          source: result.kind === 'mine' ? 'saved_food' : 'manual',
          ...(Object.keys(mealN).length ? { nutrients: mealN } : {}),
          ingredients: items.map((i) => `${i.name} (${portionLabel(i)})`),
          ingredientNutrients: items.map((i) => ({ name: `${i.name} (${portionLabel(i)})`, nutrients: { ...portionMacros(i) } })),
        });
      }
      haptics.success();
      onLogged(m?.id ?? null);
    } catch (e: any) { Alert.alert('Couldn’t log', e?.message ?? ''); }
    setBusy(false);
  };

  const saveRecipe = async () => {
    if (busy || savedRecipe) return;
    try {
      await nutritionApi.createRecipe({
        name: result.name, servings: 1,
        items: items.map((i) => ({ name: i.name, quantity: portionLabel(i), ...portionMacros(i) })),
        ...(Object.keys(mealN).length ? { nutrients: mealN } : {}),
      });
      haptics.success(); setSavedRecipe(true);
    } catch (e: any) { Alert.alert('Couldn’t save', e?.message ?? ''); }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, { backgroundColor: C.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={SlideInDown.duration(v2.motion.enter).easing(v2.motion.easeEnter)} exiting={SlideOutDown.duration(v2.motion.exit)} style={[styles.sheet, { height: H * 0.9 }]}>
        <View style={styles.grabber} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.meta}>
            <Text style={T.caption} numberOfLines={1}>{result.caption}</Text>
            <Pressable onPress={() => { haptics.select(); setPicking((v) => !v); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Meal: ${slot}. Change`}>
              <Text style={[T.captionStrong, { color: C.ink }]}>{cap(slot)} ▾</Text>
            </Pressable>
          </View>
          {picking ? (
            <View style={styles.slots}>
              {SLOTS.map((s) => (
                <Pressable key={s} onPress={() => { haptics.select(); setSlot(s); setPicking(false); }} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: s === slot }}>
                  <Text style={[T.captionStrong, { color: s === slot ? C.ink : C.muted }]}>{cap(s)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.title}>{result.name}</Text>

          <View style={{ marginTop: 18 }}>
            {items.map((it, i) => (
              <PortionRow key={it.key} item={it} last={i === items.length - 1}
                onStep={(d) => { haptics.select(); setItems((xs) => xs.map((x, k) => (k === i ? stepPortion(x, d) : x))); }}
                onType={(v) => setItems((xs) => xs.map((x, k) => (k === i ? setPortionAmount(x, v) : x)))} />
            ))}
          </View>

          <View style={styles.totals}>
            <Total value={t.calories} label="kcal" color={C.ink} />
            <Total value={t.proteinG} label="protein" color={C.macro.protein} />
            <Total value={t.carbsG} label="carbs" color={C.macro.carbs} />
            <Total value={t.fatG} label="fat" color={C.macro.fat} />
          </View>
          {leaves ? (
            <Text style={[T.bodyMuted, { marginTop: 14 }]}>
              {leaves.kcal >= 0
                ? `Leaves ${leaves.kcal.toLocaleString()} kcal${leaves.p > 0 ? ` and ${leaves.p} g protein` : ''} for the rest of today.`
                : `Puts you ${Math.abs(leaves.kcal).toLocaleString()} kcal over today’s target.`}
            </Text>
          ) : null}

          {micro.length ? (
            <View style={{ marginTop: 28 }}>
              <View style={styles.microHead}>
                <Text style={T.eyebrow}>Of today’s targets</Text>
                <Pressable onPress={() => Alert.alert('Estimated', 'Micronutrients are estimates from the food database and carry about ±30% uncertainty.')} hitSlop={10} accessibilityRole="button" accessibilityLabel="About these estimates">
                  <Text style={styles.estimated}>estimated ⓘ</Text>
                </Pressable>
              </View>
              {micro.map((m) => (
                <View key={m.key} style={styles.microRow}>
                  <Text style={styles.microName} numberOfLines={1}>{m.label}</Text>
                  <View style={styles.microTrack}>
                    <View style={[styles.microFill, { width: `${Math.min(100, m.pct)}%`, backgroundColor: m.focus ? C.crimson : C.ink }]} />
                  </View>
                  <Text style={styles.microPct}>{m.pct}%</Text>
                </View>
              ))}
              {focusRow ? <Text style={[T.caption, { marginTop: 10 }]}>{`This meal covers ${focusRow.pct}% of today’s ${focusRow.label.toLowerCase()} — your plan’s focus.`}</Text> : null}
            </View>
          ) : null}
        </ScrollView>

        <Animated.View style={[styles.actions, actionPad]}>
          <TextAction primary loading={busy} onPress={() => void log()}>Log it</TextAction>
          <TextAction muted arrow={false} size={15} onPress={() => void saveRecipe()}>{savedRecipe ? 'Saved as recipe' : 'Save as recipe'}</TextAction>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** name · − value + ; the value has a dotted underline and types on tap. */
function PortionRow({ item, last, onStep, onType }: { item: Portioned; last: boolean; onStep: (d: 1 | -1) => void; onType: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const m = portionMacros(item);
  return (
    <View style={[styles.portion, last && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.rowStrong} numberOfLines={1}>{item.name}</Text>
        <Text style={[T.caption, { marginTop: 2 }]}>{m.calories} kcal</Text>
      </View>
      <View style={styles.stepper}>
        <Pressable onPress={() => onStep(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Less"><Text style={styles.stepBtn}>−</Text></Pressable>
        {editing ? (
          <TextInput autoFocus value={draft} onChangeText={setDraft} keyboardType="decimal-pad" returnKeyType="done" selectTextOnFocus
            onBlur={() => { onType(draft); setEditing(false); }} onSubmitEditing={() => { onType(draft); setEditing(false); }}
            style={[styles.stepValue, styles.dotted, { minWidth: 64 }]} accessibilityLabel={`Amount in ${item.unit === 'g' ? 'grams' : 'servings'}`} />
        ) : (
          <Pressable onPress={() => { setDraft(String(item.amount)); setEditing(true); }} accessibilityRole="button" accessibilityLabel={`${portionLabel(item)}. Tap to type`}>
            <Text style={[styles.stepValue, styles.dotted]}>{portionLabel(item)}</Text>
          </Pressable>
        )}
        <Pressable onPress={() => onStep(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="More"><Text style={styles.stepBtn}>+</Text></Pressable>
      </View>
    </View>
  );
}

function Total({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.totalValue, { color }]}>{Math.round(value).toLocaleString()}</Text>
      <Text style={T.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.white, borderTopLeftRadius: v2.radius.sheet, borderTopRightRadius: v2.radius.sheet, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.hairline, marginTop: 10 },
  body: { paddingHorizontal: v2.space.gutter, paddingTop: 16, paddingBottom: 24 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  slots: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 10 },
  title: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48, color: C.ink, marginTop: 12 },
  portion: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 60, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.hairline },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { fontFamily: v2.font.medium, fontSize: 22, lineHeight: 26, color: C.ink, paddingHorizontal: 4 },
  stepValue: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'], paddingVertical: 2 },
  dotted: { borderBottomWidth: 1, borderBottomColor: C.muted, borderStyle: 'dotted' },
  totals: { flexDirection: 'row', gap: 12, marginTop: 22 },
  totalValue: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  microHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  estimated: { fontFamily: v2.font.regular, fontSize: 11, lineHeight: 14, color: C.placeholder },
  microRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 30 },
  microName: { width: 96, fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18, color: C.ink },
  microTrack: { flex: 1, height: 2, backgroundColor: C.surface },
  microFill: { height: 2 },
  microPct: { width: 44, textAlign: 'right', fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18, color: C.ink, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: v2.space.gutter, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.hairline, backgroundColor: C.white },
});
