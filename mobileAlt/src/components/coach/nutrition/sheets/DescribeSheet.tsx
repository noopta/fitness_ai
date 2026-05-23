// DescribeSheet — type a meal in plain English, Anakin parses it into macros,
// you review and confirm. Spec: handoff §10.
//
// Flow
//   1. Prompt — text input + Submit button.
//   2. Review — name + per-macro values, editable. "Log" commits.
// Error path: a failed parse keeps the user's text intact and surfaces a
// Retry button. Spec is explicit about not dismissing the sheet on parse
// failure (§07 dock states + §12 edge cases).

import React, { useEffect, useState } from 'react';
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
  /** Refresh the timeline after a successful log. */
  onLogged: () => void | Promise<void>;
  /**
   * Pre-fill the description input. Used when VoiceSheet hands off a
   * transcript — we want the user to land in the prompt stage with the
   * text already there, ready to edit + submit.
   */
  initialText?: string | null;
}

interface ParsedMeal {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

type Stage = 'prompt' | 'review' | 'saving';

export function DescribeSheet({ visible, onClose, onLogged, initialText }: Props) {
  const [stage, setStage] = useState<Stage>('prompt');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedMeal | null>(null);
  const [slot, setSlot] = useState<MealSlotApi>(slotForNow());

  // When the sheet opens with an initialText (typically from VoiceSheet's
  // transcript), pre-fill the input. Only seeded on visibility-true so a
  // stale prop doesn't blow over the user's in-progress edit. We also
  // auto-submit the transcript so the user lands directly on the review
  // screen — the whole point of voice-logging is to skip typing, asking
  // them to also tap a Parse button feels redundant.
  useEffect(() => {
    if (visible && initialText && initialText.trim()) {
      setText(initialText);
      setStage('prompt');
      // Defer to next tick so state propagates before submit reads `text`.
      const t = initialText.trim();
      setTimeout(() => { submitWith(t); }, 0);
    }
    // submitWith is stable inside the closure; deps lint disabled to avoid
    // re-running when `text` state changes during prompt edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialText]);

  const reset = () => {
    setStage('prompt'); setText(''); setParsing(false); setParseError(null); setParsed(null);
    setSlot(slotForNow());
  };

  const handleClose = () => {
    if (parsing || stage === 'saving') return; // don't kill in-flight requests
    reset();
    onClose();
  };

  const submitWith = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await nutritionApi.parseMeal(value);
      // Backend returns { name, calories, proteinG, carbsG, fatG, ... } or
      // sometimes nests under .meal — defensive on both.
      const meal = (res as any)?.meal ?? res;
      const next: ParsedMeal = {
        name: String(meal?.name ?? value),
        calories: Number(meal?.calories) || 0,
        proteinG: Number(meal?.proteinG) || 0,
        carbsG:   Number(meal?.carbsG)   || 0,
        fatG:     Number(meal?.fatG)     || 0,
      };
      setParsed(next);
      setStage('review');
    } catch (err: any) {
      setParseError(err?.message ?? "Anakin couldn't parse that. Try a bit more detail.");
    } finally {
      setParsing(false);
    }
  };
  const submit = () => submitWith(text);

  const log = async () => {
    if (!parsed) return;
    setStage('saving');
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: parsed.name,
        mealType: slot,
        calories: parsed.calories,
        proteinG: parsed.proteinG,
        carbsG: parsed.carbsG,
        fatG: parsed.fatG,
      });
      Analytics.foodTypedLogged({ calories: parsed.calories });
      await Promise.resolve(onLogged());
      reset();
      onClose();
    } catch (err: any) {
      setParseError(err?.message ?? 'Could not save. Try again.');
      setStage('review');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={stage === 'prompt' ? 'Describe a meal' : 'Review macros'}
      subtitle={stage === 'prompt'
        ? "Tell Anakin what you had — quantities, prep, whatever you remember."
        : "Tweak any value, then log."}
      dismissOnBackdrop={!parsing && stage !== 'saving'}
    >
      {stage === 'prompt' && (
        <PromptStage
          text={text}
          setText={setText}
          parsing={parsing}
          error={parseError}
          onSubmit={submit}
        />
      )}
      {stage === 'review' && parsed && (
        <ReviewStage
          meal={parsed}
          setMeal={(m) => setParsed(m)}
          slot={slot}
          setSlot={setSlot}
          error={parseError}
          onLog={log}
          onBack={() => setStage('prompt')}
        />
      )}
      {stage === 'saving' && (
        <View style={styles.savingBox}>
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.savingText}>Logging…</Text>
        </View>
      )}
    </BottomSheet>
  );
}

// ─── Stage components ────────────────────────────────────────────────────────

function PromptStage({
  text, setText, parsing, error, onSubmit,
}: {
  text: string; setText: (s: string) => void;
  parsing: boolean; error: string | null;
  onSubmit: () => void;
}) {
  return (
    <View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="e.g. Steel-cut oats with a scoop of whey and blueberries"
        placeholderTextColor={colors.mutedForeground}
        multiline
        autoFocus
        accessibilityLabel="Meal description"
        // The iOS accessory bar gives users a way to dismiss the keyboard
        // without it covering the Parse button. Android's keyboard already
        // has a Done/Enter key so the bar no-ops there.
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <TouchableOpacity
        // Stays visually prominent even when disabled — earlier opacity 0.45
        // + flat-grey label made users miss it entirely. The label is also
        // action-first ("Get macros") rather than the implementation-detail
        // "Parse with Anakin".
        style={[styles.primary, (!text.trim() || parsing) && styles.primaryDisabled]}
        onPress={() => { Keyboard.dismiss(); onSubmit(); }}
        disabled={!text.trim() || parsing}
        accessibilityRole="button"
        accessibilityLabel="Get macros for this meal"
      >
        {parsing ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <View style={styles.primaryInner}>
            <Text style={styles.primaryText}>Get macros</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.primaryForeground} />
          </View>
        )}
      </TouchableOpacity>
      <KeyboardDoneBar />
    </View>
  );
}

const SLOTS: Array<{ key: MealSlotApi; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' },
];

function ReviewStage({
  meal, setMeal, slot, setSlot, error, onLog, onBack,
}: {
  meal: ParsedMeal;
  setMeal: (m: ParsedMeal) => void;
  slot: MealSlotApi;
  setSlot: (s: MealSlotApi) => void;
  error: string | null;
  onLog: () => void;
  onBack: () => void;
}) {
  const setNum = (k: keyof Omit<ParsedMeal, 'name'>, v: string) => {
    const n = Number(v);
    setMeal({ ...meal, [k]: Number.isFinite(n) ? n : 0 });
  };

  return (
    <View>
      <TextInput
        style={[styles.input, { minHeight: 44 }]}
        value={meal.name}
        onChangeText={(t) => setMeal({ ...meal, name: t })}
        placeholder="Meal name"
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel="Meal name"
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />

      <View style={styles.macroGrid}>
        <MacroInput label="Kcal" value={meal.calories} onChange={(v) => setNum('calories', v)} />
        <MacroInput label="Protein" value={meal.proteinG} onChange={(v) => setNum('proteinG', v)} />
        <MacroInput label="Carbs"   value={meal.carbsG}   onChange={(v) => setNum('carbsG', v)} />
        <MacroInput label="Fat"     value={meal.fatG}     onChange={(v) => setNum('fatG', v)} />
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

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghost} onPress={onBack} accessibilityRole="button">
          <Text style={styles.ghostText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primary}
          onPress={onLog}
          accessibilityRole="button"
          accessibilityLabel="Log meal"
        >
          <Text style={styles.primaryText}>Log meal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MacroInput({
  label, value, onChange,
}: {
  label: string; value: number; onChange: (v: string) => void;
}) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={styles.macroInput}
        value={String(value)}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} value`}
        inputAccessoryViewID={KEYBOARD_DONE_ID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
    // Shorter than the v1 88pt height so the Parse button stays on-screen
    // when the keyboard pushes the sheet up. Users can still grow it via
    // the multiline input itself.
    minHeight: 64,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 46,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flex: 1,
  },
  // Keep the button readable when disabled — earlier opacity 0.45 made the
  // label vanish into the grey background on iOS dark mode.
  primaryDisabled: { opacity: 0.7 },
  primaryInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryText: { color: colors.primaryForeground, fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  ghost: {
    height: 46,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  ghostText: { color: colors.foreground, fontWeight: fontWeight.semibold, fontSize: 14 },
  actions: { flexDirection: 'row', marginTop: 4 },
  errorText: { color: colors.destructive, fontSize: 12, marginTop: 8 },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  macroCell: { flexBasis: '47%', flexGrow: 1 },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 12, marginBottom: 4,
  },
  macroInput: {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.foreground,
    fontVariant: ['tabular-nums'],
  },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slotChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.muted,
  },
  slotChipOn: { backgroundColor: colors.foreground },
  slotChipText: { fontSize: 12, color: colors.foreground, fontWeight: fontWeight.medium },
  slotChipTextOn: { color: colors.primaryForeground, fontWeight: fontWeight.bold },
  savingBox: { paddingVertical: 32, alignItems: 'center', gap: 10 },
  savingText: { color: colors.mutedForeground, fontSize: 13 },
});
