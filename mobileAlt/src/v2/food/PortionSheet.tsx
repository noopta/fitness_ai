// Portion sheet (handoff Nov 2026): scan → adjust how much you had → log. `grams`
// is the only state that matters; a unit re-expresses it, totals follow it and are
// never edited. Rebuilt from design_handoff_barcode_portion_sheet with the v2 tokens
// and the same sheet + keyboard pattern as ReviewSheet.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useQuery } from '@tanstack/react-query';
import {
  amountIn, dayImpact, fmtAmount, fmtBarcode, foundText, gramsFrom, labelColumns, microRows, parseAmount, portionLogBody, portionText,
  quickPicks, rulerFor, rulerMarks, scalePortion, secondaryAmount, unitOf,
  type DayNumbers, type FoodBasis, type MicroTarget, type PortionTotals, type PortionUnitKey,
} from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { haptics } from '../haptics';
import { Pressable } from '../primitives/Pressable';
import { TextAction } from '../primitives/TextAction';
import { ReceiptList } from '../primitives/Receipt';
import { nutritionApi } from '../../lib/api';
import { todayStr } from '../../lib/localDate';
import { useMeals } from '../data';
import { KEYBOARD_DONE_ID } from '../../components/ui/KeyboardDoneBar';
import { PortionRuler } from './PortionRuler';

const C = v2.color;
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type PortionSlot = typeof SLOTS[number];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TWEEN_MS = 260;
const easeOut = Easing.out(Easing.cubic);

export interface PortionLogged { mealId: string | null; grams: number; unit: PortionUnitKey; totals: PortionTotals; day: DayNumbers }

export function PortionSheet({ basis, grams: startGrams, unit: startUnit = 'g', slot, onSlot, onClose, onLogged }: {
  basis: FoodBasis;
  grams: number;
  unit?: PortionUnitKey;
  slot: PortionSlot;
  onSlot: (s: PortionSlot) => void;
  /** Hands back the amount, so Review reopens where they left it. */
  onClose: (at: { grams: number; unit: PortionUnitKey }) => void;
  onLogged: (r: PortionLogged) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [grams, setGrams] = useState(startGrams);
  const [unitKey, setUnitKey] = useState<PortionUnitKey>(startUnit);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [allMicros, setAllMicros] = useState(false);
  const [per100, setPer100] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const meals = useMeals();
  const micros = useQuery({ queryKey: ['v2', 'np', 'micros', 'today'], staleTime: 60_000, queryFn: () => nutritionApi.getMicrosDaily() as Promise<any> });

  const unit = unitOf(basis, unitKey);
  const amount = amountIn(grams, unit);
  const ruler = useMemo(() => rulerFor(basis, unitKey), [basis, unitKey]);
  const marks = useMemo(() => rulerMarks(basis, unit, ruler), [basis, unit, ruler]);
  const picks = useMemo(() => quickPicks(basis), [basis]);
  const totals = useMemo(() => scalePortion(basis, grams), [basis, grams]);

  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const targets = meals.data?.targets ?? meals.data?.plan ?? null;
  const day: DayNumbers = useMemo(() => ({
    targetKcal: targets?.calories ?? null,
    targetProtein: targets?.proteinG ?? null,
    eatenKcal: rows.reduce((a, m) => a + (Number(m.calories) || 0), 0),
    eatenProtein: rows.reduce((a, m) => a + (Number(m.proteinG) || 0), 0),
  }), [rows, targets]);
  const impact = dayImpact(day, totals);
  const micro = useMemo(() => microRows(totals.nutrients, (micros.data?.nutrients ?? []) as MicroTarget[], allMicros), [totals, micros.data, allMicros]);
  const label = useMemo(() => labelColumns(basis, per100), [basis, per100]);

  // Keyboard: the action bar rides 12 pt above it; otherwise above the home indicator.
  const { height: kb } = useReanimatedKeyboardAnimation();
  const base = insets.bottom + 20;
  const actionPad = useAnimatedStyle(() => ({ paddingBottom: Math.max(base, -kb.value + 12) }));

  const close = () => onClose({ grams, unit: unitKey });
  const startTyping = () => { if (typing) return; setDraft(fmtAmount(amount, unitKey)); setTyping(true); };
  const commit = () => {
    const g = parseAmount(draft, unit);
    if (g != null) setGrams(g);
    setTyping(false);
  };

  const log = async () => {
    if (busy || grams <= 0) return;
    setBusy(true); setFailed(false);
    try {
      const m: any = await nutritionApi.logMeal(portionLogBody(basis, grams, unitKey, slot, todayStr()) as any);
      haptics.success();
      onLogged({ mealId: m?.id ?? null, grams, unit: unitKey, totals, day });
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const enter = reduced ? FadeIn.duration(150) : SlideInDown.duration(v2.motion.enter).easing(v2.motion.easeEnter);
  const exit = reduced ? FadeOut.duration(150) : SlideOutDown.duration(v2.motion.exit);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(reduced ? 150 : 200)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, { backgroundColor: C.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={enter} exiting={exit} style={[styles.sheet, { height: H * 0.91 }]}>
        <View style={styles.grabber} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.meta}>
            <Text style={[T.caption, { flexShrink: 1 }]} numberOfLines={1}>{`Scanned · ${fmtBarcode(basis.barcode)}`}</Text>
            <Pressable onPress={() => { haptics.select(); setPicking((v) => !v); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Meal: ${slot}. Change`}>
              <Text style={[T.captionStrong, { color: C.ink }]}>{cap(slot)} ▾</Text>
            </Pressable>
          </View>
          {picking ? (
            <View style={styles.slots}>
              {SLOTS.map((s) => (
                <Pressable key={s} onPress={() => { haptics.select(); onSlot(s); setPicking(false); }} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: s === slot }}>
                  <Text style={[T.captionStrong, { color: s === slot ? C.ink : C.muted }]}>{cap(s)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.title}>{basis.name}</Text>
          {basis.brand ? <Text style={[T.caption, { marginTop: 2 }]}>{basis.brand}</Text> : null}

          <View style={styles.heroRow}>
            <View style={styles.heroLeft}>
              {typing ? (
                <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID} autoFocus value={draft}
                  onChangeText={(t) => setDraft(t.replace(/[^0-9.,]/g, ''))} onBlur={commit} onSubmitEditing={commit}
                  keyboardType="decimal-pad" returnKeyType="done" selectTextOnFocus cursorColor={C.crimson} selectionColor={C.crimson}
                  style={[styles.hero, styles.heroInput]} accessibilityLabel={`Amount in ${unit.label}`} />
              ) : (
                <Pressable onPress={startTyping} accessibilityRole="button" accessibilityLabel={`${portionText(grams, unit, basis.servingWord)}. Tap to type`}>
                  <Text style={[styles.hero, styles.heroDotted]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmtAmount(amount, unitKey)}</Text>
                </Pressable>
              )}
              <Text style={styles.heroUnit} numberOfLines={1}>{unit.label}</Text>
            </View>
            <Text style={styles.secondary}>{secondaryAmount(grams, basis, unitKey)}</Text>
          </View>

          <View style={styles.tabs}>
            {basis.units.map((u) => {
              const on = u.key === unitKey;
              return (
                <Pressable key={u.key} onPress={() => { haptics.select(); setUnitKey(u.key); }} hitSlop={8} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <Text style={[styles.link, { color: on ? C.ink : C.muted, borderBottomColor: on ? C.ink : 'transparent' }]}>{u.tab}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: 14 }}>
            {/* A new scale is a new strip: remounting draws its ticks once and starts it at the value without a slide. */}
            <PortionRuler key={unitKey} config={ruler} value={amount} marks={marks} a11yValue={portionText(grams, unit, basis.servingWord)}
              onChange={(v) => setGrams(gramsFrom(v, unit))} />
          </View>

          <View style={styles.picks}>
            {picks.map((p) => {
              const on = Math.round(grams) === Math.round(p.grams);
              return (
                <Pressable key={p.label} onPress={() => { haptics.select(); setGrams(p.grams); }} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.link, { color: on ? C.ink : C.muted, borderBottomColor: on ? C.ink : 'transparent' }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.totals}>
            <Total value={totals.kcal} label="kcal" color={C.ink} reduced={reduced} />
            <Total value={totals.proteinG} label="protein" color={C.macro.protein} reduced={reduced} />
            <Total value={totals.carbsG} label="carbs" color={C.macro.carbs} reduced={reduced} />
            <Total value={totals.fatG} label="fat" color={C.macro.fat} reduced={reduced} />
          </View>

          {impact ? (
            <>
              <View style={styles.dayTrack}>
                <View style={[styles.dayEaten, { width: `${impact.eatenFrac * 100}%` }]} />
                <PortionSegment left={impact.eatenFrac * 100} width={impact.portionFrac * 100} reduced={reduced} />
              </View>
              <Text style={[T.bodyMuted, { marginTop: 12 }]}>
                {impact.over ? (
                  <>Puts you <Text style={styles.bold}>{impact.kcal.toLocaleString()} kcal</Text> over today’s target.</>
                ) : (
                  <>Leaves <Text style={styles.bold}>{impact.kcal.toLocaleString()} kcal</Text>{impact.proteinLeft != null ? <> and <Text style={styles.bold}>{impact.proteinLeft} g protein</Text></> : null} for the rest of today.</>
                )}
              </Text>
            </>
          ) : null}

          {micro.total ? (
            <View style={{ marginTop: 28 }}>
              <View style={styles.microHead}>
                <Text style={T.eyebrow}>Of today’s targets</Text>
                {basis.fromLabel ? (
                  <Text style={styles.estimated}>from the label</Text>
                ) : (
                  <Pressable onPress={() => Alert.alert('Estimated', 'These come from a food database rather than this label, so they can be off.')} hitSlop={10} accessibilityRole="button" accessibilityLabel="About these estimates">
                    <Text style={styles.estimated}>estimated ⓘ</Text>
                  </Pressable>
                )}
              </View>
              {micro.rows.map((m) => (
                <View key={m.key} style={styles.microRow}>
                  <Text style={styles.microName} numberOfLines={1}>{m.label}</Text>
                  <View style={styles.microTrack}>
                    <MicroFill pct={m.pct} color={m.focus ? C.crimson : m.limit ? C.placeholder : C.ink} reduced={reduced} />
                  </View>
                  <Text style={styles.microAmount} numberOfLines={1}>{m.amount}</Text>
                  <Text style={styles.microPct}>{m.pct}%</Text>
                </View>
              ))}
              {micro.focus ? <Text style={[T.caption, { marginTop: 10 }]}>{`This covers ${micro.focus.pct}% of today’s ${micro.focus.label.toLowerCase()} — your plan’s focus.`}</Text> : null}
              {micro.total > micro.rows.length || allMicros ? (
                <Pressable onPress={() => { haptics.select(); setAllMicros((v) => !v); }} hitSlop={8} accessibilityRole="button" style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                  <Text style={[T.captionStrong, { color: C.ink }]}>{allMicros ? 'Fewer' : `All ${micro.total} nutrients →`}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: 28 }}>
            <View style={styles.microHead}>
              <Text style={[T.eyebrow, { flexShrink: 1 }]} numberOfLines={1}>{label.heading}</Text>
              {label.toggle ? (
                <Pressable onPress={() => { haptics.select(); setPer100((v) => !v); }} hitSlop={8} accessibilityRole="button">
                  <Text style={T.captionStrong}>{label.toggle}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.labelRow}>
              {label.values.map((v) => (
                <View key={v.label} style={{ flex: 1 }}>
                  <Text style={styles.labelValue}>{v.value}</Text>
                  <Text style={styles.labelName}>{v.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={{ marginTop: 22 }}>
            <ReceiptList animate={false} items={[{ verb: 'Read', text: `Barcode ${fmtBarcode(basis.barcode)}` }, { verb: 'Found', text: foundText(basis) }]} />
          </View>
        </ScrollView>

        {failed ? <Text style={[T.caption, styles.failed]}>Couldn’t log — try again</Text> : null}
        <Animated.View style={[styles.actions, actionPad]}>
          <TextAction primary loading={busy} disabled={grams <= 0} onPress={() => void log()}>{`Log ${portionText(grams, unit, basis.servingWord)}`}</TextAction>
          <TextAction muted arrow={false} size={15} onPress={close}>Cancel</TextAction>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** A total counting to its new value. Each owns its tween, so only these Texts repaint. */
function Total({ value, label, color, reduced }: { value: number; label: string; color: string; reduced: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced) { from.current = value; setShown(value); return; }
    const t0 = Date.now(), a = from.current;
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / TWEEN_MS);
      const cur = a + (value - a) * (1 - Math.pow(1 - k, 3));
      from.current = cur;
      setShown(cur);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.totalValue, { color }]} numberOfLines={1}>{Math.round(shown).toLocaleString()}</Text>
      <Text style={T.caption}>{label}</Text>
    </View>
  );
}

function PortionSegment({ left, width, reduced }: { left: number; width: number; reduced: boolean }) {
  const w = useSharedValue(width);
  useEffect(() => { w.value = reduced ? width : withTiming(width, { duration: TWEEN_MS, easing: easeOut }); }, [width, reduced, w]);
  const s = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return <Animated.View style={[styles.daySegment, { left: `${left}%` }, s]} />;
}

function MicroFill({ pct, color, reduced }: { pct: number; color: string; reduced: boolean }) {
  const target = Math.min(100, pct);
  const w = useSharedValue(target);
  useEffect(() => { w.value = reduced ? target : withTiming(target, { duration: TWEEN_MS, easing: easeOut }); }, [target, reduced, w]);
  const s = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return <Animated.View style={[styles.microFill, { backgroundColor: color }, s]} />;
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.white, borderTopLeftRadius: v2.radius.sheet, borderTopRightRadius: v2.radius.sheet, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.hairline, marginTop: 10 },
  body: { paddingHorizontal: v2.space.gutter, paddingTop: 16, paddingBottom: 24 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  slots: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 10 },
  title: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48, color: C.ink, marginTop: 12 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 24 },
  heroLeft: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1 },
  hero: { fontFamily: v2.font.bold, fontSize: 64, lineHeight: 64, letterSpacing: -2.56, color: C.ink, fontVariant: ['tabular-nums'], padding: 0 },
  heroDotted: { borderBottomWidth: 1, borderBottomColor: C.placeholder, borderStyle: 'dotted' },
  heroInput: { minWidth: 120, maxWidth: 190, borderBottomWidth: 1, borderBottomColor: C.ink },
  heroUnit: { fontFamily: v2.font.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48, color: C.muted, marginLeft: 8, flexShrink: 1 },
  secondary: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 19.5, color: C.muted, paddingBottom: 6, fontVariant: ['tabular-nums'] },
  tabs: { flexDirection: 'row', gap: 18, marginTop: 14 },
  link: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 19.5, paddingBottom: 3, borderBottomWidth: 1.5 },
  picks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8, marginTop: 12 },
  totals: { flexDirection: 'row', gap: 12, marginTop: 28 },
  totalValue: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  dayTrack: { height: 2, backgroundColor: C.surface, marginTop: 18 },
  dayEaten: { position: 'absolute', left: 0, top: 0, height: 2, backgroundColor: C.ink },
  daySegment: { position: 'absolute', top: -2, height: 6, backgroundColor: C.placeholder },
  bold: { fontFamily: v2.font.semibold, color: C.ink, fontVariant: ['tabular-nums'] },
  microHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  estimated: { fontFamily: v2.font.regular, fontSize: 11, lineHeight: 14, color: C.placeholder },
  microRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 30 },
  microName: { width: 96, fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18, color: C.ink },
  microTrack: { flex: 1, height: 2, backgroundColor: C.surface },
  microFill: { height: 2 },
  microAmount: { width: 58, textAlign: 'right', fontFamily: v2.font.regular, fontSize: 12, lineHeight: 18, color: C.muted, fontVariant: ['tabular-nums'] },
  microPct: { width: 38, textAlign: 'right', fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18, color: C.ink, fontVariant: ['tabular-nums'] },
  labelRow: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.hairline },
  labelValue: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.ink, fontVariant: ['tabular-nums'] },
  labelName: { fontFamily: v2.font.regular, fontSize: 12, lineHeight: 16, color: C.muted },
  failed: { paddingHorizontal: v2.space.gutter, paddingBottom: 8, backgroundColor: C.white },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: v2.space.gutter, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.hairline, backgroundColor: C.white },
});
