// ManualEntrySheet — direct macro entry without going through the LLM
// parser. Replaces the old SuggestSheet in the action dock: power users who
// know their numbers (or are logging a packaged item) shouldn't have to
// round-trip through "Describe" just to type a kcal value.
//
// Spec: one of the four primary log paths in the action dock — Describe /
// Snap / Voice / Manual. Same sheet-stack discipline as the other three.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../../ui/KeyboardDoneBar';
import { slotForNow, todayStr, type MealSlotApi } from './sheetHelpers';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void | Promise<void>;
}

interface FormState {
  name: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

const EMPTY: FormState = {
  name: '', calories: '', proteinG: '', carbsG: '', fatG: '',
};

const SLOTS: Array<{ key: MealSlotApi; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' },
];

export function ManualEntrySheet({ visible, onClose, onLogged }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slot, setSlot] = useState<MealSlotApi>(slotForNow());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<TextInput>(null);
  // Fresh state every time the sheet reopens. Focus the first field after
  // the slide-in animation has finished (~280ms) — focusing during the
  // animation caused the keyboard to push up mid-slide, which the user
  // saw as choppy/laggy motion.
  useEffect(() => {
    if (visible) {
      setForm(EMPTY);
      setSlot(slotForNow());
      setError(null);
      setSaving(false);
      const t = setTimeout(() => nameRef.current?.focus(), 320);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  // Kcal is the only strictly-required field — protein / carbs / fat default
  // to 0 if the user only knows the calorie count (e.g. a vague restaurant
  // dish). Name falls back to "Meal" so the timeline isn't empty.
  const canSave = !saving && Number(form.calories) > 0;

  const save = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: form.name.trim() || 'Meal',
        mealType: slot,
        calories: Number(form.calories) || 0,
        proteinG: Number(form.proteinG) || 0,
        carbsG:   Number(form.carbsG)   || 0,
        fatG:     Number(form.fatG)     || 0,
      });
      Analytics.foodTypedLogged({ calories: Number(form.calories) || 0 });
      await Promise.resolve(onLogged());
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title="Manual entry"
      subtitle="Type the macros directly — skip the AI parse."
      dismissOnBackdrop={!saving}
    >
      <TextInput
        ref={nameRef}
        style={styles.nameInput}
        value={form.name}
        onChangeText={(t) => setForm({ ...form, name: t })}
        placeholder="Meal name (optional)"
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel="Meal name"
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />

      <View style={styles.macroGrid}>
        <Cell
          label="Kcal"
          value={form.calories}
          onChange={(v) => setForm({ ...form, calories: v })}
          required
        />
        <Cell
          label="Protein"
          value={form.proteinG}
          onChange={(v) => setForm({ ...form, proteinG: v })}
        />
        <Cell
          label="Carbs"
          value={form.carbsG}
          onChange={(v) => setForm({ ...form, carbsG: v })}
        />
        <Cell
          label="Fat"
          value={form.fatG}
          onChange={(v) => setForm({ ...form, fatG: v })}
        />
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
            accessibilityLabel={`Slot ${s.label}`}
          >
            <Text style={[styles.slotChipText, slot === s.key && styles.slotChipTextOn]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primary, !canSave && styles.primaryDisabled]}
        onPress={save}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityLabel="Log meal"
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <View style={styles.primaryInner}>
            <Text style={styles.primaryText}>Log meal</Text>
            <Ionicons name="checkmark" size={16} color={colors.primaryForeground} />
          </View>
        )}
      </TouchableOpacity>

      <KeyboardDoneBar />
    </BottomSheet>
  );
}

function Cell({
  label, value, onChange, required,
}: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.fieldLabel}>
        {label.toUpperCase()}{required ? <Text style={styles.required}>  *</Text> : null}
      </Text>
      <TextInput
        style={styles.macroInput}
        value={value}
        onChangeText={onChange}
        placeholder="0"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} value`}
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.foreground,
  },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  macroCell: { flexBasis: '47%', flexGrow: 1 },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 14, marginBottom: 6,
  },
  required: { color: colors.destructive },
  macroInput: {
    backgroundColor: colors.muted, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: colors.foreground, fontVariant: ['tabular-nums'],
  },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.muted,
  },
  slotChipOn: { backgroundColor: colors.foreground },
  slotChipText: { fontSize: 12, color: colors.foreground, fontWeight: fontWeight.medium },
  slotChipTextOn: { color: colors.primaryForeground, fontWeight: fontWeight.bold },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 46,
    marginTop: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryDisabled: { opacity: 0.5 },
  primaryInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryText: { color: colors.primaryForeground, fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  errorText: { color: colors.destructive, fontSize: 12, marginTop: 10 },
});
