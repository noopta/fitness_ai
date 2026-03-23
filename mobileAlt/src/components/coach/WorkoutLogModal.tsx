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

const SHEET_HEIGHT = Dimensions.get('window').height * 0.88;
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, radius } from '../../constants/theme';
import { workoutsApi } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseEntry {
  name: string;
  sets: string;
  reps: string;
  weightKg: string;
  rpe: string;
  notes: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-fill exercises from today's program (optional) */
  todayExercises?: Array<{ exercise?: string; name?: string; sets?: number; reps?: string | number }>;
  /** Today's date in YYYY-MM-DD */
  date?: string;
  /** Today's workout title */
  workoutTitle?: string;
}

function emptyExercise(): ExerciseEntry {
  return { name: '', sets: '', reps: '', weightKg: '', rpe: '', notes: '' };
}

function todayDateStr() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkoutLogModal({ visible, onClose, onSaved, todayExercises, date, workoutTitle }: Props) {
  const [saving, setSaving] = useState(false);
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [duration, setDuration] = useState('');

  // Pre-fill exercises from program or start with one blank
  const [exercises, setExercises] = useState<ExerciseEntry[]>(() => {
    if (todayExercises && todayExercises.length > 0) {
      return todayExercises.map(ex => ({
        name: ex.exercise ?? ex.name ?? '',
        sets: ex.sets ? String(ex.sets) : '',
        reps: ex.reps ? String(ex.reps) : '',
        weightKg: '',
        rpe: '',
        notes: '',
      }));
    }
    return [emptyExercise()];
  });

  function updateExercise(index: number, field: keyof ExerciseEntry, value: string) {
    setExercises(prev => prev.map((ex, i) => i === index ? { ...ex, [field]: value } : ex));
  }

  function addExercise() {
    setExercises(prev => [...prev, emptyExercise()]);
  }

  function removeExercise(index: number) {
    if (exercises.length === 1) return; // keep at least one
    setExercises(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const validExercises = exercises.filter(ex => ex.name.trim() && ex.sets && ex.reps);
    if (validExercises.length === 0) {
      Alert.alert('Missing Info', 'Please fill in at least one exercise with name, sets, and reps.');
      return;
    }

    setSaving(true);
    try {
      await workoutsApi.logWorkout({
        date: date ?? todayDateStr(),
        title: workoutTitle || undefined,
        exercises: validExercises.map(ex => ({
          name: ex.name.trim(),
          sets: parseInt(ex.sets, 10) || 1,
          reps: ex.reps.trim(),
          weightKg: ex.weightKg ? parseFloat(ex.weightKg) / 2.205 : null,
          rpe: ex.rpe ? parseFloat(ex.rpe) : null,
          notes: ex.notes.trim() || null,
        })),
        notes: workoutNotes.trim() || undefined,
        duration: duration ? parseInt(duration, 10) : undefined,
      });
      handleClose();
      onSaved();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save workout. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    onClose();
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
              <Ionicons name="barbell-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerTitle}>Log Workout</Text>
              <Text style={styles.headerSub}>
                {workoutTitle ? workoutTitle : "Record today's session"}
              </Text>
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
            {/* Duration */}
            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Duration (min)</Text>
              <TextInput
                style={[styles.input, styles.inputSmall]}
                placeholder="60"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
                value={duration}
                onChangeText={setDuration}
              />
            </View>

            {/* Exercises */}
            <Text style={styles.sectionTitle}>Exercises</Text>
            {exercises.map((ex, i) => (
              <View key={i} style={styles.exerciseBlock}>
                <View style={styles.exerciseHeaderRow}>
                  <Text style={styles.exerciseNum}>Exercise {i + 1}</Text>
                  {exercises.length > 1 && (
                    <TouchableOpacity onPress={() => removeExercise(i)} style={styles.removeBtn}>
                      <Ionicons name="trash-outline" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                <TextInput
                  style={styles.input}
                  placeholder="Exercise name"
                  placeholderTextColor={colors.mutedForeground}
                  value={ex.name}
                  onChangeText={v => updateExercise(i, 'name', v)}
                />

                <View style={styles.inlineRow}>
                  <View style={styles.inlineField}>
                    <Text style={styles.inlineLabel}>Sets</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="4"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                      value={ex.sets}
                      onChangeText={v => updateExercise(i, 'sets', v)}
                    />
                  </View>
                  <View style={styles.inlineField}>
                    <Text style={styles.inlineLabel}>Reps</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="8"
                      placeholderTextColor={colors.mutedForeground}
                      value={ex.reps}
                      onChangeText={v => updateExercise(i, 'reps', v)}
                    />
                  </View>
                  <View style={styles.inlineField}>
                    <Text style={styles.inlineLabel}>Weight (lbs)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="175"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      value={ex.weightKg}
                      onChangeText={v => updateExercise(i, 'weightKg', v)}
                    />
                  </View>
                  <View style={styles.inlineField}>
                    <Text style={styles.inlineLabel}>RPE</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="8"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      value={ex.rpe}
                      onChangeText={v => updateExercise(i, 'rpe', v)}
                    />
                  </View>
                </View>

                <TextInput
                  style={styles.input}
                  placeholder="Notes (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={ex.notes}
                  onChangeText={v => updateExercise(i, 'notes', v)}
                />
              </View>
            ))}

            {/* Add exercise */}
            <TouchableOpacity style={styles.addExBtn} onPress={addExercise}>
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.addExText}>Add Exercise</Text>
            </TouchableOpacity>

            {/* Bonus workout toggle */}
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>Workout Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="How did it feel? Any PRs? Anything notable..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={workoutNotes}
              onChangeText={setWorkoutNotes}
            />

            {/* Save */}
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
                  <Text style={styles.saveBtnText}>Save Workout</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  kavWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
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
    borderRadius: radius.full,
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
    borderRadius: radius.lg,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: { flex: 1 },
  headerTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  headerSub: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  closeBtn: { padding: spacing.xs },
  body: { flex: 1, minHeight: 0 },
  bodyContent: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    marginTop: spacing.xs,
  },
  exerciseBlock: {
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  exerciseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  exerciseNum: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  removeBtn: { padding: 4 },
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
  inputSmall: {
    width: 80,
    textAlign: 'center',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  inlineField: { flex: 1 },
  inlineLabel: {
    fontSize: 10,
    color: colors.mutedForeground,
    marginBottom: 2,
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  addExBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 10,
  },
  addExText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
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
  saveBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
});
