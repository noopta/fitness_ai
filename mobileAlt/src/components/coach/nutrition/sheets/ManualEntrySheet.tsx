// ManualEntrySheet — direct macro entry without going through the LLM
// parser. Replaces the old SuggestSheet in the action dock: power users who
// know their numbers (or are logging a packaged item) shouldn't have to
// round-trip through "Describe" just to type a kcal value.
//
// Spec: one of the four primary log paths in the action dock — Describe /
// Snap / Voice / Manual. Same sheet-stack discipline as the other three.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Keyboard, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi, type SavedFoodItem, type RecipeSummary } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../../ui/KeyboardDoneBar';
import { slotForNow, todayStr, type MealSlotApi } from './sheetHelpers';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void | Promise<void>;
  /** Open the RecipeSheet builder (parent swaps sheets). */
  onCreateRecipe?: () => void;
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

export function ManualEntrySheet({ visible, onClose, onLogged, onCreateRecipe }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slot, setSlot] = useState<MealSlotApi>(slotForNow());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent + matching SavedFoods for the autocomplete row. Empty query
  // returns the user's most-used (highest useCount) foods so the list is
  // useful even before the user starts typing. As they type, it filters
  // by normalized-name match server-side. Debounced so we don't spam the
  // endpoint on every keystroke.
  const [suggestions, setSuggestions] = useState<SavedFoodItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [suggestQuery, setSuggestQuery] = useState('');

  // Recipe quick-log mode: picking a recipe chip swaps the macro grid for a
  // servings stepper — the backend multiplies per-serving macros and
  // snapshots the result into a MealEntry (source 'recipe').
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeSummary | null>(null);
  const [servings, setServings] = useState(1);

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
      setSuggestQuery('');
      setSelectedRecipe(null);
      setServings(1);
      const t = setTimeout(() => nameRef.current?.focus(), 320);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // Initial load: surface recently-used foods the moment the sheet opens
  // so users see options before typing a single character.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    nutritionApi.searchFoods('', 12)
      .then((r) => {
        if (cancelled) return;
        setSuggestions(r?.foods ?? []);
        setRecipes(r?.recipes ?? []);
      })
      .catch(() => { if (!cancelled) { setSuggestions([]); setRecipes([]); } });
    return () => { cancelled = true; };
  }, [visible]);

  // Debounced search as the user types in the Name field. 220 ms feels
  // responsive without hammering the endpoint on a long burst.
  useEffect(() => {
    if (!visible) return;
    const q = suggestQuery.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      nutritionApi.searchFoods(q, 12)
        .then((r) => {
          if (cancelled) return;
          setSuggestions(r?.foods ?? []);
          setRecipes(r?.recipes ?? []);
        })
        .catch(() => {});
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [visible, suggestQuery]);

  // When the user taps a suggestion, autofill the form with its macros so
  // they can just hit Save (or tweak the kcal first if the portion's
  // different today). Name carries over so the log row reads sensibly.
  const pickRecipe = (recipe: RecipeSummary) => {
    setSelectedRecipe(recipe);
    setServings(1);
    Keyboard.dismiss();
  };

  const pickSuggestion = (food: SavedFoodItem) => {
    setSelectedRecipe(null);
    setForm({
      name:     food.name,
      calories: String(food.calories ?? ''),
      proteinG: String(food.proteinG ?? ''),
      carbsG:   String(food.carbsG   ?? ''),
      fatG:     String(food.fatG     ?? ''),
    });
    setSuggestQuery(food.name); // keep input in sync visually
    Keyboard.dismiss();
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  // Kcal is the only strictly-required field — protein / carbs / fat default
  // to 0 if the user only knows the calorie count (e.g. a vague restaurant
  // dish). Name falls back to "Meal" so the timeline isn't empty. In recipe
  // mode the macros come from the recipe, so servings is all that matters.
  const canSave = !saving && (selectedRecipe ? servings > 0 : Number(form.calories) > 0);

  const save = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    try {
      if (selectedRecipe) {
        await nutritionApi.logRecipe(selectedRecipe.id, {
          date: todayStr(),
          mealType: slot,
          servings,
        });
        Analytics.recipeLogged({ servings, calories: Math.round(selectedRecipe.calories * servings) });
        await Promise.resolve(onLogged());
        onClose();
        return;
      }
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
        onChangeText={(t) => { setForm({ ...form, name: t }); setSuggestQuery(t); }}
        placeholder="Meal name — pick from history or type new"
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel="Meal name"
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />

      {/* SavedFood autocomplete strip. Always shows recent picks when the
          input's empty, filters as the user types. Tap to autofill the
          macro grid — they can save right away or tweak first. */}
      {(suggestions.length > 0 || recipes.length > 0 || onCreateRecipe) && (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestLabel}>
            {suggestQuery.trim() ? 'Matches from your library' : 'Recipes & recent foods'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.suggestRow}
          >
            {recipes.map((r) => (
              <TouchableOpacity
                key={`recipe-${r.id}`}
                style={[styles.suggestChip, styles.recipeChip]}
                onPress={() => pickRecipe(r)}
                activeOpacity={0.82}
              >
                <View style={styles.recipeChipTitleRow}>
                  <Ionicons name="book-outline" size={11} color={colors.foreground} />
                  <Text numberOfLines={1} style={styles.suggestChipName}>{r.name}</Text>
                </View>
                <Text style={styles.suggestChipMeta}>
                  {Math.round(r.calories)}kcal · {Math.round(r.proteinG)}p / serving
                </Text>
              </TouchableOpacity>
            ))}
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.suggestChip}
                onPress={() => pickSuggestion(s)}
                activeOpacity={0.82}
              >
                <Text numberOfLines={1} style={styles.suggestChipName}>{s.name}</Text>
                <Text style={styles.suggestChipMeta}>
                  {Math.round(s.calories)}kcal · {Math.round(s.proteinG)}p
                </Text>
              </TouchableOpacity>
            ))}
            {onCreateRecipe ? (
              <TouchableOpacity
                key="new-recipe"
                style={[styles.suggestChip, styles.newRecipeChip]}
                onPress={onCreateRecipe}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Create a new recipe"
              >
                <View style={styles.recipeChipTitleRow}>
                  <Ionicons name="add" size={12} color={colors.foreground} />
                  <Text style={styles.suggestChipName}>New recipe</Text>
                </View>
                <Text style={styles.suggestChipMeta}>save once, log forever</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
      )}

      {selectedRecipe ? (
        /* Recipe quick-log card — macros come from the saved recipe, the
           user only chooses how many servings they ate. */
        <View style={styles.recipeCard}>
          <View style={styles.recipeCardHeader}>
            <Ionicons name="book-outline" size={14} color={colors.foreground} />
            <Text numberOfLines={1} style={styles.recipeCardName}>{selectedRecipe.name}</Text>
            <TouchableOpacity
              onPress={() => setSelectedRecipe(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear selected recipe"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <Text style={styles.fieldLabel}>SERVINGS</Text>
          <View style={styles.servingsRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setServings((v) => Math.max(0.5, v - 0.5))}
              accessibilityRole="button"
              accessibilityLabel="Fewer servings"
            >
              <Ionicons name="remove" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={styles.servingsValue}>{servings}</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setServings((v) => Math.min(20, v + 0.5))}
              accessibilityRole="button"
              accessibilityLabel="More servings"
            >
              <Ionicons name="add" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={styles.recipeCardTotals}>
              = {Math.round(selectedRecipe.calories * servings)}kcal
              {' · '}{Math.round(selectedRecipe.proteinG * servings)}p
              {' · '}{Math.round(selectedRecipe.carbsG * servings)}c
              {' · '}{Math.round(selectedRecipe.fatG * servings)}f
            </Text>
          </View>
        </View>
      ) : (
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
      )}

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
        accessibilityLabel={selectedRecipe ? 'Log recipe' : 'Log meal'}
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <View style={styles.primaryInner}>
            <Text style={styles.primaryText}>{selectedRecipe ? 'Log recipe' : 'Log meal'}</Text>
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

  // Autocomplete strip — horizontal chips sitting under the Name field.
  suggestWrap: { marginTop: 10 },
  suggestLabel: {
    fontSize: 10, fontWeight: fontWeight.semibold,
    color: colors.mutedForeground, letterSpacing: 1,
    marginBottom: 6,
  },
  suggestRow: { gap: 8, paddingRight: 8 },
  suggestChip: {
    backgroundColor: colors.muted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 200,
    gap: 2,
  },
  suggestChipName: { fontSize: 13, color: colors.foreground, fontWeight: fontWeight.semibold },
  suggestChipMeta: { fontSize: 11, color: colors.mutedForeground },
  recipeChip: {
    borderWidth: 1, borderColor: colors.foreground,
    backgroundColor: colors.background,
  },
  recipeChipTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newRecipeChip: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mutedForeground,
    backgroundColor: colors.background,
  },

  // Recipe quick-log card (replaces the macro grid in recipe mode)
  recipeCard: {
    backgroundColor: colors.muted, borderRadius: 12,
    padding: 12, marginTop: 12,
  },
  recipeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recipeCardName: { flex: 1, fontSize: 14, color: colors.foreground, fontWeight: fontWeight.semibold },
  servingsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  stepBtn: {
    backgroundColor: colors.background, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  servingsValue: {
    minWidth: 40, textAlign: 'center',
    fontSize: 15, color: colors.foreground, fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  recipeCardTotals: { fontSize: 12, color: colors.mutedForeground, marginLeft: 8, flexShrink: 1 },

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
