// SnapSheet — take or pick a photo, Anakin's Vision model returns macros,
// review and confirm. Spec: handoff §10.
//
// Flow
//   1. Capture — Camera tile + Library tile.
//   2. Review — preview image + parsed macros (editable) + slot picker.
//      "Log" commits via nutritionApi.logMeal.
// The vision endpoint can take 5-8s on cold paths; we show a "Anakin is
// looking at it…" placeholder rather than blocking the user behind a spinner.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Image, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { slotForNow, todayStr, type MealSlotApi } from './sheetHelpers';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void | Promise<void>;
}

interface ParsedMeal {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

type Stage = 'capture' | 'analyzing' | 'review' | 'saving';

export function SnapSheet({ visible, onClose, onLogged }: Props) {
  const [stage, setStage] = useState<Stage>('capture');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [parsed, setParsed] = useState<ParsedMeal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<MealSlotApi>(slotForNow());

  const reset = () => {
    setStage('capture'); setImageUri(null); setImageBase64(null); setParsed(null);
    setError(null); setSlot(slotForNow());
  };

  const handleClose = () => {
    if (stage === 'analyzing' || stage === 'saving') return;
    reset();
    onClose();
  };

  const ensurePermission = async (kind: 'camera' | 'library'): Promise<boolean> => {
    const req = kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!req.granted) {
      Alert.alert(
        kind === 'camera' ? 'Camera permission needed' : 'Photo library permission needed',
        'Enable in Settings to add a photo of your meal.',
      );
      return false;
    }
    return true;
  };

  const pick = async (kind: 'camera' | 'library') => {
    if (!await ensurePermission(kind)) return;
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      base64: true,
      quality: 0.6,
      allowsEditing: false,
    };
    const res = kind === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setImageUri(a.uri);
    setImageBase64(a.base64 ?? null);
    setImageMime(a.mimeType ?? 'image/jpeg');
    await analyze(a.base64 ?? null, a.mimeType ?? 'image/jpeg');
  };

  const analyze = async (base64: string | null, mimeType: string) => {
    if (!base64) {
      setError('Could not read that image. Try again.');
      return;
    }
    setStage('analyzing');
    setError(null);
    try {
      const res = await nutritionApi.analyzePhoto(base64, mimeType);
      const meal = (res as any)?.meal ?? res;
      const next: ParsedMeal = {
        name: String(meal?.name ?? 'Meal'),
        calories: Number(meal?.calories) || 0,
        proteinG: Number(meal?.proteinG) || 0,
        carbsG:   Number(meal?.carbsG)   || 0,
        fatG:     Number(meal?.fatG)     || 0,
      };
      setParsed(next);
      setStage('review');
    } catch (err: any) {
      setError(err?.message ?? "Anakin couldn't read that photo. Try again or describe it instead.");
      setStage('capture');
    }
  };

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
      Analytics.foodScannedLogged({ calories: parsed.calories });
      await Promise.resolve(onLogged());
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save. Try again.');
      setStage('review');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={stage === 'capture' ? 'Snap a meal' : stage === 'analyzing' ? 'Reading photo…' : 'Review macros'}
      subtitle={stage === 'capture'
        ? 'Anakin uses Vision to estimate macros from a photo.'
        : stage === 'review'
          ? 'Tweak any value before logging.'
          : undefined}
      dismissOnBackdrop={stage !== 'analyzing' && stage !== 'saving'}
    >
      {stage === 'capture' && (
        <View>
          <View style={styles.captureRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => pick('camera')}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <Ionicons name="camera-outline" size={28} color={colors.foreground} />
              <Text style={styles.tileLabel}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => pick('library')}
              accessibilityRole="button"
              accessibilityLabel="Pick from library"
            >
              <Ionicons name="images-outline" size={28} color={colors.foreground} />
              <Text style={styles.tileLabel}>From library</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      )}

      {stage === 'analyzing' && (
        <View style={styles.analyzingBox}>
          {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.savingText}>Anakin is looking at it…</Text>
        </View>
      )}

      {stage === 'review' && parsed && (
        <ReviewStage
          imageUri={imageUri}
          meal={parsed}
          setMeal={setParsed}
          slot={slot}
          setSlot={setSlot}
          error={error}
          onLog={log}
          onRetake={() => { reset(); }}
        />
      )}

      {stage === 'saving' && (
        <View style={styles.analyzingBox}>
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.savingText}>Logging…</Text>
        </View>
      )}
    </BottomSheet>
  );
}

const SLOTS: Array<{ key: MealSlotApi; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' },
];

function ReviewStage({
  imageUri, meal, setMeal, slot, setSlot, error, onLog, onRetake,
}: {
  imageUri: string | null;
  meal: ParsedMeal;
  setMeal: (m: ParsedMeal) => void;
  slot: MealSlotApi;
  setSlot: (s: MealSlotApi) => void;
  error: string | null;
  onLog: () => void;
  onRetake: () => void;
}) {
  const setNum = (k: keyof Omit<ParsedMeal, 'name'>, v: string) => {
    const n = Number(v);
    setMeal({ ...meal, [k]: Number.isFinite(n) ? n : 0 });
  };

  return (
    <View>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}
      <TextInput
        style={styles.nameInput}
        value={meal.name}
        onChangeText={(t) => setMeal({ ...meal, name: t })}
        placeholder="Meal name"
        accessibilityLabel="Meal name"
      />
      <View style={styles.macroGrid}>
        <Cell label="Kcal" value={meal.calories} onChange={(v) => setNum('calories', v)} />
        <Cell label="Protein" value={meal.proteinG} onChange={(v) => setNum('proteinG', v)} />
        <Cell label="Carbs" value={meal.carbsG} onChange={(v) => setNum('carbsG', v)} />
        <Cell label="Fat" value={meal.fatG} onChange={(v) => setNum('fatG', v)} />
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
        <TouchableOpacity style={styles.ghost} onPress={onRetake} accessibilityRole="button">
          <Text style={styles.ghostText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={onLog} accessibilityRole="button" accessibilityLabel="Log meal">
          <Text style={styles.primaryText}>Log meal</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  captureRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  // Tiles are sized by height (not aspect ratio) so they always fit inside the
  // sheet on small phones (e.g. iPhone SE / mini) — earlier `aspectRatio: 1.1`
  // produced ~180pt-tall tiles that got clipped above the home indicator.
  tile: {
    flex: 1, height: 110,
    borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  tileLabel: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.foreground },
  analyzingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  preview: {
    width: '100%', aspectRatio: 1, borderRadius: 14,
    backgroundColor: colors.muted, marginBottom: 12,
  },
  savingText: { color: colors.mutedForeground, fontSize: 13 },
  nameInput: {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.foreground,
  },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  macroCell: { flexBasis: '47%', flexGrow: 1 },
  fieldLabel: {
    fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginTop: 12, marginBottom: 4,
  },
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
  primary: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 12, height: 46,
    marginTop: 12, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: fontWeight.bold },
  ghost: {
    height: 46, marginTop: 12, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    marginRight: 8,
  },
  ghostText: { color: colors.foreground, fontWeight: fontWeight.semibold, fontSize: 14 },
  actions: { flexDirection: 'row' },
  errorText: { color: colors.destructive, fontSize: 12, marginTop: 8 },
});
