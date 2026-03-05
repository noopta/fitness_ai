import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { liftCoachApi } from '../../src/lib/api';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '../../src/components/ui/Card';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';

const LIFTS = [
  { id: 'flat_bench_press', name: 'Flat Bench Press', icon: 'barbell-outline' },
  { id: 'incline_bench_press', name: 'Incline Bench Press', icon: 'barbell-outline' },
  { id: 'deadlift', name: 'Deadlift', icon: 'barbell-outline' },
  { id: 'barbell_back_squat', name: 'Back Squat', icon: 'barbell-outline' },
  { id: 'barbell_front_squat', name: 'Front Squat', icon: 'barbell-outline' },
  { id: 'clean_and_jerk', name: 'Clean & Jerk', icon: 'flash-outline' },
  { id: 'snatch', name: 'Snatch', icon: 'flash-outline' },
  { id: 'power_clean', name: 'Power Clean', icon: 'flash-outline' },
  { id: 'hang_clean', name: 'Hang Clean', icon: 'flash-outline' },
];

const LIFT_EXERCISES: Record<string, Array<{ id: string; name: string }>> = {
  flat_bench_press: [
    { id: 'flat_bench_press', name: 'Flat Bench Press' },
    { id: 'paused_bench_press', name: 'Paused Bench Press' },
    { id: 'close_grip_bench_press', name: 'Close Grip Bench Press' },
    { id: 'incline_dumbbell_press', name: 'Incline DB Press' },
    { id: 'overhead_press', name: 'Overhead Press' },
    { id: 'tricep_pushdown', name: 'Tricep Pushdown' },
  ],
  incline_bench_press: [
    { id: 'incline_bench_press', name: 'Incline Bench Press' },
    { id: 'flat_bench_press', name: 'Flat Bench Press' },
    { id: 'incline_dumbbell_press', name: 'Incline DB Press' },
    { id: 'overhead_press', name: 'Overhead Press' },
  ],
  deadlift: [
    { id: 'deadlift', name: 'Deadlift' },
    { id: 'romanian_deadlift', name: 'Romanian Deadlift' },
    { id: 'rack_pull', name: 'Rack Pull' },
    { id: 'barbell_row', name: 'Barbell Row' },
    { id: 'leg_press', name: 'Leg Press' },
  ],
  barbell_back_squat: [
    { id: 'barbell_back_squat', name: 'Back Squat' },
    { id: 'front_squat', name: 'Front Squat' },
    { id: 'leg_press', name: 'Leg Press' },
    { id: 'romanian_deadlift', name: 'Romanian Deadlift' },
    { id: 'leg_extension', name: 'Leg Extension' },
  ],
  barbell_front_squat: [
    { id: 'barbell_front_squat', name: 'Front Squat' },
    { id: 'barbell_back_squat', name: 'Back Squat' },
    { id: 'leg_press', name: 'Leg Press' },
    { id: 'goblet_squat', name: 'Goblet Squat' },
  ],
  clean_and_jerk: [
    { id: 'clean_and_jerk', name: 'Clean & Jerk' },
    { id: 'power_clean', name: 'Power Clean' },
    { id: 'front_squat', name: 'Front Squat' },
    { id: 'push_press', name: 'Push Press' },
  ],
  snatch: [
    { id: 'snatch', name: 'Snatch' },
    { id: 'overhead_squat', name: 'Overhead Squat' },
    { id: 'snatch_pull', name: 'Snatch Pull' },
  ],
  power_clean: [
    { id: 'power_clean', name: 'Power Clean' },
    { id: 'hang_power_clean', name: 'Hang Power Clean' },
    { id: 'front_squat', name: 'Front Squat' },
  ],
  hang_clean: [
    { id: 'hang_clean', name: 'Hang Clean' },
    { id: 'power_clean', name: 'Power Clean' },
    { id: 'front_squat', name: 'Front Squat' },
  ],
};

interface ExerciseRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  weight: string;
  sets: string;
  reps: string;
  rpe: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export default function SnapshotScreen() {
  const router = useRouter();

  const [rows, setRows] = useState<ExerciseRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [selectedLift, setSelectedLift] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickingRowId, setPickingRowId] = useState<string | null>(null);

  useEffect(() => {
    loadFromStorage();
  }, []);

  async function loadFromStorage() {
    try {
      const [sid, lift] = await Promise.all([
        AsyncStorage.getItem('axiom_session_id'),
        AsyncStorage.getItem('axiom_selected_lift'),
      ]);

      const liftId = lift || '';
      setSessionId(sid || '');
      setSelectedLift(liftId);

      // Initialize first row with primary lift exercise
      const exercises = LIFT_EXERCISES[liftId] || [];
      const firstExercise = exercises[0];
      if (firstExercise) {
        setRows([
          {
            id: generateId(),
            exerciseId: firstExercise.id,
            exerciseName: firstExercise.name,
            weight: '',
            sets: '',
            reps: '',
            rpe: '',
          },
        ]);
      } else {
        setRows([
          {
            id: generateId(),
            exerciseId: '',
            exerciseName: '',
            weight: '',
            sets: '',
            reps: '',
            rpe: '',
          },
        ]);
      }
    } catch {
      // Ignore
    }
  }

  function updateRow(id: string, field: keyof ExerciseRow, value: string) {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: generateId(),
        exerciseId: '',
        exerciseName: '',
        weight: '',
        sets: '',
        reps: '',
        rpe: '',
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  function openPicker(rowId: string) {
    setPickingRowId(rowId);
    setShowPicker(true);
  }

  function selectExercise(exercise: { id: string; name: string }) {
    if (pickingRowId) {
      setRows((prev) =>
        prev.map((row) =>
          row.id === pickingRowId
            ? { ...row, exerciseId: exercise.id, exerciseName: exercise.name }
            : row
        )
      );
    }
    setShowPicker(false);
    setPickingRowId(null);
  }

  async function handleContinue() {
    // Validate
    const invalid = rows.some((r) => !r.weight || !r.sets || !r.reps);
    if (invalid) {
      Alert.alert('Missing Data', 'Please fill in weight, sets, and reps for each exercise.');
      return;
    }

    if (!sessionId) {
      Alert.alert('Error', 'Session not found. Please start over.');
      return;
    }

    setLoading(true);
    try {
      const snapshots = rows.map((row) => ({
        exerciseId: row.exerciseId || row.exerciseName,
        weight: parseFloat(row.weight),
        sets: parseInt(row.sets, 10),
        reps: parseInt(row.reps, 10),
        rpe: row.rpe ? parseFloat(row.rpe) : undefined,
        date: new Date().toISOString(),
      }));

      await liftCoachApi.addSnapshots(sessionId, snapshots);
      router.push('/diagnostic/chat');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save snapshots. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const availableExercises = LIFT_EXERCISES[selectedLift] || [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'Log Exercises' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Tips Card */}
          <Card style={styles.tipsCard}>
            <CardHeader>
              <CardTitle style={styles.tipsTitle}>
                <Ionicons name="bulb-outline" size={16} color={colors.warning} />
                {' '}Make your diagnosis more accurate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.tipText}>• Log your primary lift and 2-3 key accessories</Text>
              <Text style={styles.tipText}>• Use weights from your last training session</Text>
              <Text style={styles.tipText}>• RPE (Rate of Perceived Exertion, 1-10) is optional but helpful</Text>
            </CardContent>
          </Card>

          {/* Exercise Rows */}
          {rows.map((row, index) => (
            <Card key={row.id} style={styles.rowCard}>
              <View style={styles.rowCardInner}>
                {/* Row header: exercise picker + remove */}
                <View style={styles.rowHeader}>
                  <Pressable
                    style={styles.exercisePicker}
                    onPress={() => openPicker(row.id)}
                  >
                    <Text
                      style={[
                        styles.exercisePickerText,
                        !row.exerciseName && styles.exercisePickerPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {row.exerciseName || 'Select exercise...'}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
                  </Pressable>

                  {rows.length > 1 && (
                    <Pressable
                      onPress={() => removeRow(row.id)}
                      style={styles.removeBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                </View>

                {/* Inputs row */}
                <View style={styles.inputsRow}>
                  <Input
                    label="Weight"
                    placeholder="lbs"
                    value={row.weight}
                    onChangeText={(v) => updateRow(row.id, 'weight', v)}
                    keyboardType="numeric"
                    containerStyle={styles.smallInput}
                    style={styles.smallInputField}
                  />
                  <Input
                    label="Sets"
                    placeholder="3"
                    value={row.sets}
                    onChangeText={(v) => updateRow(row.id, 'sets', v)}
                    keyboardType="numeric"
                    containerStyle={styles.smallInput}
                    style={styles.smallInputField}
                  />
                  <Input
                    label="Reps"
                    placeholder="5"
                    value={row.reps}
                    onChangeText={(v) => updateRow(row.id, 'reps', v)}
                    keyboardType="numeric"
                    containerStyle={styles.smallInput}
                    style={styles.smallInputField}
                  />
                  <Input
                    label="RPE"
                    placeholder="8"
                    value={row.rpe}
                    onChangeText={(v) => updateRow(row.id, 'rpe', v)}
                    keyboardType="numeric"
                    containerStyle={styles.smallInput}
                    style={styles.smallInputField}
                  />
                </View>
              </View>
            </Card>
          ))}

          {/* Add Exercise Button */}
          <Button
            variant="outline"
            onPress={addRow}
            fullWidth
            style={styles.addBtn}
          >
            + Add Exercise
          </Button>

          {/* Continue Button */}
          <Button
            onPress={handleContinue}
            loading={loading}
            fullWidth
            size="lg"
            style={styles.continueBtn}
          >
            Continue
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Exercise Picker Modal */}
      <Modal
        visible={showPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Exercise</Text>
              <Pressable onPress={() => setShowPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={colors.foreground} />
              </Pressable>
            </View>
            <FlatList
              data={availableExercises}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.exerciseOption}
                  onPress={() => selectExercise(item)}
                >
                  <Text style={styles.exerciseOptionText}>{item.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },

  tipsCard: {
    marginBottom: spacing.xs,
  },
  tipsTitle: {
    fontSize: fontSize.base,
  },
  tipText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 22,
  },

  rowCard: {
    overflow: 'visible',
  },
  rowCardInner: {
    padding: 10,
    gap: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  exercisePicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.muted,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exercisePickerText: {
    fontSize: fontSize.base,
    color: colors.foreground,
    flex: 1,
  },
  exercisePickerPlaceholder: {
    color: colors.mutedForeground,
  },
  removeBtn: {
    padding: 2,
  },
  inputsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  smallInput: {
    flex: 1,
  },
  smallInputField: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 9,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },

  addBtn: {
    marginTop: spacing.xs,
  },
  continueBtn: {
    marginTop: spacing.sm,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '70%',
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  exerciseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  exerciseOptionText: {
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
});
