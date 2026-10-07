// Enter macros manually (bug fixes 5 Oct 2026, 4c) — the fallback, never the
// default. A name, then four rows: Calories (required) and protein, carbs,
// fat (optional, in their hue), each a right-aligned 22/700 number on the
// number pad. Log it → turns crimson as soon as calories > 0; until then it's
// muted text — never a disabled filled button. The action row rides 12 pt
// above the keyboard.

import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import { Pressable } from '../primitives/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { mealSlotFor } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { haptics } from '../haptics';
import { TextAction } from '../primitives/TextAction';
import { nutritionApi } from '../../lib/api';
import { todayStr } from '../../lib/localDate';

const C = v2.color;
type Field = 'calories' | 'proteinG' | 'carbsG' | 'fatG';
const ROWS: { key: Field; label: string; unit: string; color: string }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: C.ink },
  { key: 'proteinG', label: 'Protein', unit: 'g', color: C.macro.protein },
  { key: 'carbsG', label: 'Carbs', unit: 'g', color: C.macro.carbs },
  { key: 'fatG', label: 'Fat', unit: 'g', color: C.macro.fat },
];

export function ManualSheet({ initialName = '', onClose, onLogged }: { initialName?: string; onClose: () => void; onLogged: (mealId: string | null) => void }) {
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const [name, setName] = useState(initialName);
  const [vals, setVals] = useState<Record<Field, string>>({ calories: '', proteinG: '', carbsG: '', fatG: '' });
  const [busy, setBusy] = useState(false);
  const n = (k: Field) => { const x = parseFloat(vals[k].replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : 0; };
  const ready = n('calories') > 0;

  const { height: kb } = useReanimatedKeyboardAnimation();
  const base = Math.max(insets.bottom, 12);
  const actionPad = useAnimatedStyle(() => ({ paddingBottom: Math.max(base, -kb.value + 12) }));

  const log = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const m: any = await nutritionApi.logMeal({
        date: todayStr(), mealType: mealSlotFor(), name: name.trim() || 'Meal',
        calories: Math.round(n('calories')), proteinG: Math.round(n('proteinG')), carbsG: Math.round(n('carbsG')), fatG: Math.round(n('fatG')),
        source: 'manual',
      });
      haptics.success();
      onLogged(m?.id ?? null);
    } catch (e: any) { Alert.alert('Couldn’t log', e?.message ?? ''); }
    setBusy(false);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, { backgroundColor: C.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={SlideInDown.duration(v2.motion.enter).easing(v2.motion.easeEnter)} exiting={SlideOutDown.duration(v2.motion.exit)} style={[styles.sheet, { height: H * 0.9 }]}>
        <View style={styles.grabber} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={T.caption}>Enter macros manually</Text>
          <TextInput value={name} onChangeText={setName} placeholder="What was it?" placeholderTextColor={C.placeholder} autoFocus={!initialName}
            style={styles.name} returnKeyType="next" accessibilityLabel="Food name" />
          <View style={{ marginTop: 18 }}>
            {ROWS.map((r, i) => (
              <View key={r.key} style={[styles.row, i === ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
                <Text style={[T.row, { color: r.key === 'calories' ? C.ink : r.color }]}>{r.label}</Text>
                <View style={styles.valueWrap}>
                  <TextInput value={vals[r.key]} onChangeText={(v) => setVals((s) => ({ ...s, [r.key]: v.replace(/[^0-9.,]/g, '') }))}
                    keyboardType="number-pad" placeholder="0" placeholderTextColor={C.placeholder} autoFocus={!!initialName && r.key === 'calories'}
                    style={[styles.value, { color: r.color }]} accessibilityLabel={`${r.label} in ${r.unit}${r.key === 'calories' ? ', required' : ', optional'}`} />
                  <Text style={[T.caption, { width: 30 }]}>{r.unit}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={[T.caption, { marginTop: 12 }]}>Calories are enough to log. Add protein, carbs and fat if you know them.</Text>
        </ScrollView>
        <Animated.View style={[styles.actions, actionPad]}>
          {/* Muted until there's a calorie number; never a greyed-out filled button. */}
          <TextAction primary={ready} muted={!ready} loading={busy} onPress={() => void log()}>Log it</TextAction>
          <TextAction muted arrow={false} size={15} onPress={onClose}>Cancel</TextAction>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.white, borderTopLeftRadius: v2.radius.sheet, borderTopRightRadius: v2.radius.sheet, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.hairline, marginTop: 10 },
  body: { paddingHorizontal: v2.space.gutter, paddingTop: 16, paddingBottom: 24 },
  name: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 30, color: C.ink, marginTop: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.hairline },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 60, borderTopWidth: 1, borderTopColor: C.hairline },
  valueWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  value: { minWidth: 90, textAlign: 'right', fontFamily: v2.font.bold, fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'], paddingVertical: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: v2.space.gutter, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.hairline, backgroundColor: C.white },
});
