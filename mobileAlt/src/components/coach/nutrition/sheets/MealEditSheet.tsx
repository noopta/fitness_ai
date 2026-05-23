// MealEditSheet — edit a logged meal's portion, name, slot. Spec: handoff §10.
//
// Now uses the true PUT /nutrition/meals/:id endpoint, so edits keep the
// row's id, createdAt, and saved-food backlinks instead of churning a new
// row via delete-then-re-log.
//
// Portion scaling: the meal can be scaled by a 0.5-2.0× multiplier; macros
// scale linearly. The multiplier mode is the common case ("oh, that was
// actually a half portion"); for finer edits the user can type the macros
// directly.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { nutritionApi } from '../../../../lib/api';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import type { MealSlotApi } from './sheetHelpers';

export interface EditingMeal {
  id: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Optional — uppercase display slot from the timeline. */
  slot?: string;
}

interface Props {
  visible: boolean;
  meal: EditingMeal | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

const SLOTS: Array<{ key: MealSlotApi; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' },
];

const PORTION_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function inferSlot(display: string | undefined): MealSlotApi {
  switch ((display ?? '').toLowerCase()) {
    case 'breakfast': return 'breakfast';
    case 'lunch':     return 'lunch';
    case 'dinner':    return 'dinner';
    case 'snack':     return 'snack';
    case 'late':      return 'snack';
    default:          return 'meal';
  }
}

export function MealEditSheet({ visible, meal, onClose, onChanged }: Props) {
  // We track the *base* numbers (the meal as originally saved) plus a
  // portion multiplier. Display = base × multiplier. Manual edits update
  // the base and reset multiplier to 1.
  const [base, setBase] = useState<EditingMeal | null>(meal);
  const [portion, setPortion] = useState(1);
  const [slot, setSlot] = useState<MealSlotApi>(inferSlot(meal?.slot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the prop changes to a fresh meal.
  React.useEffect(() => {
    setBase(meal);
    setPortion(1);
    setSlot(inferSlot(meal?.slot));
    setError(null);
  }, [meal?.id]);

  if (!base) return null;

  const scaled = {
    name: base.name,
    calories: Math.round(base.calories * portion),
    proteinG: Math.round(base.proteinG * portion),
    carbsG:   Math.round(base.carbsG   * portion),
    fatG:     Math.round(base.fatG     * portion),
  };

  const updateBaseNum = (k: keyof Omit<EditingMeal, 'id' | 'name' | 'slot'>, v: string) => {
    const n = Number(v);
    setBase({ ...base, [k]: Number.isFinite(n) ? n : 0 });
    setPortion(1); // manual edit always represents a 1× new baseline
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await nutritionApi.updateMeal(base.id, {
        name: scaled.name,
        mealType: slot,
        calories: scaled.calories,
        proteinG: scaled.proteinG,
        carbsG: scaled.carbsG,
        fatG: scaled.fatG,
      });
      await Promise.resolve(onChanged());
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete meal?', `"${base.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await nutritionApi.deleteMeal(base.id);
            await Promise.resolve(onChanged());
            onClose();
          } catch (err: any) {
            setError(err?.message ?? 'Could not delete.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Edit meal"
      subtitle="Adjust portion, fix items, or move to a different slot."
      dismissOnBackdrop={!saving}
    >
      <TextInput
        style={styles.nameInput}
        value={base.name}
        onChangeText={(t) => setBase({ ...base, name: t })}
        placeholder="Meal name"
        accessibilityLabel="Meal name"
      />

      <Text style={styles.fieldLabel}>PORTION</Text>
      <View style={styles.portionRow}>
        {PORTION_OPTIONS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.portionChip, p === portion && styles.portionChipOn]}
            onPress={() => setPortion(p)}
            accessibilityRole="button"
            accessibilityState={{ selected: p === portion }}
            accessibilityLabel={`${p}× portion`}
          >
            <Text style={[styles.portionChipText, p === portion && styles.portionChipTextOn]}>
              {p}×
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.macroGrid}>
        <Cell label="Kcal" value={scaled.calories} onChange={(v) => updateBaseNum('calories', v)} />
        <Cell label="Protein" value={scaled.proteinG} onChange={(v) => updateBaseNum('proteinG', v)} />
        <Cell label="Carbs"   value={scaled.carbsG}   onChange={(v) => updateBaseNum('carbsG', v)} />
        <Cell label="Fat"     value={scaled.fatG}     onChange={(v) => updateBaseNum('fatG', v)} />
      </View>

      <Text style={styles.fieldLabel}>SLOT</Text>
      <View style={styles.slotRow}>
        {SLOTS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.slotChip, slot === s.key && styles.slotChipOn]}
            onPress={() => setSlot(s.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: slot === s.key }}
          >
            <Text style={[styles.slotChipText, slot === s.key && styles.slotChipTextOn]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDelete}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Delete meal"
        >
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primary, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save meal"
        >
          {saving
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={styles.primaryText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

function Cell({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={styles.macroInput}
        value={String(value)}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} value`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    backgroundColor: colors.muted, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.foreground,
  },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 14, marginBottom: 6,
  },
  portionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  portionChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.muted,
  },
  portionChipOn: { backgroundColor: colors.foreground },
  portionChipText: { fontSize: 12, color: colors.foreground, fontWeight: fontWeight.medium },
  portionChipTextOn: { color: colors.primaryForeground, fontWeight: fontWeight.bold },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  macroCell: { flexBasis: '47%', flexGrow: 1 },
  macroInput: {
    backgroundColor: colors.muted, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: colors.foreground, fontVariant: ['tabular-nums'],
  },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.muted },
  slotChipOn: { backgroundColor: colors.foreground },
  slotChipText: { fontSize: 12, color: colors.foreground, fontWeight: fontWeight.medium },
  slotChipTextOn: { color: colors.primaryForeground, fontWeight: fontWeight.bold },
  errorText: { color: colors.destructive, fontSize: 12, marginTop: 12 },
  actions: { flexDirection: 'row', marginTop: 18 },
  deleteBtn: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    marginRight: 10,
  },
  deleteText: { color: colors.destructive, fontWeight: fontWeight.bold, fontSize: 13 },
  primary: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 12, height: 46,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: fontWeight.bold },
});
