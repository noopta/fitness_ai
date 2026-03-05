import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';

interface CoachOnboardingProps {
  onComplete: (profile: any) => void;
}

const GOALS = [
  { value: 'strength', label: 'Build Strength' },
  { value: 'muscle', label: 'Gain Muscle' },
  { value: 'weight_loss', label: 'Lose Weight' },
  { value: 'performance', label: 'Improve Performance' },
  { value: 'general', label: 'General Fitness' },
];

const FREQUENCIES = [
  { value: '2-3x/week', label: '2-3x/week' },
  { value: '3-4x/week', label: '3-4x/week' },
  { value: '4-5x/week', label: '4-5x/week' },
  { value: '5+x/week', label: '5+x/week' },
];

const EXPERIENCE_LEVELS = [
  { value: 'beginner', label: 'Beginner (0-1yr)' },
  { value: 'intermediate', label: 'Intermediate (1-3yr)' },
  { value: 'advanced', label: 'Advanced (3+yr)' },
];

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === current - 1 ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  );
}

function OptionCard({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.optionCard, selected && styles.optionCardSelected]}
    >
      <View style={[styles.optionRadio, selected && styles.optionRadioSelected]}>
        {selected && <View style={styles.optionRadioInner} />}
      </View>
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CoachOnboarding({ onComplete }: CoachOnboardingProps) {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState('');
  const [frequency, setFrequency] = useState('');
  const [experience, setExperience] = useState('');
  const [injuries, setInjuries] = useState('');
  const [noInjuries, setNoInjuries] = useState(false);

  const totalSteps = 3;

  function handleNext() {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete({
        goal,
        frequency,
        experience,
        injuries: noInjuries ? 'None' : injuries,
      });
    }
  }

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  function isStepValid() {
    if (step === 1) return !!goal;
    if (step === 2) return !!frequency && !!experience;
    return true;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ProgressDots current={step} total={totalSteps} />

      <Text style={styles.stepLabel}>Step {step} of {totalSteps}</Text>

      {step === 1 && (
        <Card style={styles.card}>
          <CardHeader>
            <CardTitle>What's your primary training goal?</CardTitle>
          </CardHeader>
          <CardContent style={styles.cardContent}>
            {GOALS.map((g) => (
              <OptionCard
                key={g.value}
                label={g.label}
                selected={goal === g.value}
                onPress={() => setGoal(g.value)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card style={styles.card}>
          <CardHeader>
            <CardTitle>Training background</CardTitle>
          </CardHeader>
          <CardContent style={styles.cardContent}>
            <Text style={styles.sectionLabel}>Training frequency</Text>
            {FREQUENCIES.map((f) => (
              <OptionCard
                key={f.value}
                label={f.label}
                selected={frequency === f.value}
                onPress={() => setFrequency(f.value)}
              />
            ))}

            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>Experience level</Text>
            {EXPERIENCE_LEVELS.map((e) => (
              <OptionCard
                key={e.value}
                label={e.label}
                selected={experience === e.value}
                onPress={() => setExperience(e.value)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card style={styles.card}>
          <CardHeader>
            <CardTitle>Any injuries or constraints?</CardTitle>
          </CardHeader>
          <CardContent style={styles.cardContent}>
            <TextInput
              style={[styles.textArea, noInjuries && styles.textAreaDisabled]}
              placeholder="Describe any injuries, pain points, or movement limitations (optional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              value={noInjuries ? '' : injuries}
              onChangeText={setInjuries}
              editable={!noInjuries}
              textAlignVertical="top"
            />

            <Pressable
              onPress={() => {
                setNoInjuries(!noInjuries);
                if (!noInjuries) setInjuries('');
              }}
              style={styles.checkboxRow}
            >
              <View style={[styles.checkbox, noInjuries && styles.checkboxChecked]}>
                {noInjuries && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>None currently</Text>
            </Pressable>
          </CardContent>
        </Card>
      )}

      <View style={styles.navRow}>
        {step > 1 ? (
          <Button variant="outline" onPress={handleBack} style={styles.navButton}>
            Back
          </Button>
        ) : (
          <View style={styles.navButton} />
        )}
        <Button
          onPress={handleNext}
          disabled={!isStepValid()}
          style={styles.navButton}
        >
          {step === totalSteps ? 'Continue' : 'Next'}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  dotInactive: {
    backgroundColor: colors.muted,
  },
  stepLabel: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  card: {
    marginTop: spacing.xs,
  },
  cardContent: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}18`,
  },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRadioSelected: {
    borderColor: colors.primary,
  },
  optionRadioInner: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  optionLabel: {
    fontSize: fontSize.base,
    color: colors.mutedForeground,
    flex: 1,
  },
  optionLabelSelected: {
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  textArea: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.foreground,
    fontSize: fontSize.base,
    minHeight: 100,
  },
  textAreaDisabled: {
    opacity: 0.4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  checkboxLabel: {
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  navButton: {
    flex: 1,
  },
});
