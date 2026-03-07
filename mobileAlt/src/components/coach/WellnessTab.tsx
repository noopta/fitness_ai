import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { coachApi } from '../../lib/api';

interface WellnessTabProps {
  coachData: any;
}

interface CheckinEntry {
  id?: string;
  fatigueLevel?: number;
  stress?: number;
  sleepHours?: number;
  mood?: number | string;
  energy?: number;
  hrv?: number;
  notes?: string;
  createdAt?: string;
  date?: string;
}

const MOODS = [
  { emoji: '😴', value: 'poor', label: 'Poor' },
  { emoji: '😔', value: 'low', label: 'Low' },
  { emoji: '😐', value: 'okay', label: 'Okay' },
  { emoji: '🙂', value: 'good', label: 'Good' },
  { emoji: '😄', value: 'great', label: 'Great' },
];

function moodEmoji(mood: number | string | undefined): string {
  if (mood === undefined || mood === null) return '—';
  if (typeof mood === 'number') {
    const idx = Math.max(0, Math.min(mood - 1, MOODS.length - 1));
    return MOODS[idx]?.emoji ?? '—';
  }
  const found = MOODS.find((m) => m.value === mood);
  return found ? found.emoji : '—';
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function WellnessTab({ coachData }: WellnessTabProps) {
  const [fatigue, setFatigue] = useState<number>(5);
  const [sleep, setSleep] = useState('');
  const [mood, setMood] = useState('');
  const [hrv, setHrv] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [checkins, setCheckins] = useState<CheckinEntry[]>([]);
  const [checkinsLoading, setCheckinsLoading] = useState(true);

  useEffect(() => {
    loadCheckins();
  }, []);

  async function loadCheckins() {
    try {
      const data = await coachApi.getWellnessCheckins();
      const entries: CheckinEntry[] = Array.isArray(data)
        ? data
        : data?.checkins ?? data?.entries ?? [];
      // Sort descending, take 5
      const sorted = [...entries].sort((a, b) => {
        const da = new Date(a.createdAt || a.date || 0).getTime();
        const db = new Date(b.createdAt || b.date || 0).getTime();
        return db - da;
      });
      setCheckins(sorted.slice(0, 5));
    } catch {
      // No checkins yet
    } finally {
      setCheckinsLoading(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const moodIndex = MOODS.findIndex((m) => m.value === mood);
      const moodScore = moodIndex >= 0 ? moodIndex + 1 : 3;
      const stressScore = fatigue <= 10 ? Math.round(fatigue) : 5;
      await coachApi.postCheckin({
        sleepHours: sleep ? parseFloat(sleep) : 7,
        mood: moodScore,
        energy: Math.max(1, 6 - stressScore),
        stress: stressScore,
        hrv: hrv ? parseFloat(hrv) : undefined,
        notes: notes.trim() || undefined,
      });
      // Reset form
      setFatigue(5);
      setSleep('');
      setMood('');
      setHrv('');
      setNotes('');
      Alert.alert('Check-in Submitted', 'Your wellness check-in has been logged.');
      await loadCheckins();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to submit check-in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Check-in form */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Log Today's Check-in</CardTitle>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {/* Fatigue slider (1-10 buttons) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Fatigue Level: {fatigue}/10</Text>
            <View style={styles.numberRow}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setFatigue(n)}
                  style={[
                    styles.numberButton,
                    fatigue === n && styles.numberButtonActive,
                    n <= 3
                      ? styles.numberLow
                      : n <= 6
                      ? styles.numberMid
                      : styles.numberHigh,
                    fatigue === n
                      ? n <= 3
                        ? styles.numberLowActive
                        : n <= 6
                        ? styles.numberMidActive
                        : styles.numberHighActive
                      : {},
                  ]}
                >
                  <Text
                    style={[
                      styles.numberButtonText,
                      fatigue === n && styles.numberButtonTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fatigueLegend}>
              <Text style={{ color: colors.success }}>1-3 Fresh</Text>
              {'  '}
              <Text style={{ color: colors.warning }}>4-6 Moderate</Text>
              {'  '}
              <Text style={{ color: colors.destructive }}>7-10 Fatigued</Text>
            </Text>
          </View>

          {/* Sleep */}
          <Input
            label="Sleep Hours"
            placeholder="e.g. 7.5"
            value={sleep}
            onChangeText={setSleep}
            keyboardType="decimal-pad"
          />

          {/* Mood */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Mood</Text>
            <View style={styles.moodRow}>
              {MOODS.map((m) => (
                <Pressable
                  key={m.value}
                  onPress={() => setMood(m.value)}
                  style={[
                    styles.moodButton,
                    mood === m.value && styles.moodButtonActive,
                  ]}
                >
                  <Text style={styles.moodEmoji}>{m.emoji}</Text>
                  <Text
                    style={[
                      styles.moodLabel,
                      mood === m.value && styles.moodLabelActive,
                    ]}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* HRV */}
          <Input
            label="HRV (optional)"
            placeholder="Heart rate variability (ms)"
            value={hrv}
            onChangeText={setHrv}
            keyboardType="decimal-pad"
          />

          {/* Notes */}
          <Input
            label="Notes (optional)"
            placeholder="How are you feeling today?"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            style={styles.notesInput}
          />

          <Button
            fullWidth
            onPress={handleSubmit}
            loading={submitting}
            style={styles.submitBtn}
          >
            Submit Check-in
          </Button>
        </CardContent>
      </Card>

      {/* Recent check-ins */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Recent Check-ins</CardTitle>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {checkinsLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : checkins.length === 0 ? (
            <Text style={styles.noDataText}>
              No check-ins yet. Submit your first one above.
            </Text>
          ) : (
            <View style={styles.checkinsTable}>
              {/* Table header */}
              <View style={[styles.checkinRow, styles.checkinHeader]}>
                <Text style={[styles.checkinCell, styles.headerText, styles.colDate]}>Date</Text>
                <Text style={[styles.checkinCell, styles.headerText, styles.colFatigue]}>Fatigue</Text>
                <Text style={[styles.checkinCell, styles.headerText, styles.colSleep]}>Sleep</Text>
                <Text style={[styles.checkinCell, styles.headerText, styles.colMood]}>Mood</Text>
              </View>
              {checkins.map((c, idx) => (
                <View
                  key={c.id ?? idx}
                  style={[
                    styles.checkinRow,
                    idx % 2 === 0 ? styles.checkinRowEven : {},
                  ]}
                >
                  <Text style={[styles.checkinCell, styles.colDate]}>
                    {formatDate(c.createdAt || c.date)}
                  </Text>
                  <Text style={[styles.checkinCell, styles.colFatigue]}>
                    {c.stress != null ? `${c.stress}/10` : c.fatigueLevel != null ? `${c.fatigueLevel}/10` : '—'}
                  </Text>
                  <Text style={[styles.checkinCell, styles.colSleep]}>
                    {c.sleepHours != null ? `${c.sleepHours}h` : '—'}
                  </Text>
                  <Text style={[styles.checkinCell, styles.colMood, styles.moodCellText]}>
                    {moodEmoji(c.mood)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </CardContent>
      </Card>
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
  card: {},
  cardContent: {
    paddingTop: 0,
    gap: spacing.md,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  numberRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  numberButton: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  numberButtonActive: {
    borderWidth: 2,
  },
  numberLow: {
    backgroundColor: `${colors.success}18`,
  },
  numberMid: {
    backgroundColor: `${colors.warning}18`,
  },
  numberHigh: {
    backgroundColor: `${colors.destructive}18`,
  },
  numberLowActive: {
    backgroundColor: `${colors.success}44`,
    borderColor: colors.success,
  },
  numberMidActive: {
    backgroundColor: `${colors.warning}44`,
    borderColor: colors.warning,
  },
  numberHighActive: {
    backgroundColor: `${colors.destructive}44`,
    borderColor: colors.destructive,
  },
  numberButtonText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },
  numberButtonTextActive: {
    color: colors.foreground,
    fontWeight: fontWeight.bold,
  },
  fatigueLegend: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  moodRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  moodButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    gap: 2,
  },
  moodButtonActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}22`,
  },
  moodEmoji: {
    fontSize: 22,
  },
  moodLabel: {
    fontSize: 9,
    color: colors.mutedForeground,
  },
  moodLabelActive: {
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitBtn: {},
  loadingRow: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  noDataText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  checkinsTable: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  checkinRowEven: {
    backgroundColor: `${colors.muted}60`,
  },
  checkinHeader: {
    backgroundColor: colors.muted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checkinCell: {
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  colDate: { flex: 1.3 },
  colFatigue: { flex: 1, textAlign: 'center' },
  colSleep: { flex: 0.9, textAlign: 'center' },
  colMood: { flex: 0.6, textAlign: 'center' },
  moodCellText: { fontSize: 16, lineHeight: 22 },
});
