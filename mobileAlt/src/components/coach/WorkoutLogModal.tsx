import React, { useState, useEffect } from 'react';
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
  FlatList,
} from 'react-native';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.88;
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, radius } from '../../constants/theme';
import { workoutsApi } from '../../lib/api';
import { useUnits } from '../../context/UnitsContext';

// ─── Exercise suggestions ──────────────────────────────────────────────────────

const COMMON_EXERCISES = [
  'Back Squat', 'Front Squat', 'Goblet Squat', 'Bulgarian Split Squat', 'Leg Press',
  'Leg Extension', 'Leg Curl', 'Romanian Deadlift', 'Conventional Deadlift', 'Sumo Deadlift',
  'Trap Bar Deadlift', 'Hip Thrust', 'Glute Bridge', 'Lunge', 'Step Up',
  'Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Dumbbell Bench Press',
  'Incline Dumbbell Press', 'Overhead Press', 'Arnold Press', 'Lateral Raise',
  'Front Raise', 'Cable Lateral Raise', 'Chest Fly', 'Cable Fly', 'Pec Deck',
  'Pull Up', 'Chin Up', 'Lat Pulldown', 'Seated Row', 'Bent Over Row',
  'Single Arm Row', 'T-Bar Row', 'Cable Row', 'Face Pull', 'Rear Delt Fly',
  'Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Cable Curl',
  'Tricep Pushdown', 'Skull Crusher', 'Close Grip Bench Press', 'Overhead Tricep Extension',
  'Dips', 'Push Up', 'Diamond Push Up', 'Pike Push Up',
  'Plank', 'Side Plank', 'Dead Bug', 'Pallof Press', 'Ab Wheel',
  'Crunches', 'Leg Raise', 'Russian Twist', 'Cable Crunch',
  'Calf Raise', 'Seated Calf Raise', 'Shrug', 'Upright Row',
  'Power Clean', 'Hang Clean', 'Snatch', 'Push Press', 'Push Jerk',
  'Farmer Carry', 'Sled Push', 'Battle Ropes', 'Box Jump', 'Jump Squat',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseEntry {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  rpe: string;
  notes: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  todayExercises?: Array<{ exercise?: string; name?: string; sets?: number; reps?: string | number }>;
  date?: string;
  workoutTitle?: string;
}

function emptyExercise(): ExerciseEntry {
  return { name: '', sets: '', reps: '', weight: '', rpe: '', notes: '' };
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildInitialExercises(
  todayExercises?: Props['todayExercises'],
): ExerciseEntry[] {
  if (todayExercises && todayExercises.length > 0) {
    return todayExercises.map(ex => ({
      name: ex.exercise ?? ex.name ?? '',
      sets: ex.sets ? String(ex.sets) : '',
      reps: ex.reps ? String(ex.reps) : '',
      weight: '',
      rpe: '',
      notes: '',
    }));
  }
  return [emptyExercise()];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkoutLogModal({ visible, onClose, onSaved, todayExercises, date, workoutTitle }: Props) {
  const { unit, toKg } = useUnits();
  const [saving, setSaving] = useState(false);
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [exercises, setExercises] = useState<ExerciseEntry[]>(() => buildInitialExercises(todayExercises));
  const [focusedExIndex, setFocusedExIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Reset state every time modal opens
  useEffect(() => {
    if (visible) {
      setExercises(buildInitialExercises(todayExercises));
      setWorkoutNotes('');
      setDuration('');
      setSuggestions([]);
      setFocusedExIndex(null);
    }
  }, [visible]);

  function updateExercise(index: number, field: keyof ExerciseEntry, value: string) {
    setExercises(prev => prev.map((ex, i) => i === index ? { ...ex, [field]: value } : ex));
    if (field === 'name') {
      if (value.length >= 2) {
        const q = value.toLowerCase();
        setSuggestions(
          COMMON_EXERCISES.filter(e => e.toLowerCase().includes(q)).slice(0, 5)
        );
      } else {
        setSuggestions([]);
      }
    }
  }

  function pickSuggestion(index: number, name: string) {
    setExercises(prev => prev.map((ex, i) => i === index ? { ...ex, name } : ex));
    setSuggestions([]);
  }

  function addExercise() {
    setExercises(prev => [...prev, emptyExercise()]);
  }

  function removeExercise(index: number) {
    if (exercises.length === 1) return;
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
          weightKg: ex.weight ? toKg(parseFloat(ex.weight)) : null,
          rpe: ex.rpe ? parseFloat(ex.rpe) : null,
          notes: ex.notes.trim() || null,
        })),
        notes: workoutNotes.trim() || undefined,
        duration: duration ? parseInt(duration, 10) : undefined,
      });
      onClose();
      onSaved();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save workout. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.kavWrapper}
        behavior={Platform.OS === 'ios' ? 'height' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
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
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
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

                {/* Exercise name with autocomplete */}
                <View>
                  <TextInput
                    style={styles.input}
                    placeholder="Exercise name"
                    placeholderTextColor={colors.mutedForeground}
                    value={ex.name}
                    onChangeText={v => updateExercise(i, 'name', v)}
                    onFocus={() => setFocusedExIndex(i)}
                    onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                    returnKeyType="done"
                  />
                  {focusedExIndex === i && suggestions.length > 0 && (
                    <View style={styles.suggestionList}>
                      {suggestions.map((s) => (
                        <TouchableOpacity
                          key={s}
                          style={styles.suggestionItem}
                          onPress={() => pickSuggestion(i, s)}
                        >
                          <Ionicons name="fitness-outline" size={12} color={colors.mutedForeground} style={{ marginRight: 6 }} />
                          <Text style={styles.suggestionText}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

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
                    <Text style={styles.inlineLabel}>Weight ({unit})</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={unit === 'lbs' ? '175' : '80'}
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      value={ex.weight}
                      onChangeText={v => updateExercise(i, 'weight', v)}
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

            <TouchableOpacity style={styles.addExBtn} onPress={addExercise}>
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.addExText}>Add Exercise</Text>
            </TouchableOpacity>

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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SHEET_HEIGHT,
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
  headerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  headerSub: { fontSize: fontSize.xs, color: colors.mutedForeground },
  closeBtn: { padding: spacing.xs },
  body: { flex: 1, minHeight: 0 },
  bodyContent: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: fontSize.sm, color: colors.foreground, fontWeight: fontWeight.medium },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, marginTop: spacing.xs },
  exerciseBlock: {
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  exerciseHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  exerciseNum: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  inputSmall: { width: 80, textAlign: 'center' },
  suggestionList: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginTop: 2,
    overflow: 'hidden',
    zIndex: 100,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionText: { fontSize: fontSize.sm, color: colors.foreground },
  inlineRow: { flexDirection: 'row', gap: spacing.xs },
  inlineField: { flex: 1 },
  inlineLabel: { fontSize: 10, color: colors.mutedForeground, marginBottom: 2 },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  addExBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.primary, borderRadius: radius.lg, paddingVertical: 10,
  },
  addExText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, backgroundColor: colors.primary,
    borderRadius: radius.lg, paddingVertical: 14, marginTop: spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: '#fff' },
});
