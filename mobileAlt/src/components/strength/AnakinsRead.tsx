import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { InsightCard } from './InsightCard';
import { MiniSparkline } from './MiniSparkline';
import type { Insight, RatioResult } from '../../lib/athleteModel';

// "Anakin's Read" — the proactive insight feed section. Owns the section
// header and the three states from the design handoff §7:
//   • new-user      — confidence < 0.3 → a "log more" prompt, no cards
//   • all-clear     — zero non-win insights → one celebratory card
//   • populated     — the staggered InsightCard list
//
// Cards fade in with an 80ms-per-index downward stagger (handoff §8).

const NEW_USER_CONFIDENCE = 0.3;

interface Props {
  insights: Insight[];
  ratios: RatioResult[];
  confidence: number;
  onInsightPress: (insight: Insight) => void;
}

/** Find the RatioResult an imbalance insight refers to (id `ratio-<ratioId>`). */
function ratioFor(insight: Insight, ratios: RatioResult[]): RatioResult | null {
  if (insight.kind !== 'imbalance') return null;
  const ratioId = insight.id.replace(/^ratio-/, '');
  return ratios.find((r) => r.id === ratioId) ?? null;
}

export function AnakinsRead({ insights, ratios, confidence, onInsightPress }: Props) {
  const reducedMotion = useReducedMotion();
  const newUser = confidence < NEW_USER_CONFIDENCE;
  const nonWin = insights.filter((i) => i.kind !== 'win');
  const allClear = !newUser && nonWin.length === 0;
  // Medium confidence (0.3–0.65) — the model has a read but it's still
  // firming up. Surface a section-level "preliminary" note rather than
  // mutating every insight's copy (handoff §7, lighter touch).
  const preliminary = !newUser && confidence < 0.65;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Anakin's Read</Text>
        {!newUser && (
          <Text style={styles.meta}>{Math.round(confidence * 100)}% confidence</Text>
        )}
      </View>

      {/* ── New-user state ──────────────────────────────────────────────── */}
      {newUser && (
        <View style={styles.promptCard}>
          <View style={styles.promptIcon}>
            <Ionicons name="sparkles-outline" size={20} color="#71717A" />
          </View>
          <Text style={styles.promptTitle}>Anakin is still reading you</Text>
          <Text style={styles.promptBody}>
            Log ~5 more sessions across your main lifts and Anakin will surface your
            weak points, imbalances, and what to fix — automatically.
          </Text>
        </View>
      )}

      {/* ── All-clear state ─────────────────────────────────────────────── */}
      {allClear && (
        <View style={styles.clearCard}>
          <View style={styles.clearRow}>
            <View style={styles.clearIcon}>
              <Ionicons name="checkmark" size={16} color="#15803D" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clearTitle}>Nothing's holding you back</Text>
              <Text style={styles.clearBody}>
                No stalls, no imbalances. Your training is balanced and progressing —
                keep doing what you're doing.
              </Text>
            </View>
            <MiniSparkline values={[1, 1.5, 2.1, 3]} color="#15803D" width={48} height={26} />
          </View>
        </View>
      )}

      {/* ── Populated state ─────────────────────────────────────────────── */}
      {!newUser && !allClear && (
        <>
          {preliminary && (
            <Text style={styles.preliminaryNote}>
              Preliminary read — keep logging to firm these up.
            </Text>
          )}
          <View style={{ gap: 8, marginTop: preliminary ? 8 : 10 }}>
            {insights.map((insight, i) => (
              <Animated.View
                key={insight.id}
                // Reduced motion → no stagger; the card just appears.
                entering={reducedMotion ? undefined : FadeInDown.delay(i * 80).duration(320)}
              >
                <InsightCard
                  insight={insight}
                  ratio={ratioFor(insight, ratios)}
                  onPress={onInsightPress}
                />
              </Animated.View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, marginTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    textTransform: 'uppercase', color: '#71717A',
  },
  meta: { fontSize: 11, color: '#71717A', fontFamily: 'Menlo' },
  preliminaryNote: {
    fontSize: 11, color: '#A1A1AA', fontStyle: 'italic', marginTop: 8,
  },

  promptCard: {
    marginTop: 10,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  promptIcon: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: '#F4F4F5',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  promptTitle: { fontSize: 14, fontWeight: '700', color: '#09090B' },
  promptBody: {
    fontSize: 12.5, color: '#71717A', textAlign: 'center',
    lineHeight: 18, marginTop: 4,
  },

  clearCard: {
    marginTop: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    padding: 14,
  },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clearIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#DCFCE7',
    alignItems: 'center', justifyContent: 'center',
  },
  clearTitle: { fontSize: 14, fontWeight: '700', color: '#09090B' },
  clearBody: { fontSize: 12.5, color: '#15803D', lineHeight: 18, marginTop: 3 },
});
