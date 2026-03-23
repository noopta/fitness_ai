import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { colors, spacing, fontSize, fontWeight, radius } from '../../constants/theme';
import { nutritionApi } from '../../lib/api';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.82;

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Breakfast', icon: 'sunny-outline' as const },
  { key: 'lunch', label: 'Lunch', icon: 'partly-sunny-outline' as const },
  { key: 'dinner', label: 'Dinner', icon: 'moon-outline' as const },
  { key: 'snack', label: 'Snack', icon: 'cafe-outline' as const },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-fill from a meal suggestion */
  prefill?: {
    name?: string;
    mealType?: string;
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
  };
  date?: string;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prefillForm(
  result: any,
  setName: (v: string) => void,
  setMealType: (v: string) => void,
  setCalories: (v: string) => void,
  setProtein: (v: string) => void,
  setCarbs: (v: string) => void,
  setFat: (v: string) => void,
  fallbackName?: string,
) {
  setName(result.name ?? fallbackName ?? '');
  setMealType(result.mealType ?? 'meal');
  setCalories(result.calories ? String(Math.round(result.calories)) : '');
  setProtein(result.proteinG ? String(Math.round(result.proteinG)) : '');
  setCarbs(result.carbsG ? String(Math.round(result.carbsG)) : '');
  setFat(result.fatG ? String(Math.round(result.fatG)) : '');
}

export function MealLogModal({ visible, onClose, onSaved, prefill, date }: Props) {
  const [mode, setMode] = useState<'manual' | 'describe' | 'scan'>('manual');
  const [mealDesc, setMealDesc] = useState('');
  const [parsing, setParsing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(prefill?.name ?? '');
  const [mealType, setMealType] = useState<string>(prefill?.mealType ?? 'meal');
  const [calories, setCalories] = useState(prefill?.calories ? String(prefill.calories) : '');
  const [protein, setProtein] = useState(prefill?.proteinG ? String(prefill.proteinG) : '');
  const [carbs, setCarbs] = useState(prefill?.carbsG ? String(prefill.carbsG) : '');
  const [fat, setFat] = useState(prefill?.fatG ? String(prefill.fatG) : '');
  const [notes, setNotes] = useState('');

  async function handleParseMeal() {
    if (mealDesc.trim().length < 3) return;
    setParsing(true);
    try {
      const result = await nutritionApi.parseMeal(mealDesc.trim());
      if (result) {
        prefillForm(result, setName, setMealType, setCalories, setProtein, setCarbs, setFat, mealDesc.trim());
        setMode('manual');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not analyze meal. Try entering manually.');
    } finally {
      setParsing(false);
    }
  }

  async function handlePickPhoto(useCamera: boolean) {
    const permFn = useCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { status } = await permFn();
    if (status !== 'granted') {
      Alert.alert('Permission needed', `Please allow ${useCamera ? 'camera' : 'photo library'} access in Settings.`);
      return;
    }

    const pickFn = useCamera
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

    const result = await pickFn({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    // Compress and resize to ≤1024px
    const compressed = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 1024 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    setPhotoUri(compressed.uri);
    await analyzePhoto(compressed.uri);
  }

  async function analyzePhoto(uri: string) {
    setScanning(true);
    try {
      // Convert to base64
      const response = await fetch(uri);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // strip data:image/jpeg;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const analysisResult = await nutritionApi.analyzePhoto(base64, 'image/jpeg');
      if (analysisResult) {
        prefillForm(analysisResult, setName, setMealType, setCalories, setProtein, setCarbs, setFat);
        setMode('manual');
      }
    } catch (err: any) {
      const msg = err?.message || 'Could not analyze photo.';
      Alert.alert('Analysis failed', `${msg}\n\nTry describing the meal instead.`);
    } finally {
      setScanning(false);
    }
  }

  function handleClose() {
    onClose();
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Missing Info', 'Please enter a meal name.');
      return;
    }

    setSaving(true);
    try {
      await nutritionApi.logMeal({
        date: date ?? todayStr(),
        name: name.trim(),
        mealType: (mealType as any) || 'meal',
        calories: parseFloat(calories) || 0,
        proteinG: parseFloat(protein) || 0,
        carbsG: parseFloat(carbs) || 0,
        fatG: parseFloat(fat) || 0,
        notes: notes.trim() || undefined,
      });
      setName(''); setMealType('meal'); setCalories(''); setProtein(''); setCarbs(''); setFat(''); setNotes('');
      setPhotoUri(null);
      handleClose();
      onSaved();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save meal. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.kavWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.overlay} onPress={handleClose}>
          <View style={styles.spacer} />
        </Pressable>

        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="restaurant-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerTitle}>Log Meal</Text>
              <Text style={styles.headerSub}>Track your nutrition intake</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Mode toggle */}
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'manual' && styles.modeBtnActive]}
              onPress={() => setMode('manual')}
            >
              <Text style={[styles.modeBtnText, mode === 'manual' && styles.modeBtnTextActive]}>Manual</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'describe' && styles.modeBtnActive]}
              onPress={() => setMode('describe')}
            >
              <Ionicons name="sparkles" size={12} color={mode === 'describe' ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.modeBtnText, mode === 'describe' && styles.modeBtnTextActive]}>Describe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'scan' && styles.modeBtnActive]}
              onPress={() => setMode('scan')}
            >
              <Ionicons name="camera-outline" size={12} color={mode === 'scan' ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.modeBtnText, mode === 'scan' && styles.modeBtnTextActive]}>Scan</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Describe mode */}
            {mode === 'describe' && (
              <View style={styles.describeSection}>
                <Text style={styles.describeHint}>
                  Describe what you ate and AI will estimate the macros for you.
                </Text>
                <TextInput
                  style={[styles.input, styles.describeInput]}
                  placeholder={'e.g. "2 scrambled eggs with toast and a glass of OJ"'}
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  value={mealDesc}
                  onChangeText={setMealDesc}
                />
                <TouchableOpacity
                  style={[styles.saveBtn, (parsing || mealDesc.trim().length < 3) && styles.saveBtnDisabled]}
                  onPress={handleParseMeal}
                  disabled={parsing || mealDesc.trim().length < 3}
                >
                  {parsing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={16} color="#fff" />
                      <Text style={styles.saveBtnText}>Analyze Meal</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Scan mode */}
            {mode === 'scan' && (
              <View style={styles.scanSection}>
                <Text style={styles.describeHint}>
                  Take a photo of your meal and Gemini AI will estimate the calories and macros.
                </Text>

                {scanning ? (
                  <View style={styles.scanningBox}>
                    {photoUri && (
                      <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                    )}
                    <View style={styles.scanningOverlay}>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <Text style={styles.scanningText}>Analyzing your meal…</Text>
                    </View>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity style={styles.scanBtn} onPress={() => handlePickPhoto(true)}>
                      <Ionicons name="camera" size={24} color={colors.primary} />
                      <Text style={styles.scanBtnText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.scanBtn, styles.scanBtnSecondary]} onPress={() => handlePickPhoto(false)}>
                      <Ionicons name="images-outline" size={24} color={colors.mutedForeground} />
                      <Text style={[styles.scanBtnText, { color: colors.mutedForeground }]}>Choose from Library</Text>
                    </TouchableOpacity>
                    <Text style={styles.scanTip}>
                      Tip: include a reference object like a fork or plate for better portion estimates.
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Manual mode */}
            {mode === 'manual' && <>
            {/* Meal name */}
            <Text style={styles.fieldLabel}>Meal Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Chicken Rice Bowl"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
            />

            {/* Meal type selector */}
            <Text style={styles.fieldLabel}>Meal Type</Text>
            <View style={styles.typeRow}>
              {MEAL_TYPES.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typeBtn, mealType === t.key && styles.typeBtnActive]}
                  onPress={() => setMealType(t.key)}
                >
                  <Ionicons
                    name={t.icon}
                    size={14}
                    color={mealType === t.key ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={[styles.typeBtnText, mealType === t.key && styles.typeBtnTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Calories */}
            <Text style={styles.sectionTitle}>Nutrition</Text>
            <View style={styles.macroRow}>
              <View style={styles.macroField}>
                <Text style={styles.macroLabel}>Calories</Text>
                <TextInput
                  style={styles.input}
                  placeholder="450"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  value={calories}
                  onChangeText={setCalories}
                />
              </View>
            </View>

            {/* Macros row */}
            <View style={styles.macroRow}>
              <View style={styles.macroField}>
                <Text style={styles.macroLabel}>Protein (g)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="40"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  value={protein}
                  onChangeText={setProtein}
                />
              </View>
              <View style={styles.macroField}>
                <Text style={styles.macroLabel}>Carbs (g)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="50"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  value={carbs}
                  onChangeText={setCarbs}
                />
              </View>
              <View style={styles.macroField}>
                <Text style={styles.macroLabel}>Fat (g)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="15"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  value={fat}
                  onChangeText={setFat}
                />
              </View>
            </View>

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Any notes..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              value={notes}
              onChangeText={setNotes}
            />

            {/* Save button */}
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>Log Meal</Text>
                </>
              )}
            </TouchableOpacity>
            </>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kavWrapper: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  spacer: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: SHEET_HEIGHT,
    paddingBottom: 34,
  },
  handle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  headerIcon: {
    width: 36, height: 36,
    borderRadius: 12,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: { flex: 1 },
  headerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  headerSub: { fontSize: fontSize.xs, color: colors.mutedForeground },
  closeBtn: { padding: spacing.xs },
  body: { flex: 1, minHeight: 0 },
  bodyContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  fieldLabel: {
    fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  typeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  typeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}12`,
  },
  typeBtnText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  typeBtnTextActive: { color: colors.primary, fontWeight: fontWeight.medium },
  macroRow: { flexDirection: 'row', gap: spacing.xs },
  macroField: { flex: 1 },
  macroLabel: { fontSize: 10, color: colors.mutedForeground, marginBottom: 2 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    marginTop: spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: '#fff' },

  // Mode toggle
  modeRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: 3,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  modeBtnActive: { backgroundColor: colors.background },
  modeBtnText: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  modeBtnTextActive: { color: colors.foreground },

  // Describe mode
  describeSection: { gap: spacing.sm },
  describeHint: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 18 },
  describeInput: { minHeight: 90, textAlignVertical: 'top' },

  // Scan mode
  scanSection: { gap: spacing.md },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: `${colors.primary}12`,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 18,
  },
  scanBtnSecondary: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
  },
  scanBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.primary },
  scanTip: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', lineHeight: 18 },
  scanningBox: {
    height: 220,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.muted,
  },
  photoPreview: { width: '100%', height: '100%' },
  scanningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  scanningText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.medium },
});
