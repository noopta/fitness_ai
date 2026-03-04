import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { liftCoachApi, authApi, storage } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

const lifts = [
  { id: 'flat_bench_press', label: 'Flat Bench Press', hint: 'Chest, triceps, shoulders', icon: 'barbell' as const },
  { id: 'incline_bench_press', label: 'Incline Bench Press', hint: 'Upper chest focus', icon: 'trending-up' as const },
  { id: 'deadlift', label: 'Deadlift', hint: 'Full posterior chain', icon: 'flash' as const },
  { id: 'barbell_back_squat', label: 'Back Squat', hint: 'Legs & glutes', icon: 'fitness' as const },
  { id: 'barbell_front_squat', label: 'Front Squat', hint: 'Quad dominant', icon: 'locate' as const },
  { id: 'clean_and_jerk', label: 'Clean & Jerk', hint: 'Olympic - full body', icon: 'flame' as const },
  { id: 'snatch', label: 'Snatch', hint: 'Olympic - explosive pull', icon: 'flame' as const },
  { id: 'power_clean', label: 'Power Clean', hint: 'Olympic - power position', icon: 'flame' as const },
  { id: 'hang_clean', label: 'Hang Clean', hint: 'Olympic - hang position', icon: 'flame' as const },
];

const trainingAgeOptions = [
  { value: 'beginner', label: 'Beginner (<1 year)' },
  { value: 'intermediate', label: 'Intermediate (1-3 years)' },
  { value: 'advanced', label: 'Advanced (3+ years)' },
];

const equipmentOptions = [
  { value: 'commercial', label: 'Commercial Gym (full)' },
  { value: 'limited', label: 'Limited (barbells + dumbbells)' },
  { value: 'home', label: 'Home Gym (minimal)' },
];

function feetInToCm(ft: number, inch: number) {
  return (ft * 12 + inch) * 2.54;
}

function lbToKg(lb: number) {
  return lb * 0.453592;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [selectedLift, setSelectedLift] = useState('flat_bench_press');
  const [loading, setLoading] = useState(false);

  const [currentWeight, setCurrentWeight] = useState('');
  const [currentSets, setCurrentSets] = useState('');
  const [currentReps, setCurrentReps] = useState('');

  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [constraints, setConstraints] = useState('');
  const [trainingAge, setTrainingAge] = useState('intermediate');
  const [equipment, setEquipment] = useState('commercial');

  useEffect(() => {
    if (user) {
      if (user.trainingAge) setTrainingAge(user.trainingAge);
      if (user.equipment) setEquipment(user.equipment);
      if (user.constraintsText) setConstraints(user.constraintsText);
      if (user.heightCm) {
        const totalInches = user.heightCm / 2.54;
        setHeightFeet(Math.floor(totalInches / 12).toString());
        setHeightInches(Math.round(totalInches % 12).toString());
      }
      if (user.weightKg) {
        setWeightLbs(Math.round(user.weightKg / 0.453592).toString());
      }
    }
  }, [user]);

  async function handleContinue() {
    if (!selectedLift || !currentWeight || !currentSets || !currentReps) return;

    setLoading(true);
    try {
      const profile: any = {
        constraintsText: constraints || undefined,
        trainingAge,
        equipment,
      };

      if (heightFeet) {
        profile.heightCm = feetInToCm(parseFloat(heightFeet), parseFloat(heightInches) || 0);
      }
      if (weightLbs) {
        profile.weightKg = lbToKg(parseFloat(weightLbs));
      }

      const response = await liftCoachApi.createSession({
        selectedLift,
        goal: 'strength_peak',
        profile,
      });

      const sid = response.session?.id || response.sessionId || response.id || '';
      await storage.set('liftoff_session_id', sid);
      await storage.set('liftoff_selected_lift', selectedLift);
      await storage.set('liftoff_target_lift_weight', currentWeight);
      await storage.set('liftoff_target_lift_sets', currentSets);
      await storage.set('liftoff_target_lift_reps', currentReps);

      authApi.updateProfile({
        trainingAge: profile.trainingAge,
        equipment: profile.equipment,
        constraintsText: profile.constraintsText,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
      }).catch(() => {});

      router.push('/diagnostic/snapshot');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create session');
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
            <Text style={styles.navTitle}>Step 1 of 4</Text>
            <Text style={styles.navSubtitle}>AI-Powered Lift Diagnostics</Text>
          </View>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.pageTitle}>Diagnose Your Weak Points</Text>
          <Text style={styles.pageDescription}>
            Using your current working weights and lift mechanics, our AI identifies exactly where
            you're struggling and prescribes targeted accessories.
          </Text>

          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="locate" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>Select Your Target Lift</Text>
            </View>

            <View style={styles.liftGrid}>
              {lifts.map((lift) => (
                <TouchableOpacity
                  key={lift.id}
                  style={[
                    styles.liftItem,
                    selectedLift === lift.id && styles.liftItemSelected,
                  ]}
                  onPress={() => setSelectedLift(lift.id)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.liftIcon,
                    selectedLift === lift.id && styles.liftIconSelected,
                  ]}>
                    <Ionicons
                      name={lift.icon}
                      size={20}
                      color={selectedLift === lift.id ? colors.primary : colors.mutedForeground}
                    />
                  </View>
                  <View style={styles.liftInfo}>
                    <Text style={[
                      styles.liftLabel,
                      selectedLift === lift.id && styles.liftLabelSelected,
                    ]}>
                      {lift.label}
                    </Text>
                    <Text style={styles.liftHint}>{lift.hint}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="trending-up" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>
                Your Current {lifts.find(l => l.id === selectedLift)?.label}
              </Text>
            </View>
            <Text style={styles.cardDescription}>
              Enter your current working weight, sets, and reps.
            </Text>

            <View style={styles.inputRow}>
              <Input
                label="Weight (lbs)"
                placeholder="185"
                value={currentWeight}
                onChangeText={setCurrentWeight}
                keyboardType="numeric"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="Sets"
                placeholder="3"
                value={currentSets}
                onChangeText={setCurrentSets}
                keyboardType="numeric"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="Reps"
                placeholder="8"
                value={currentReps}
                onChangeText={setCurrentReps}
                keyboardType="numeric"
                containerStyle={{ flex: 1 }}
              />
            </View>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Your Profile</Text>
            <Text style={styles.cardDescription}>Optional but recommended for better results</Text>

            <Text style={styles.selectLabel}>Training Age</Text>
            <View style={styles.optionRow}>
              {trainingAgeOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.optionChip,
                    trainingAge === opt.value && styles.optionChipSelected,
                  ]}
                  onPress={() => setTrainingAge(opt.value)}
                >
                  <Text style={[
                    styles.optionChipText,
                    trainingAge === opt.value && styles.optionChipTextSelected,
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.selectLabel}>Equipment Access</Text>
            <View style={styles.optionRow}>
              {equipmentOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.optionChip,
                    equipment === opt.value && styles.optionChipSelected,
                  ]}
                  onPress={() => setEquipment(opt.value)}
                >
                  <Text style={[
                    styles.optionChipText,
                    equipment === opt.value && styles.optionChipTextSelected,
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputRow}>
              <Input
                label="Height (ft)"
                placeholder="5"
                value={heightFeet}
                onChangeText={setHeightFeet}
                keyboardType="numeric"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="(in)"
                placeholder="10"
                value={heightInches}
                onChangeText={setHeightInches}
                keyboardType="numeric"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="Weight (lbs)"
                placeholder="175"
                value={weightLbs}
                onChangeText={setWeightLbs}
                keyboardType="numeric"
                containerStyle={{ flex: 1 }}
              />
            </View>

            <Input
              label="Injuries or Constraints (Optional)"
              placeholder="e.g., shoulder impingement, lower back sensitivity..."
              value={constraints}
              onChangeText={setConstraints}
              multiline
              numberOfLines={2}
              containerStyle={{ marginTop: 12 }}
              style={{ minHeight: 60, textAlignVertical: 'top' }}
            />
          </Card>

          <Button
            onPress={handleContinue}
            disabled={!selectedLift || !currentWeight || !currentSets || !currentReps}
            loading={loading}
            size="lg"
            style={{ marginTop: 8, marginBottom: 32 }}
          >
            {loading ? 'Creating Session...' : 'Continue to Snapshot'}
          </Button>
        </ScrollView>
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
  navCenter: {
    alignItems: 'center',
  },
  navTitle: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  navSubtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  pageTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    marginBottom: 8,
  },
  pageDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  card: {
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  cardDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginBottom: 16,
  },
  liftGrid: {
    gap: 8,
  },
  liftItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 12,
  },
  liftItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '08',
  },
  liftIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liftIconSelected: {
    backgroundColor: colors.primary + '15',
  },
  liftInfo: {
    flex: 1,
  },
  liftLabel: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  liftLabelSelected: {
    color: colors.primary,
  },
  liftHint: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  selectLabel: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginTop: 12,
    marginBottom: 8,
  },
  optionRow: {
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
  optionChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  optionChipText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  optionChipTextSelected: {
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
});
