import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { liftCoachApi, authApi } from '../../src/lib/api';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';
import { Card } from '../../src/components/ui/Card';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';
import { useAuth } from '../../src/context/AuthContext';

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

type TrainingAge = 'beginner' | 'intermediate' | 'advanced';
type Equipment = 'commercial_gym' | 'limited_equipment' | 'home_gym';

export default function OnboardingScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [selectedLift, setSelectedLift] = useState('');
  const [currentWeight, setCurrentWeight] = useState('');
  const [currentSets, setCurrentSets] = useState('');
  const [currentReps, setCurrentReps] = useState('');
  const [trainingAge, setTrainingAge] = useState<TrainingAge>('intermediate');
  const [equipment, setEquipment] = useState<Equipment>('commercial_gym');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [constraints, setConstraints] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSavedData();
  }, []);

  async function loadSavedData() {
    try {
      const [
        savedLift, savedWeight, savedSets, savedReps,
        savedAge, savedEquipment, savedHtFt, savedHtIn,
        savedWtLbs, savedConstraints,
      ] = await Promise.all([
        AsyncStorage.getItem('axiom_selected_lift'),
        AsyncStorage.getItem('axiom_target_weight'),
        AsyncStorage.getItem('axiom_target_sets'),
        AsyncStorage.getItem('axiom_target_reps'),
        AsyncStorage.getItem('axiom_training_age'),
        AsyncStorage.getItem('axiom_equipment'),
        AsyncStorage.getItem('axiom_height_ft'),
        AsyncStorage.getItem('axiom_height_in'),
        AsyncStorage.getItem('axiom_weight_lbs'),
        AsyncStorage.getItem('axiom_constraints'),
      ]);

      if (savedLift) setSelectedLift(savedLift);
      if (savedWeight) setCurrentWeight(savedWeight);
      if (savedSets) setCurrentSets(savedSets);
      if (savedReps) setCurrentReps(savedReps);
      if (savedAge) setTrainingAge(savedAge as TrainingAge);
      if (savedEquipment) setEquipment(savedEquipment as Equipment);
      if (savedHtFt) setHeightFt(savedHtFt);
      if (savedHtIn) setHeightIn(savedHtIn);
      if (savedWtLbs) setWeightLbs(savedWtLbs);
      if (savedConstraints) setConstraints(savedConstraints);

      // Pre-fill from user profile if available
      if (user) {
        if (user.trainingAge && !savedAge) setTrainingAge(user.trainingAge as TrainingAge);
        if (user.equipment && !savedEquipment) setEquipment(user.equipment as Equipment);
        if (user.heightCm && !savedHtFt) {
          const totalInches = user.heightCm / 2.54;
          const ft = Math.floor(totalInches / 12);
          const inches = Math.round(totalInches % 12);
          setHeightFt(String(ft));
          setHeightIn(String(inches));
        }
        if (user.weightKg && !savedWtLbs) {
          setWeightLbs(String(Math.round(user.weightKg * 2.20462)));
        }
        if (user.constraintsText && !savedConstraints) setConstraints(user.constraintsText);
      }
    } catch {
      // Ignore storage errors
    }
  }

  async function handleContinue() {
    if (!selectedLift || !currentWeight) return;

    setLoading(true);
    try {
      await AsyncStorage.multiSet([
        ['axiom_selected_lift', selectedLift],
        ['axiom_target_weight', currentWeight],
        ['axiom_target_sets', currentSets],
        ['axiom_target_reps', currentReps],
        ['axiom_training_age', trainingAge],
        ['axiom_equipment', equipment],
        ['axiom_height_ft', heightFt],
        ['axiom_height_in', heightIn],
        ['axiom_weight_lbs', weightLbs],
        ['axiom_constraints', constraints],
      ]);

      // Compute metric values
      let heightCm: number | undefined;
      if (heightFt || heightIn) {
        const ft = parseFloat(heightFt) || 0;
        const inches = parseFloat(heightIn) || 0;
        heightCm = Math.round((ft * 12 + inches) * 2.54);
      }

      let weightKg: number | undefined;
      if (weightLbs) {
        weightKg = parseFloat(weightLbs) / 2.20462;
      }

      // Fire-and-forget profile update
      authApi.updateProfile({ trainingAge, equipment, heightCm, weightKg, constraintsText: constraints || undefined }).catch(() => {});

      const session = await liftCoachApi.createSession({
        selectedLift,
        trainingAge,
        equipment,
        heightCm,
        weightKg,
        constraintsText: constraints || undefined,
      });

      await AsyncStorage.setItem('axiom_session_id', session.session?.id || session.id || '');
      router.push('/diagnostic/snapshot');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create session. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const canContinue = selectedLift.length > 0 && currentWeight.length > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: 'New Analysis' }} />
      <KeyboardDoneBar />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Select Lift Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Your Lift</Text>
          <View style={styles.liftGrid}>
            {LIFTS.map((lift) => {
              const isSelected = selectedLift === lift.id;
              return (
                <Pressable
                  key={lift.id}
                  onPress={() => setSelectedLift(lift.id)}
                  style={[
                    styles.liftCard,
                    isSelected && styles.liftCardSelected,
                  ]}
                >
                  <Ionicons
                    name={lift.icon as any}
                    size={22}
                    color={isSelected ? colors.primaryForeground : colors.mutedForeground}
                    style={styles.liftIcon}
                  />
                  <Text
                    style={[
                      styles.liftName,
                      isSelected && styles.liftNameSelected,
                    ]}
                    numberOfLines={2}
                  >
                    {lift.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Current Performance Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Performance</Text>
          <View style={styles.perfRow}>
            <Input
              label="Weight (lbs)"
              placeholder="225"
              value={currentWeight}
              onChangeText={setCurrentWeight}
              keyboardType="numeric"
              returnKeyType="done"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              containerStyle={styles.perfInput}
            />
            <Input
              label="Sets"
              placeholder="3"
              value={currentSets}
              onChangeText={setCurrentSets}
              keyboardType="numeric"
              returnKeyType="done"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              containerStyle={styles.perfInput}
            />
            <Input
              label="Reps"
              placeholder="5"
              value={currentReps}
              onChangeText={setCurrentReps}
              keyboardType="numeric"
              returnKeyType="done"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              containerStyle={styles.perfInput}
            />
          </View>
        </View>

        {/* Profile Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Your Profile{' '}
            <Text style={styles.optionalLabel}>(Optional)</Text>
          </Text>

          {/* Training Age */}
          <Text style={styles.fieldLabel}>Training Age</Text>
          <View style={styles.chipRow}>
            {(['beginner', 'intermediate', 'advanced'] as TrainingAge[]).map((level) => (
              <Pressable
                key={level}
                onPress={() => setTrainingAge(level)}
                style={[
                  styles.chip,
                  trainingAge === level && styles.chipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    trainingAge === level && styles.chipTextSelected,
                  ]}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Equipment */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Equipment</Text>
          <View style={styles.chipRow}>
            {(
              [
                { value: 'commercial_gym', label: 'Commercial Gym' },
                { value: 'limited_equipment', label: 'Limited' },
                { value: 'home_gym', label: 'Home Gym' },
              ] as { value: Equipment; label: string }[]
            ).map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => setEquipment(opt.value)}
                style={[
                  styles.chip,
                  equipment === opt.value && styles.chipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    equipment === opt.value && styles.chipTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Height */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Height</Text>
          <View style={styles.heightRow}>
            <Input
              placeholder="5"
              value={heightFt}
              onChangeText={setHeightFt}
              keyboardType="numeric"
              returnKeyType="done"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              containerStyle={styles.heightInput}
              label="ft"
            />
            <Input
              placeholder="10"
              value={heightIn}
              onChangeText={setHeightIn}
              keyboardType="numeric"
              returnKeyType="done"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              containerStyle={styles.heightInput}
              label="in"
            />
          </View>

          {/* Body Weight */}
          <Input
            label="Body Weight (lbs)"
            placeholder="185"
            value={weightLbs}
            onChangeText={setWeightLbs}
            keyboardType="numeric"
            returnKeyType="done"
            inputAccessoryViewID={KEYBOARD_DONE_ID}
            containerStyle={{ marginTop: spacing.md }}
          />

          {/* Constraints */}
          <Input
            label="Injuries / Constraints"
            placeholder="e.g. left shoulder impingement, avoid overhead pressing..."
            value={constraints}
            onChangeText={setConstraints}
            multiline
            numberOfLines={3}
            returnKeyType="done"
            inputAccessoryViewID={KEYBOARD_DONE_ID}
            style={styles.textArea}
            containerStyle={{ marginTop: spacing.md }}
          />
        </View>

        {/* Continue Button */}
        <Button
          onPress={handleContinue}
          disabled={!canContinue}
          loading={loading}
          fullWidth
          size="lg"
          style={styles.continueBtn}
        >
          Continue
        </Button>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  optionalLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.normal,
    color: colors.mutedForeground,
  },

  // Lift grid
  liftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  liftCard: {
    width: '47%',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  liftCardSelected: {
    borderColor: colors.foreground,
    backgroundColor: colors.foreground,
  },
  liftIcon: {
    marginBottom: 2,
  },
  liftName: {
    fontSize: 13,
    fontWeight: fontWeight.medium,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  liftNameSelected: {
    color: colors.primaryForeground,
  },

  // Performance row
  perfRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  perfInput: {
    flex: 1,
  },

  // Field label
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.mutedForeground,
  },
  chipTextSelected: {
    color: colors.primaryForeground,
  },

  // Height
  heightRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  heightInput: {
    flex: 1,
  },

  // Textarea
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 10,
  },

  // Continue
  continueBtn: {
    marginTop: spacing.sm,
  },
});
