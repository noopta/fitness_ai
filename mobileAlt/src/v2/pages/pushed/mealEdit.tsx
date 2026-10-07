// Edit a meal (design handoff N-04). Tap any logged meal: the name, the slot
// and the portion are edited in place, any number Anakin got wrong can be
// fixed, and Delete confirms by saying what comes off the day.
//
// Portions scale the whole meal (×¼ … ×3) — macros recompute from it. The
// handoff shows per-item portions ("Chicken 4 oz"); meals don't store per-item
// weights yet, so that waits on a server change. A meal from another day opens
// that day's list (chat's Logged card passes the date).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { v2, T } from '../../theme';
import { PushedPage } from '../../shell/Page';
import { Row, Eyebrow } from '../../primitives/Row';
import { Pressable } from '../../primitives/Pressable';
import { TextAction } from '../../primitives/TextAction';
import { PromptSheet } from '../../primitives/Sheet';
import { useMeals, useInvalidate } from '../../data';
import { useShellOptional } from '../../shell/ShellContext';
import { nutritionApi } from '../../../lib/api';
import { haptics } from '../../haptics';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type Slot = typeof SLOTS[number];
const PORTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
type MacroKey = 'calories' | 'proteinG' | 'carbsG' | 'fatG';
const MACROS: { key: MacroKey; label: string; unit: string; hue: string }[] = [
  { key: 'calories', label: 'kcal', unit: 'kcal', hue: v2.color.ink },
  { key: 'proteinG', label: 'protein', unit: 'g', hue: v2.color.macro.protein },
  { key: 'carbsG', label: 'carbs', unit: 'g', hue: v2.color.macro.carbs },
  { key: 'fatG', label: 'fat', unit: 'g', hue: v2.color.macro.fat },
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtPortion = (p: number) => (p === 0.25 ? '¼' : p === 0.5 ? '½' : p === 0.75 ? '¾' : p === 1.25 ? '1¼' : p === 1.5 ? '1½' : String(p));

export function MealEditPage({ id, date }: { id: string; date?: string }) {
  const router = useRouter();
  const meals = useMeals(date);
  const invalidate = useInvalidate();
  const shell = useShellOptional();
  const rows: any[] = meals.data?.meals ?? meals.data?.entries ?? (Array.isArray(meals.data) ? meals.data : []);
  const m = rows.find((x) => String(x.id) === id);

  // The draft: nothing is written until Save.
  const [name, setName] = useState('');
  const [slot, setSlot] = useState<Slot | 'meal'>('meal');
  const [portion, setPortion] = useState(1);
  const [fixed, setFixed] = useState<Partial<Record<MacroKey, number>>>({});
  const [editing, setEditing] = useState<null | 'name' | MacroKey>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!m) return;
    setName(m.name ?? m.description ?? 'Meal');
    setSlot((SLOTS as readonly string[]).includes(m.mealType) ? m.mealType : 'meal');
    setPortion(1); setFixed({});
  }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const values = useMemo(() => {
    const out = {} as Record<MacroKey, number>;
    for (const k of MACROS) out[k.key] = fixed[k.key] ?? Math.round((Number(m?.[k.key]) || 0) * portion);
    return out;
  }, [m, portion, fixed]);
  const dirty = !!m && (name.trim() !== (m.name ?? m.description ?? 'Meal') || slot !== (m.mealType ?? 'meal') || portion !== 1 || Object.keys(fixed).length > 0);

  const save = async () => {
    if (!m || !dirty || busy) return;
    setBusy(true);
    try {
      await nutritionApi.updateMeal(id, {
        ...(name.trim() && name.trim() !== m.name ? { name: name.trim() } : {}),
        ...(slot !== m.mealType ? { mealType: slot } : {}),
        ...(portion !== 1 || Object.keys(fixed).length ? values : {}),
      } as any);
      await invalidate.afterMeal();
      haptics.success();
      router.back();
    } catch (e: any) { Alert.alert('Couldn\'t save', e?.message ?? 'Try again.'); setBusy(false); }
  };
  const remove = () => {
    if (!m) return;
    Alert.alert(`Delete ${m.name ?? 'this meal'}?`, `${Math.round(m.calories ?? 0)} kcal and ${Math.round(m.proteinG ?? 0)} g protein come off ${date ? 'that day' : 'today'}. This can't be undone.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await nutritionApi.deleteMeal(id); await invalidate.afterMeal(); router.back(); }
        catch (e: any) { Alert.alert('Couldn\'t delete', e?.message ?? ''); }
      } },
    ]);
  };
  const stepPortion = (dir: 1 | -1) => {
    const i = PORTIONS.indexOf(portion);
    const next = PORTIONS[Math.max(0, Math.min(PORTIONS.length - 1, (i < 0 ? 3 : i) + dir))];
    setPortion(next); setFixed({}); haptics.select();
  };
  const fixValue = (v: string) => {
    const k = editing as MacroKey; const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    setFixed((f) => ({ ...f, [k]: Math.round(n) })); setEditing(null);
  };
  const ingredients: string[] = (() => { try { const j = m?.ingredientsJson ? JSON.parse(m.ingredientsJson) : m?.ingredients; return Array.isArray(j) ? j.map(String) : []; } catch { return []; } })();
  const time = m?.createdAt ? new Date(m.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <PushedPage back="Fuel" title={m ? '' : 'Meal'} loading={meals.isLoading}
      right={m ? <TextAction muted arrow={false} size={14} onPress={remove}>Delete</TextAction> : undefined}>
      {!m && !meals.isLoading ? <Text style={T.bodyMuted}>Couldn't find that meal — it may have been deleted.</Text> : null}
      {m ? (
        <View>
          <Pressable onPress={() => setEditing('name')} accessibilityRole="button" accessibilityLabel={`Name, ${name}. Edit`}>
            <Text style={styles.name} numberOfLines={2}>{name}</Text>
          </Pressable>

          <View style={styles.slots}>
            {SLOTS.map((s) => (
              <Pressable key={s} onPress={() => { haptics.select(); setSlot(s); }} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: slot === s }}>
                <Text style={[styles.slot, slot === s && styles.slotOn]}>{cap(s)}</Text>
              </Pressable>
            ))}
          </View>
          {time ? <Row name="Time" value={time} muted /> : null}

          <View style={{ marginTop: 22 }}><Eyebrow>Portion</Eyebrow></View>
          <View style={styles.stepRow}>
            <Text style={[T.body, { flex: 1 }]} numberOfLines={2}>{ingredients.length ? ingredients.slice(0, 4).join(', ') + (ingredients.length > 4 ? ` +${ingredients.length - 4}` : '') : 'Whole meal'}</Text>
            <Pressable onPress={() => stepPortion(-1)} hitSlop={10} accessibilityLabel="Smaller portion"><Text style={styles.step}>−</Text></Pressable>
            <Text style={styles.portion}>×{fmtPortion(portion)}</Text>
            <Pressable onPress={() => stepPortion(1)} hitSlop={10} accessibilityLabel="Bigger portion"><Text style={styles.step}>+</Text></Pressable>
          </View>

          <View style={styles.macros}>
            {MACROS.map((k) => (
              <Pressable key={k.key} onPress={() => setEditing(k.key)} accessibilityRole="button" accessibilityLabel={`${k.label} ${values[k.key]}. Fix`} style={{ flex: 1 }}>
                <Text style={[styles.macroValue, { color: k.hue }]}>{values[k.key]}</Text>
                <Text style={T.caption}>{k.label}{fixed[k.key] != null ? ' · fixed' : ''}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[T.caption, { marginTop: 8 }]}>Tap a number to fix it.</Text>

          <View style={styles.actions}>
            <TextAction primary onPress={() => void save()} loading={busy} disabled={!dirty}>Save</TextAction>
            <TextAction muted arrow={false} onPress={() => { shell?.ask(`Save "${m.name ?? m.description}" as a recipe`); router.replace('/(v2)' as any); }}>Save as recipe</TextAction>
          </View>

          <PromptSheet visible={editing === 'name'} title="Name" initial={name} onSubmit={(v) => { setName(v); setEditing(null); }} onClose={() => setEditing(null)} />
          <PromptSheet visible={!!editing && editing !== 'name'} title={`Fix ${MACROS.find((k) => k.key === editing)?.label ?? ''}`}
            sub={editing && editing !== 'name' ? `Anakin read ${Math.round(Number(m?.[editing]) || 0)}.` : undefined}
            initial={editing && editing !== 'name' ? String(values[editing]) : ''} keyboardType="decimal-pad"
            unit={MACROS.find((k) => k.key === editing)?.unit} onSubmit={fixValue} onClose={() => setEditing(null)} />
        </View>
      ) : null}
    </PushedPage>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: v2.font.bold, fontSize: 28, lineHeight: 33, letterSpacing: -0.6, color: v2.color.ink, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: v2.color.ink },
  slots: { flexDirection: 'row', gap: 18, marginTop: 14, marginBottom: 6 },
  slot: { fontFamily: v2.font.medium, fontSize: 14, color: v2.color.muted, paddingBottom: 3 },
  slotOn: { color: v2.color.ink, borderBottomWidth: 1.5, borderBottomColor: v2.color.ink },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: v2.color.hairline },
  step: { fontFamily: v2.font.semibold, fontSize: 22, color: v2.color.ink, paddingHorizontal: 4 },
  portion: { fontFamily: v2.font.semibold, fontSize: 17, color: v2.color.ink, minWidth: 36, textAlign: 'center', fontVariant: ['tabular-nums'] },
  macros: { flexDirection: 'row', gap: 12, marginTop: 22 },
  macroValue: { fontFamily: v2.font.bold, fontSize: 24, lineHeight: 28, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 30 },
});
