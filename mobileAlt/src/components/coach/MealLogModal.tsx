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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  return new Date().toISOString().split('T')[0];
}

export function MealLogModal({ visible, onClose, onSaved, prefill, date }: Props) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(prefill?.name ?? '');
  const [mealType, setMealType] = useState<string>(prefill?.mealType ?? 'meal');
  const [calories, setCalories] = useState(prefill?.calories ? String(prefill.calories) : '');
  const [protein, setProtein] = useState(prefill?.proteinG ? String(prefill.proteinG) : '');
  const [carbs, setCarbs] = useState(prefill?.carbsG ? String(prefill.carbsG) : '');
  const [fat, setFat] = useState(prefill?.fatG ? String(prefill.fatG) : '');
  const [notes, setNotes] = useState('');

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
      // Reset form
      setName(''); setMealType('meal'); setCalories(''); setProtein(''); setCarbs(''); setFat(''); setNotes('');
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

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
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
});
