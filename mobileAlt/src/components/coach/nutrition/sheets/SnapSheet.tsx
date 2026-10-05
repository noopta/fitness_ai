// SnapSheet — take or pick a photo, Anakin's Vision model returns macros,
// review and confirm. Spec: handoff §10.
//
// Flow
//   1. Capture — Camera tile + Library tile.
//   2. Review — preview image + parsed macros (editable) + slot picker.
//      "Log" commits via nutritionApi.logMeal.
// The vision endpoint can take 5-8s on cold paths; we show a "Anakin is
// looking at it…" placeholder rather than blocking the user behind a spinner.
//
// mealPhotoV2 flag (contract 8): photos are resized to ~1600 px, the library
// takes up to 3 shots of one meal, review is an editable ITEM list (grams
// rescale from per100g), "+ Add photo" sends the current items as
// existingItems and appends only what's new, and framingWarning /
// noFoodDetected are surfaced inline. Flag off = the original flow, unchanged.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Image, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { slotForNow, todayStr, type MealSlotApi, richLogFields } from './sheetHelpers';
import { MicroPreview } from './MicroPreview';
import { useAuth } from '../../../../context/AuthContext';
import { preparePhoto, type PreparedPhoto } from '../mealPhotoPrep';
import {
  itemsFromParse, itemsFromPhoto, itemLogFields, mealNameFrom, mergeItems, toMealPhotoItems, totalsOf,
  type ReviewItem,
} from '../mealItems';
import { MealItemsReview } from './MealItemsReview';

const NO_FOOD_MSG = "We couldn't spot any food in that photo. Try again from above with the whole plate in frame.";

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
  raw?: any;
}

type Stage = 'capture' | 'analyzing' | 'review' | 'saving';

export function SnapSheet({ visible, onClose, onLogged }: Props) {
  const [stage, setStage] = useState<Stage>('capture');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [parsed, setParsed] = useState<ParsedMeal | null>(null);
  // Full parse response (micros + gut fields) — forwarded on log.
  const [parsedDetail, setParsedDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<MealSlotApi>(slotForNow());
  // ── mealPhotoV2 state ──
  const { getFeatures } = useAuth();
  const photoV2 = getFeatures().mealPhotoV2;
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [extraUris, setExtraUris] = useState<string[]>([]);
  const [framingWarning, setFramingWarning] = useState<string | null>(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [addingText, setAddingText] = useState(false);
  const [inlineNote, setInlineNote] = useState<string | null>(null);

  const reset = () => {
    setStage('capture'); setImageUri(null); setImageBase64(null); setParsed(null);
    setParsedDetail(null);
    setError(null); setSlot(slotForNow());
    setItems(null); setExtraUris([]); setFramingWarning(null); setInlineNote(null);
    setAddingPhoto(false); setAddingText(false);
  };
  // "Retake" keeps the chosen slot — the user already told us which meal it is.
  const retake = () => {
    const keep = slot;
    reset();
    setSlot(keep);
  };

  const handleClose = () => {
    if (stage === 'analyzing' || stage === 'saving' || addingPhoto) return;
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

  // ── mealPhotoV2: capture 1–3 photos, resized, base64 ──
  const capturePhotos = async (kind: 'camera' | 'library', allowMulti: boolean): Promise<PreparedPhoto[] | null> => {
    if (!await ensurePermission(kind)) return null;
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      // Resize happens in preparePhoto; the picker's own base64 is only the
      // fallback if the manipulator ever fails.
      base64: false,
      quality: 0.9,
      allowsEditing: false,
      ...(kind === 'library' && allowMulti ? { allowsMultipleSelection: true, selectionLimit: 3 } : {}),
    };
    const res = kind === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return null;
    const prepared: PreparedPhoto[] = [];
    for (const a of res.assets.slice(0, 3)) {
      const p = await preparePhoto(a.uri, { width: a.width, height: a.height }, a.base64 ?? null, a.mimeType ?? 'image/jpeg');
      if (p) prepared.push(p);
    }
    if (!prepared.length) {
      setError('Could not read that image. Try again.');
      return [];
    }
    return prepared;
  };

  const applyPhotoResult = (res: any) => {
    const meal = res?.meal ?? res;
    const found = itemsFromPhoto(res);
    setParsedDetail(meal);
    setFramingWarning(typeof meal?.framingWarning === 'string' && meal.framingWarning ? meal.framingWarning : null);
    setItems(found);
    const t = totalsOf(found);
    setParsed({
      name: String(meal?.name ?? '').trim() || mealNameFrom(found),
      calories: t.calories, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG,
      raw: res,
    });
  };

  const pickV2 = async (kind: 'camera' | 'library') => {
    setError(null);
    const photos = await capturePhotos(kind, true);
    if (!photos || !photos.length) return;
    setImageUri(photos[0].uri);
    setExtraUris(photos.slice(1).map((p) => p.uri));
    setStage('analyzing');
    try {
      const res = await nutritionApi.analyzePhotos({ images: photos.map((p) => ({ base64: p.base64, mimeType: p.mimeType })) });
      if ((res as any)?.noFoodDetected || (res as any)?.meal?.noFoodDetected) {
        setError(NO_FOOD_MSG);
        setStage('capture');
        return;
      }
      applyPhotoResult(res);
      setStage('review');
    } catch (err: any) {
      setError(err?.message ?? "Anakin couldn't read that photo. Try again or describe it instead.");
      setStage('capture');
    }
  };

  // "+ Add photo": another angle of the SAME meal. Sends what's already on the
  // list so the server returns only new items, which we append.
  const addPhoto = async (kind: 'camera' | 'library') => {
    if (!items || addingPhoto) return;
    setInlineNote(null);
    const photos = await capturePhotos(kind, true);
    if (!photos || !photos.length) return;
    setAddingPhoto(true);
    try {
      const res = await nutritionApi.analyzePhotos({
        images: photos.map((p) => ({ base64: p.base64, mimeType: p.mimeType })),
        existingItems: toMealPhotoItems(items),
      });
      setExtraUris((u) => [...u, ...photos.map((p) => p.uri)].slice(-5));
      const meal = (res as any)?.meal ?? res;
      const fresh = (res as any)?.noFoodDetected ? [] : itemsFromPhoto(res);
      // Legacy fallback: an older server returns the whole meal again as one
      // meal-level item — never double-count it.
      const newOnes = Array.isArray(meal?.items) ? fresh : [];
      setFramingWarning(typeof meal?.framingWarning === 'string' && meal.framingWarning ? meal.framingWarning : null);
      if (newOnes.length) {
        setItems((cur) => mergeItems(cur ?? [], newOnes));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setInlineNote(`Added ${newOnes.length} item${newOnes.length === 1 ? '' : 's'} from the new photo.`);
      } else {
        setInlineNote('Nothing new in that photo — your list is unchanged.');
      }
    } catch (err: any) {
      setInlineNote(err?.message ?? "Couldn't read that photo. Try again.");
    } finally {
      setAddingPhoto(false);
    }
  };

  const chooseAddPhotoSource = () => {
    Alert.alert('Add a photo', 'Another angle of the same meal — sides, drinks, anything cut off.', [
      { text: 'Take photo', onPress: () => void addPhoto('camera') },
      { text: 'From library', onPress: () => void addPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // "Missed anything?" / "+ Add item" — the text parse path, appended as items.
  const addText = async (text: string) => {
    setAddingText(true);
    setInlineNote(null);
    try {
      const res = await nutritionApi.parseMeal(text);
      setItems((cur) => mergeItems(cur ?? [], itemsFromParse(res, text)));
      Haptics.selectionAsync().catch(() => {});
    } catch (err: any) {
      setInlineNote(err?.message ?? "Couldn't add that. Try rephrasing.");
    } finally {
      setAddingText(false);
    }
  };

  const pick = async (kind: 'camera' | 'library') => {
    if (photoV2) { await pickV2(kind); return; }
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
      setParsedDetail(meal);
      const next: ParsedMeal = {
        name: String(meal?.name ?? 'Meal'),
        calories: Number(meal?.calories) || 0,
        proteinG: Number(meal?.proteinG) || 0,
        carbsG:   Number(meal?.carbsG)   || 0,
        fatG:     Number(meal?.fatG)     || 0,
        raw: res,
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
    if (photoV2 && items) { await logItems(); return; }
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
        ...richLogFields(parsed.raw, 'photo'),
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

  // mealPhotoV2 log: totals are the sum of the (edited) items; the itemised
  // breakdown rides as ingredients / ingredientNutrients (+ items).
  const logItems = async () => {
    if (!parsed || !items) return;
    if (!items.length) { setError('Add at least one item before logging.'); return; }
    const t = totalsOf(items);
    setStage('saving');
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: parsed.name.trim() || mealNameFrom(items),
        mealType: slot,
        calories: t.calories,
        proteinG: t.proteinG,
        carbsG: t.carbsG,
        fatG: t.fatG,
        ...richLogFields(parsed.raw, 'photo'),
        ...itemLogFields(items) as any,
      });
      Analytics.foodScannedLogged({ calories: t.calories });
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
      title={stage === 'capture' ? 'Snap a meal' : stage === 'analyzing' ? 'Reading photo…' : photoV2 && items ? 'Review items' : 'Review macros'}
      subtitle={stage === 'capture'
        ? 'Anakin uses Vision to estimate macros from a photo.'
        : stage === 'review'
          ? (photoV2 && items ? undefined : 'Tweak any value before logging.')
          : undefined}
      dismissOnBackdrop={stage !== 'analyzing' && stage !== 'saving' && !addingPhoto}
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
          {photoV2 ? (
            <View style={styles.framingHint} accessibilityRole="text">
              <Ionicons name="scan-outline" size={16} color={colors.mutedForeground} />
              <Text style={styles.framingHintText}>Shoot from above · include sides & drinks. Pick up to 3 photos of one meal.</Text>
            </View>
          ) : null}
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

      {stage === 'review' && parsed && photoV2 && items && (
        <View>
          <View style={styles.thumbRow}>
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.thumb} /> : null}
            {extraUris.map((u) => <Image key={u} source={{ uri: u }} style={styles.thumb} />)}
            {addingPhoto ? <View style={[styles.thumb, styles.thumbBusy]}><ActivityIndicator color={colors.foreground} /></View> : null}
          </View>
          <TextInput
            style={styles.nameInput}
            value={parsed.name}
            onChangeText={(t) => setParsed({ ...parsed, name: t })}
            placeholder="Meal name"
            accessibilityLabel="Meal name"
          />
          {framingWarning ? (
            <View style={styles.nudge}>
              <Ionicons name="crop-outline" size={16} color={colors.foreground} />
              <Text style={styles.nudgeText}>{framingWarning}</Text>
              <TouchableOpacity onPress={chooseAddPhotoSource} disabled={addingPhoto} accessibilityRole="button">
                <Text style={styles.nudgeAction}>Add photo</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={{ marginTop: 12 }}>
            <MealItemsReview items={items} onChange={setItems} onAddText={addText} addingText={addingText} />
          </View>
          {inlineNote ? <Text style={styles.inlineNote}>{inlineNote}</Text> : null}
          <MicroPreview raw={parsed.raw} />

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
                <Text style={[styles.slotChipText, slot === s.key && styles.slotChipTextOn]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.ghost} onPress={chooseAddPhotoSource} disabled={addingPhoto} accessibilityRole="button" accessibilityLabel="Add another photo of this meal">
              <Text style={styles.ghostText}>{addingPhoto ? 'Reading…' : '+ Add photo'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primary, (addingPhoto || !items.length) && { opacity: 0.5 }]} onPress={log} disabled={addingPhoto || !items.length} accessibilityRole="button" accessibilityLabel="Log meal">
              <Text style={styles.primaryText}>Log meal · {totalsOf(items).calories} kcal</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={retake} disabled={addingPhoto} style={styles.retakeLink} accessibilityRole="button">
            <Text style={styles.retakeLinkText}>Retake</Text>
          </TouchableOpacity>
        </View>
      )}

      {stage === 'review' && parsed && !(photoV2 && items) && (
        <ReviewStage
          imageUri={imageUri}
          meal={parsed}
          setMeal={setParsed}
          slot={slot}
          setSlot={setSlot}
          error={error}
          detail={parsed?.raw}
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
  imageUri, meal, setMeal, slot, setSlot, error, onLog, onRetake, detail,
}: {
  detail?: any;
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
      <MicroPreview raw={detail} />

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
  // mealPhotoV2
  framingHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 4 },
  framingHintText: { flex: 1, fontSize: 12, color: colors.mutedForeground, lineHeight: 17 },
  thumbRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.muted },
  thumbBusy: { alignItems: 'center', justifyContent: 'center' },
  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 10,
    borderRadius: 10, backgroundColor: '#fef3c7',
  },
  nudgeText: { flex: 1, fontSize: 12.5, color: colors.foreground, lineHeight: 17 },
  nudgeAction: { fontSize: 12.5, fontWeight: fontWeight.bold, color: colors.foreground, textDecorationLine: 'underline' },
  inlineNote: { fontSize: 12, color: colors.mutedForeground, marginTop: 8 },
  retakeLink: { alignSelf: 'center', paddingVertical: 10, marginTop: 2 },
  retakeLinkText: { fontSize: 12.5, color: colors.mutedForeground, textDecorationLine: 'underline' },
});
