import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { coachApi } from '../../lib/api';

interface ProgramSetupProps {
  onGenerate: (program: any) => void;
  onBack: () => void;
}

const DURATION_OPTIONS = [4, 8, 12, 16];
const DAYS_OPTIONS = [3, 4, 5, 6];
const FOCUS_OPTIONS = ['Powerlifting', 'Bodybuilding', 'Athletic', 'General Strength'];

function OptionRow<T extends string | number>({
  options,
  selected,
  onSelect,
  renderLabel,
}: {
  options: T[];
  selected: T;
  onSelect: (val: T) => void;
  renderLabel?: (val: T) => string;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map((opt) => {
        const isSelected = selected === opt;
        const label = renderLabel ? renderLabel(opt) : String(opt);
        return (
          <Pressable
            key={String(opt)}
            onPress={() => onSelect(opt)}
            style={[styles.optionChip, isSelected && styles.optionChipSelected]}
          >
            <Text style={[styles.optionChipText, isSelected && styles.optionChipTextSelected]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgramSetup({ onGenerate, onBack }: ProgramSetupProps) {
  const [durationWeeks, setDurationWeeks] = useState<number>(12);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(4);
  const [focus, setFocus] = useState<string>('General Strength');
  const [primaryLift, setPrimaryLift] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setError('');
    setLoading(true);
    try {
      const result = await coachApi.generateProgram({
        durationWeeks,
        daysPerWeek,
        focus,
        primaryLift: primaryLift.trim() || undefined,
      });
      onGenerate(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate program. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingSpinner message="Generating your personalized program..." />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Configure Your Program</Text>
      <Text style={styles.subheading}>
        Customize the program parameters to match your goals and schedule.
      </Text>

      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Program Duration</CardTitle>
        </CardHeader>
        <CardContent>
          <OptionRow
            options={DURATION_OPTIONS}
            selected={durationWeeks}
            onSelect={setDurationWeeks}
            renderLabel={(v) => `${v} wks`}
          />
        </CardContent>
      </Card>

      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Training Days per Week</CardTitle>
        </CardHeader>
        <CardContent>
          <OptionRow
            options={DAYS_OPTIONS}
            selected={daysPerWeek}
            onSelect={setDaysPerWeek}
            renderLabel={(v) => `${v} days`}
          />
        </CardContent>
      </Card>

      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Focus</CardTitle>
        </CardHeader>
        <CardContent>
          <View style={styles.focusGrid}>
            {FOCUS_OPTIONS.map((opt) => {
              const isSelected = focus === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setFocus(opt)}
                  style={[styles.focusChip, isSelected && styles.focusChipSelected]}
                >
                  <Text style={[styles.focusChipText, isSelected && styles.focusChipTextSelected]}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </CardContent>
      </Card>

      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Primary Lift Focus</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="e.g. Deadlift, Squat, Bench Press (optional)"
            value={primaryLift}
            onChangeText={setPrimaryLift}
            autoCapitalize="words"
          />
        </CardContent>
      </Card>

      {!!error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      <View style={styles.navRow}>
        <Button variant="outline" onPress={onBack} style={styles.navButton}>
          Back
        </Button>
        <Button onPress={handleGenerate} style={styles.navButton}>
          Generate Program
        </Button>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heading: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginTop: spacing.sm,
  },
  subheading: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  card: {},
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  optionChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionChipText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },
  optionChipTextSelected: {
    color: colors.primaryForeground,
  },
  focusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  focusChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  focusChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  focusChipText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },
  focusChipTextSelected: {
    color: colors.primaryForeground,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.destructive,
    textAlign: 'center',
  },
  navRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  navButton: {
    flex: 1,
  },
});
