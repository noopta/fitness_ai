// RecipeSheet — build a saved recipe (MyFitnessPal-style): paste or dictate
// the whole thing, Anakin splits it into ingredients with per-ingredient
// macros, you review/tweak, set how many servings it makes, and save. The
// saved recipe then shows up in the Manual sheet's library strip for
// one-tap logging by servings.
//
// Flow
//   1. Prompt — multiline recipe text + optional servings + "Break it down".
//      "Build by hand" skips the AI and opens the review stage blank.
//   2. Review — name, servings, editable ingredient rows, live per-serving
//      preview. "Save recipe" commits.
// Error path mirrors DescribeSheet: failed parse keeps the text intact and
// surfaces the error inline — the sheet never dismisses itself on failure.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Keyboard, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi, type RecipeSummary } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../../ui/KeyboardDoneBar';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the saved recipe — parent returns to the log flow. */
  onSaved: (recipe: RecipeSummary) => void | Promise<void>;
}

// Row values stay as strings while editing (same convention as
// ManualEntrySheet's macro cells) and parse on save.
interface ItemRow {
  name: string;
  quantity: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

const EMPTY_ROW: ItemRow = { name: '', quantity: '', calories: '', proteinG: '', carbsG: '', fatG: '' };

type Stage = 'prompt' | 'review' | 'saving';

export function RecipeSheet({ visible, onClose, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>('prompt');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [via, setVia] = useState<'ai_parse' | 'manual'>('manual');

  const [name, setName] = useState('');
  const [servings, setServings] = useState('4');
  const [items, setItems] = useState<ItemRow[]>([EMPTY_ROW]);

  const inputRef = useRef<TextInput>(null);

  const reset = () => {
    setStage('prompt'); setText(''); setParsing(false); setError(null);
    setVia('manual'); setName(''); setServings('4'); setItems([EMPTY_ROW]);
  };

  useEffect(() => {
    if (visible) {
      reset();
      // Focus after the slide-in finishes (same 320ms rule as the other sheets).
      const t = setTimeout(() => inputRef.current?.focus(), 320);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const handleClose = () => {
    if (parsing || stage === 'saving') return;
    onClose();
  };

  const parse = async () => {
    const value = text.trim();
    if (!value) return;
    Keyboard.dismiss();
    setParsing(true);
    setError(null);
    try {
      const parsed = await nutritionApi.parseRecipe(value);
      setName(parsed.name);
      setServings(String(parsed.servings));
      setItems(parsed.items.map((i) => ({
        name: i.name,
        quantity: i.quantity ?? '',
        calories: String(Math.round(i.calories)),
        proteinG: String(Math.round(i.proteinG)),
        carbsG:   String(Math.round(i.carbsG)),
        fatG:     String(Math.round(i.fatG)),
      })));
      setVia('ai_parse');
      setStage('review');
    } catch (err: any) {
      setError(err?.message ?? "Anakin couldn't break that down. Try adding quantities.");
    } finally {
      setParsing(false);
    }
  };

  const buildByHand = () => {
    setVia('manual');
    setError(null);
    setStage('review');
  };

  const setItem = (idx: number, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const validItems = useMemo(
    () => items.filter((i) => i.name.trim()),
    [items],
  );
  const servingsNum = Number(servings) || 0;

  // Live per-serving preview — same math the backend runs on save.
  const perServing = useMemo(() => {
    const total = validItems.reduce(
      (acc, i) => ({
        kcal: acc.kcal + (Number(i.calories) || 0),
        p:    acc.p    + (Number(i.proteinG) || 0),
        c:    acc.c    + (Number(i.carbsG)   || 0),
        f:    acc.f    + (Number(i.fatG)     || 0),
      }),
      { kcal: 0, p: 0, c: 0, f: 0 },
    );
    const s = servingsNum > 0 ? servingsNum : 1;
    return {
      kcal: Math.round(total.kcal / s),
      p: Math.round(total.p / s),
      c: Math.round(total.c / s),
      f: Math.round(total.f / s),
    };
  }, [validItems, servingsNum]);

  const canSave = stage === 'review' && validItems.length > 0 && servingsNum >= 0.5 && name.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setStage('saving');
    setError(null);
    try {
      const recipe = await nutritionApi.createRecipe({
        name: name.trim(),
        servings: servingsNum,
        items: validItems.map((i) => ({
          name: i.name.trim(),
          quantity: i.quantity.trim(),
          calories: Number(i.calories) || 0,
          proteinG: Number(i.proteinG) || 0,
          carbsG:   Number(i.carbsG)   || 0,
          fatG:     Number(i.fatG)     || 0,
        })),
      });
      Analytics.recipeCreated({ ingredient_count: validItems.length, servings: servingsNum, via });
      await Promise.resolve(onSaved(recipe));
    } catch (err: any) {
      setError(err?.message ?? 'Could not save the recipe. Try again.');
      setStage('review');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={stage === 'prompt' ? 'New recipe' : 'Review recipe'}
      subtitle={stage === 'prompt'
        ? 'Paste the whole recipe — Anakin splits it into ingredients.'
        : 'Tweak anything, set servings, then save to your library.'}
      dismissOnBackdrop={!parsing && stage !== 'saving'}
    >
      {stage === 'prompt' && (
        <View>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={'e.g. Chili — 2 lbs ground beef, 1 can black beans,\n1 onion, 1 jar salsa. Makes 6 servings.'}
            placeholderTextColor={colors.mutedForeground}
            multiline
            accessibilityLabel="Recipe description"
            inputAccessoryViewID={KEYBOARD_DONE_ID}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.primary, (!text.trim() || parsing) && styles.primaryDisabled]}
            onPress={parse}
            disabled={!text.trim() || parsing}
            accessibilityRole="button"
            accessibilityLabel="Break the recipe into ingredients"
          >
            {parsing ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <View style={styles.primaryInner}>
                <Text style={styles.primaryText}>Break it down</Text>
                <Ionicons name="sparkles-outline" size={16} color={colors.primaryForeground} />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={buildByHand}
            disabled={parsing}
            accessibilityRole="button"
            accessibilityLabel="Build the recipe by hand"
          >
            <Text style={styles.ghostBtnText}>Build by hand instead</Text>
          </TouchableOpacity>
        </View>
      )}

      {stage === 'review' && (
        <View>
          {/* Plain View: the shared BottomSheet body scrolls now — a nested
              vertical ScrollView here would fight it for the gesture. */}
          <View style={styles.reviewScroll}>
            <Text style={styles.fieldLabel}>RECIPE NAME</Text>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Sunday chili"
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Recipe name"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
            />

            <Text style={styles.fieldLabel}>MAKES (SERVINGS)</Text>
            <View style={styles.servingsRow}>
              <Stepper
                onMinus={() => setServings(String(Math.max(0.5, (Number(servings) || 1) - 0.5)))}
                onPlus={() => setServings(String(Math.min(100, (Number(servings) || 1) + 0.5)))}
              >
                <TextInput
                  style={styles.servingsInput}
                  value={servings}
                  onChangeText={setServings}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Servings the recipe makes"
                  inputAccessoryViewID={KEYBOARD_DONE_ID}
                />
              </Stepper>
              <Text style={styles.perServingPreview}>
                ≈ {perServing.kcal}kcal · {perServing.p}p · {perServing.c}c · {perServing.f}f per serving
              </Text>
            </View>

            <Text style={styles.fieldLabel}>INGREDIENTS — macros are for the full amount used</Text>
            {items.map((row, idx) => (
              <View key={idx} style={styles.itemCard}>
                <View style={styles.itemTopRow}>
                  <TextInput
                    style={styles.itemName}
                    value={row.name}
                    onChangeText={(v) => setItem(idx, { name: v })}
                    placeholder="Ingredient"
                    placeholderTextColor={colors.mutedForeground}
                    accessibilityLabel={`Ingredient ${idx + 1} name`}
                    inputAccessoryViewID={KEYBOARD_DONE_ID}
                  />
                  <TextInput
                    style={styles.itemQty}
                    value={row.quantity}
                    onChangeText={(v) => setItem(idx, { quantity: v })}
                    placeholder="qty"
                    placeholderTextColor={colors.mutedForeground}
                    accessibilityLabel={`Ingredient ${idx + 1} quantity`}
                    inputAccessoryViewID={KEYBOARD_DONE_ID}
                  />
                  <TouchableOpacity
                    onPress={() => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : [EMPTY_ROW])}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ingredient ${idx + 1}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
                <View style={styles.itemMacroRow}>
                  <MacroMini label="kcal" value={row.calories} onChange={(v) => setItem(idx, { calories: v })} />
                  <MacroMini label="P"    value={row.proteinG} onChange={(v) => setItem(idx, { proteinG: v })} />
                  <MacroMini label="C"    value={row.carbsG}   onChange={(v) => setItem(idx, { carbsG: v })} />
                  <MacroMini label="F"    value={row.fatG}     onChange={(v) => setItem(idx, { fatG: v })} />
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addRowBtn}
              onPress={() => setItems((prev) => [...prev, EMPTY_ROW])}
              accessibilityRole="button"
              accessibilityLabel="Add another ingredient"
            >
              <Ionicons name="add" size={16} color={colors.foreground} />
              <Text style={styles.addRowText}>Add ingredient</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.primary, !canSave && styles.primaryDisabled]}
            onPress={save}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save recipe"
          >
            <View style={styles.primaryInner}>
              <Text style={styles.primaryText}>Save recipe</Text>
              <Ionicons name="bookmark-outline" size={16} color={colors.primaryForeground} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {stage === 'saving' && (
        <View style={styles.savingBox}>
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.savingText}>Saving recipe…</Text>
        </View>
      )}

      <KeyboardDoneBar />
    </BottomSheet>
  );
}

function Stepper({ onMinus, onPlus, children }: {
  onMinus: () => void; onPlus: () => void; children: React.ReactNode;
}) {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={onMinus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Fewer servings">
        <Ionicons name="remove" size={18} color={colors.foreground} />
      </TouchableOpacity>
      {children}
      <TouchableOpacity onPress={onPlus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="More servings">
        <Ionicons name="add" size={18} color={colors.foreground} />
      </TouchableOpacity>
    </View>
  );
}

function MacroMini({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={styles.macroMini}>
      <Text style={styles.macroMiniLabel}>{label}</Text>
      <TextInput
        style={styles.macroMiniInput}
        value={value}
        onChangeText={onChange}
        placeholder="0"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} for this ingredient`}
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.muted,
    borderRadius: 12,
    padding: 12,
    minHeight: 96,
    fontSize: 14,
    color: colors.foreground,
    textAlignVertical: 'top',
  },
  reviewScroll: {},
  nameInput: {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.foreground,
  },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 14, marginBottom: 6,
  },
  servingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  stepper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.muted, borderRadius: 10,
  },
  stepBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  servingsInput: {
    minWidth: 44, textAlign: 'center',
    fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'],
    paddingVertical: 8,
  },
  perServingPreview: { fontSize: 12, color: colors.mutedForeground, flexShrink: 1 },

  itemCard: {
    backgroundColor: colors.muted, borderRadius: 12,
    padding: 10, marginBottom: 8, gap: 8,
  },
  itemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { flex: 1, fontSize: 13.5, color: colors.foreground, paddingVertical: 4 },
  itemQty: { width: 76, fontSize: 12.5, color: colors.mutedForeground, paddingVertical: 4 },
  itemMacroRow: { flexDirection: 'row', gap: 8 },
  macroMini: { flex: 1 },
  macroMiniLabel: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.mutedForeground, marginBottom: 2 },
  macroMiniInput: {
    backgroundColor: colors.background, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
    fontSize: 13, color: colors.foreground, fontVariant: ['tabular-nums'],
  },
  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mutedForeground,
    marginBottom: 4,
  },
  addRowText: { fontSize: 13, color: colors.foreground, fontWeight: fontWeight.medium },

  primary: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 46,
    marginTop: 14,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryDisabled: { opacity: 0.5 },
  primaryInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryText: { color: colors.primaryForeground, fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  ghostBtn: { alignItems: 'center', paddingVertical: 12 },
  ghostBtnText: { fontSize: 13, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  errorText: { color: colors.destructive, fontSize: 12, marginTop: 10 },
  savingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  savingText: { fontSize: 13, color: colors.mutedForeground },
});
