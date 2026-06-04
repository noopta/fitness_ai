// Form critique (video) — pick or record a ≤60s lift, upload it, and render
// Gemini's form analysis: a score, what's working, what's breaking down (with
// coaching cues), drills to fix it, programming notes, and safety flags.
//
// Free tier is 1 analysis/day (enforced server-side); a 429 surfaces an
// upgrade nudge.

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { UpgradeSheet } from '../../src/components/UpgradeSheet';
import { formAnalysisApi, type WorkoutVideoAnalysis } from '../../src/lib/api';
import { posthog } from '../../src/lib/analytics';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

type Stage = 'capture' | 'analyzing' | 'result';

const SEVERITY_COLOR: Record<string, string> = {
  minor: colors.warning,
  moderate: colors.warning,
  major: colors.destructive,
};

export default function FormAnalysisScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  const [stage, setStage] = useState<Stage>('capture');
  const [hint, setHint] = useState('');
  const [analysis, setAnalysis] = useState<WorkoutVideoAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const ensurePermission = async (kind: 'camera' | 'library'): Promise<boolean> => {
    const req = kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!req.granted) {
      Alert.alert(
        kind === 'camera' ? 'Camera permission needed' : 'Photo library permission needed',
        'Enable it in Settings to add a video of your lift.',
      );
      return false;
    }
    return true;
  };

  const pickAndAnalyze = async (kind: 'camera' | 'library') => {
    if (!await ensurePermission(kind)) return;
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: 60,
      quality: 0.7,
      allowsEditing: true,
    };
    const res = kind === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    // Guard duration client-side too (library picks aren't capped by videoMaxDuration).
    if (a.duration && a.duration > 65000) {
      Alert.alert('Video too long', 'Please choose a clip up to 60 seconds.');
      return;
    }
    const mimeType = a.mimeType ?? 'video/mp4';
    await analyze(a.uri, mimeType);
  };

  const analyze = async (uri: string, mimeType: string) => {
    setStage('analyzing');
    setError(null);
    try {
      const res = await formAnalysisApi.analyzeVideo(uri, mimeType, hint);
      posthog.capture('form_video_analyzed', { exercise: res.analysis?.exercise });
      setAnalysis(res.analysis);
      setStage('result');
    } catch (err: any) {
      if (err?.status === 429) {
        setStage('capture');
        Alert.alert(
          'Daily limit reached',
          'Free tier includes 1 form-video analysis per day. Upgrade to Pro for unlimited form checks.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See Pro', onPress: () => setShowUpgrade(true) },
          ],
        );
        return;
      }
      setError(err?.message ?? 'Could not analyze that video. Try again.');
      setStage('capture');
    }
  };

  const reset = () => { setAnalysis(null); setError(null); setStage('capture'); };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Form analysis</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {stage === 'capture' && (
          <>
            <Text style={styles.lead}>
              Film a single set from the side, full body in frame. Up to 60 seconds.
            </Text>
            {!isPro && (
              <Text style={styles.quotaNote}>Free plan: 1 analysis per day.</Text>
            )}
            <Text style={styles.fieldLabel}>WHICH LIFT? (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={hint}
              onChangeText={setHint}
              placeholder="e.g. back squat, conventional deadlift"
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Exercise hint"
            />
            <View style={styles.captureRow}>
              <TouchableOpacity style={styles.tile} onPress={() => pickAndAnalyze('camera')} accessibilityRole="button" accessibilityLabel="Record a video">
                <Ionicons name="videocam-outline" size={28} color={colors.foreground} />
                <Text style={styles.tileLabel}>Record</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.tile} onPress={() => pickAndAnalyze('library')} accessibilityRole="button" accessibilityLabel="Choose from library">
                <Ionicons name="film-outline" size={28} color={colors.foreground} />
                <Text style={styles.tileLabel}>From library</Text>
              </TouchableOpacity>
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </>
        )}

        {stage === 'analyzing' && (
          <View style={styles.analyzingBox}>
            <ActivityIndicator color={colors.foreground} />
            <Text style={styles.analyzingText}>Analyzing your form…</Text>
            <Text style={styles.analyzingSub}>This can take 10–20 seconds for a full set.</Text>
          </View>
        )}

        {stage === 'result' && analysis && (
          <ResultView analysis={analysis} onAnother={reset} />
        )}
      </ScrollView>

      <UpgradeSheet
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onSuccess={() => setShowUpgrade(false)}
      />
    </SafeAreaView>
  );
}

function ResultView({ analysis, onAnother }: { analysis: WorkoutVideoAnalysis; onAnother: () => void }) {
  const unknown = (analysis.exercise || '').toLowerCase() === 'unknown';
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.scoreCard}>
        <View>
          <Text style={styles.scoreExercise}>{unknown ? 'Couldn’t read the lift' : analysis.exercise}</Text>
          {analysis.repCount != null && !unknown ? (
            <Text style={styles.scoreReps}>{analysis.repCount} rep{analysis.repCount === 1 ? '' : 's'} analyzed</Text>
          ) : null}
        </View>
        {!unknown && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreValue}>{Math.round(analysis.formScore)}</Text>
            <Text style={styles.scoreOutOf}>/10</Text>
          </View>
        )}
      </View>

      {analysis.summary ? <Text style={styles.summary}>{analysis.summary}</Text> : null}

      {analysis.safetyFlags?.length > 0 && (
        <Section title="Safety" tone="danger">
          {analysis.safetyFlags.map((s, i) => (
            <Bullet key={i} icon="warning" tone="danger" text={s} />
          ))}
        </Section>
      )}

      {analysis.strengths?.length > 0 && (
        <Section title="What’s working">
          {analysis.strengths.map((s, i) => (
            <Bullet key={i} icon="checkmark-circle" tone="success" text={s} />
          ))}
        </Section>
      )}

      {analysis.weaknesses?.length > 0 && (
        <Section title="What to fix">
          {analysis.weaknesses.map((w, i) => (
            <View key={i} style={styles.weakItem}>
              <View style={styles.weakHead}>
                <View style={[styles.sevDot, { backgroundColor: SEVERITY_COLOR[w.severity] ?? colors.warning }]} />
                <Text style={styles.weakIssue}>{w.issue}</Text>
              </View>
              <Text style={styles.weakCue}>Cue: {w.cue}</Text>
            </View>
          ))}
        </Section>
      )}

      {analysis.recommendedDrills?.length > 0 && (
        <Section title="Drills to fix it">
          {analysis.recommendedDrills.map((d, i) => (
            <View key={i} style={styles.drillItem}>
              <Text style={styles.drillName}>{d.name}{d.setsReps ? `  ·  ${d.setsReps}` : ''}</Text>
              <Text style={styles.drillWhy}>{d.why}</Text>
            </View>
          ))}
        </Section>
      )}

      {analysis.programmingNotes?.length > 0 && (
        <Section title="Programming notes">
          {analysis.programmingNotes.map((n, i) => (
            <Bullet key={i} icon="arrow-forward-circle" text={n} />
          ))}
        </Section>
      )}

      <TouchableOpacity style={styles.againButton} onPress={onAnother} accessibilityRole="button">
        <Text style={styles.againText}>Analyze another</Text>
      </TouchableOpacity>
    </View>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, tone === 'danger' && { color: colors.destructive }]}>{title}</Text>
      <View style={{ gap: spacing.sm }}>{children}</View>
    </View>
  );
}

function Bullet({ icon, text, tone }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? colors.success : tone === 'danger' ? colors.destructive : colors.mutedForeground;
  return (
    <View style={styles.bulletRow}>
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  lead: { fontSize: fontSize.base, color: colors.foreground, lineHeight: 22 },
  quotaNote: { fontSize: fontSize.sm, color: colors.mutedForeground },
  fieldLabel: { fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 0.8, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.muted, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: fontSize.base, color: colors.foreground,
  },
  captureRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    flex: 1, height: 120, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  tileLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  analyzingBox: { alignItems: 'center', paddingVertical: 48, gap: spacing.sm },
  analyzingText: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  analyzingSub: { fontSize: fontSize.sm, color: colors.mutedForeground },
  errorText: { color: colors.destructive, fontSize: fontSize.sm, marginTop: spacing.sm },

  scoreCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.muted,
  },
  scoreExercise: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  scoreReps: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },
  scoreBadge: { flexDirection: 'row', alignItems: 'baseline' },
  scoreValue: { fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.foreground },
  scoreOutOf: { fontSize: fontSize.lg, color: colors.mutedForeground, fontWeight: fontWeight.semibold },
  summary: { fontSize: fontSize.base, color: colors.foreground, lineHeight: 23 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 0.8, textTransform: 'uppercase' },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletText: { flex: 1, fontSize: fontSize.base, color: colors.foreground, lineHeight: 21 },
  weakItem: { gap: 4, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  weakHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  weakIssue: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  weakCue: { fontSize: fontSize.sm, color: colors.mutedForeground, marginLeft: 16, lineHeight: 19 },
  drillItem: { gap: 2 },
  drillName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  drillWhy: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 19 },
  againButton: {
    height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm,
  },
  againText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
});
