import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { liftCoachApi, storage } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

type SnapshotRow = {
  id: string;
  exercise: string;
  weight: string;
  sets: string;
  reps: string;
  rpe: string;
};

const liftExerciseMap: Record<string, string[]> = {
  flat_bench_press: [
    'Flat Bench Press', 'Close-Grip Bench Press', 'Incline Bench Press',
    'Dumbbell Bench Press', 'Overhead Press', 'Dips', 'Rope Pressdown',
    'Chest-Supported Row', 'Barbell Row', 'Face Pull', 'Lateral Raise',
  ],
  incline_bench_press: [
    'Incline Bench Press', 'Flat Bench Press', 'Dumbbell Incline Press',
    'Overhead Press', 'Close-Grip Bench Press', 'Dips', 'Rope Pressdown',
    'Lateral Raise', 'Face Pull', 'Chest-Supported Row',
  ],
  deadlift: [
    'Deadlift', 'Romanian Deadlift', 'Rack Pull', 'Deficit Deadlift',
    'Barbell Row', 'Lat Pulldown', 'Pull-Up', 'Leg Curl',
    'Hip Thrust', 'Good Morning', 'Back Extension',
  ],
  barbell_back_squat: [
    'Barbell Back Squat', 'Pause Squat', 'Front Squat', 'Leg Press',
    'Bulgarian Split Squat', 'Leg Extension', 'Leg Curl',
    'Romanian Deadlift', 'Hip Thrust', 'Goblet Squat',
  ],
  barbell_front_squat: [
    'Barbell Front Squat', 'Barbell Back Squat', 'Pause Squat',
    'Leg Press', 'Bulgarian Split Squat', 'Leg Extension',
    'Goblet Squat', 'Leg Curl',
  ],
};

const defaultExercises = [
  'Flat Bench Press', 'Incline Bench Press', 'Deadlift',
  'Barbell Back Squat', 'Overhead Press',
];

export default function SnapshotScreen() {
  const router = useRouter();
  const [selectedLift, setSelectedLift] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SnapshotRow[]>([
    { id: 'row-1', exercise: '', weight: '', sets: '', reps: '', rpe: '' },
    { id: 'row-2', exercise: '', weight: '', sets: '', reps: '', rpe: '' },
  ]);
  const [showExercisePicker, setShowExercisePicker] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const lift = await storage.get('liftoff_selected_lift');
      const targetWeight = await storage.get('liftoff_target_lift_weight');
      const targetSets = await storage.get('liftoff_target_lift_sets');
      const targetReps = await storage.get('liftoff_target_lift_reps');

      if (lift) {
        setSelectedLift(lift);
        const liftName = lift.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        setRows([
          {
            id: 'row-main',
            exercise: liftName,
            weight: targetWeight || '',
            sets: targetSets || '',
            reps: targetReps || '',
            rpe: '',
          },
          { id: 'row-2', exercise: '', weight: '', sets: '', reps: '', rpe: '' },
        ]);
      }
    })();
  }, []);

  const exerciseOptions = useMemo(() => {
    if (selectedLift && liftExerciseMap[selectedLift]) {
      return liftExerciseMap[selectedLift];
    }
    return defaultExercises;
  }, [selectedLift]);

  function addRow() {
    setRows(prev => [
      ...prev,
      { id: `row-${Date.now()}`, exercise: '', weight: '', sets: '', reps: '', rpe: '' },
    ]);
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
  }

  function updateRow(id: string, field: keyof SnapshotRow, value: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function handleContinue() {
    const sessionId = await storage.get('liftoff_session_id');
    if (!sessionId) {
      Alert.alert('Error', 'No session found. Please start over.');
      router.replace('/diagnostic/onboarding');
      return;
    }

    const validRows = rows.filter(r => r.exercise && r.weight && r.sets && r.reps);
    if (validRows.length === 0) {
      Alert.alert('Error', 'Please enter at least one exercise with weight, sets, and reps.');
      return;
    }

    setLoading(true);
    try {
      const snapshots = validRows.map(row => ({
        exerciseId: row.exercise.toLowerCase().replace(/\s+/g, '_'),
        weight: parseFloat(row.weight),
        weightUnit: 'lbs' as const,
        sets: parseInt(row.sets, 10),
        reps: parseInt(row.reps, 10),
        rpe: row.rpe ? parseFloat(row.rpe) : undefined,
        date: new Date().toISOString().split('T')[0],
      }));

      const invalid = snapshots.find(s => isNaN(s.weight) || isNaN(s.reps) || isNaN(s.sets));
      if (invalid) {
        Alert.alert('Error', 'Please enter valid numbers for weight, sets, and reps.');
        setLoading(false);
        return;
      }

      await liftCoachApi.addSnapshots(sessionId, snapshots);
      router.push('/diagnostic/chat');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save snapshot');
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.navCenter}>
            <Text style={styles.navTitle}>Step 2 of 4</Text>
            <Text style={styles.navSubtitle}>Strength Snapshot</Text>
          </View>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Card style={styles.mainCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeader}>
                <View style={styles.iconBox}>
                  <Ionicons name="barbell" size={16} color={colors.primary} />
                </View>
                <View>
                  <Text style={styles.eyebrow}>Snapshot</Text>
                  <Text style={styles.cardTitle}>Your Relevant Lifts</Text>
                </View>
              </View>
              <Button variant="secondary" size="sm" onPress={addRow}>
                + Add
              </Button>
            </View>

            {rows.map((row, idx) => (
              <View key={row.id} style={styles.exerciseRow}>
                <TouchableOpacity
                  style={styles.exercisePicker}
                  onPress={() => setShowExercisePicker(row.id)}
                >
                  <Text style={row.exercise ? styles.exercisePickerText : styles.exercisePickerPlaceholder}>
                    {row.exercise || 'Choose exercise'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>

                <View style={styles.inputGrid}>
                  <Input
                    placeholder="lbs"
                    value={row.weight}
                    onChangeText={(v) => updateRow(row.id, 'weight', v)}
                    keyboardType="numeric"
                    containerStyle={{ flex: 1 }}
                  />
                  <Input
                    placeholder="sets"
                    value={row.sets}
                    onChangeText={(v) => updateRow(row.id, 'sets', v)}
                    keyboardType="numeric"
                    containerStyle={{ flex: 1 }}
                  />
                  <Input
                    placeholder="reps"
                    value={row.reps}
                    onChangeText={(v) => updateRow(row.id, 'reps', v)}
                    keyboardType="numeric"
                    containerStyle={{ flex: 1 }}
                  />
                  {rows.length > 1 && (
                    <TouchableOpacity onPress={() => removeRow(row.id)} style={styles.removeBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}

            <View style={styles.tipRow}>
              <Badge variant="secondary">Tip</Badge>
              <Text style={styles.tipText}>
                If you're unsure, just enter your top set for each movement.
              </Text>
            </View>
          </Card>

          <Card style={styles.qualityCard}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBox}>
                <Ionicons name="speedometer" size={16} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.eyebrow}>Quality</Text>
                <Text style={styles.cardTitle}>Make the diagnosis easier</Text>
              </View>
            </View>

            {[
              'We\'ve curated a list of exercises related to your selected lift',
              'Fill in as many as possible with your current working weight, sets, and reps',
              'This gives our AI context about your strengths in different muscle groups',
              'Add RPE/RIR when you can for better accuracy',
            ].map((text, idx) => (
              <View key={idx} style={styles.qualityRow}>
                <View style={styles.qualityNum}>
                  <Text style={styles.qualityNumText}>{idx + 1}</Text>
                </View>
                <Text style={styles.qualityText}>{text}</Text>
              </View>
            ))}
          </Card>

          <Button
            onPress={handleContinue}
            loading={loading}
            size="lg"
            style={{ marginBottom: 32 }}
          >
            {loading ? 'Saving...' : 'Continue'}
          </Button>
        </ScrollView>

        {showExercisePicker && (
          <View style={styles.pickerOverlay}>
            <TouchableOpacity
              style={styles.pickerBackdrop}
              onPress={() => setShowExercisePicker(null)}
            />
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Choose Exercise</Text>
                <TouchableOpacity onPress={() => setShowExercisePicker(null)}>
                  <Ionicons name="close" size={24} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.pickerList}>
                {exerciseOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={styles.pickerItem}
                    onPress={() => {
                      updateRow(showExercisePicker!, 'exercise', opt);
                      setShowExercisePicker(null);
                    }}
                  >
                    <Text style={styles.pickerItemText}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navCenter: { alignItems: 'center' },
  navTitle: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  navSubtitle: { color: colors.mutedForeground, fontSize: fontSize.xs, marginTop: 2 },
  scrollContent: { padding: spacing.lg },
  mainCard: { marginBottom: 16 },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 36, height: 36, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { color: colors.mutedForeground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  cardTitle: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, marginTop: 2 },
  exerciseRow: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: 12, marginBottom: 10,
    backgroundColor: colors.secondary,
  },
  exercisePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, marginBottom: 8,
  },
  exercisePickerText: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  exercisePickerPlaceholder: { color: colors.mutedForeground, fontSize: fontSize.base },
  inputGrid: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  removeBtn: {
    width: 40, height: 44,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md,
  },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  tipText: { color: colors.mutedForeground, fontSize: fontSize.sm, flex: 1 },
  qualityCard: { marginBottom: 16 },
  qualityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  qualityNum: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  qualityNumText: { color: colors.foreground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  qualityText: { color: colors.mutedForeground, fontSize: fontSize.sm, flex: 1, lineHeight: 18 },
  pickerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
  },
  pickerBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  pickerSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    maxHeight: '60%', paddingBottom: 40,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerTitle: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  pickerList: { paddingHorizontal: spacing.lg },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerItemText: { color: colors.foreground, fontSize: fontSize.base },
});
