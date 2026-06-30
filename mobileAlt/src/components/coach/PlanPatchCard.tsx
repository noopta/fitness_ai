// Plan Patch action block (design spec §6) — swap one exercise on a day, shown
// as a code-review diff so the change is auditable. NOT a chat bubble: full
// width, bordered + elevated, dark instrument-panel header. Drives the
// Proposed -> Working -> Applied / Dismissed / Error lifecycle.
import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize, fontWeight } from '../../constants/theme';

export interface PlanPatchProposalData {
  day: string | null;
  scope: 'day' | 'program';
  from: { name: string; sets?: number | string; reps?: number | string };
  to: { name: string; sets?: number | string; reps?: number | string };
  meta?: { primaryTarget?: string[]; equipment?: string; stimulusDelta?: string; shoulderLoad?: string };
  rationale?: string;
}

// Spec tokens not in the base theme (Axiom design-system soft/ink values).
const DESTRUCTIVE_SOFT = '#fee2e2';
const DESTRUCTIVE_INK = '#dc2626';
const SUCCESS_SOFT = '#dcfce7';
const SUCCESS_INK = '#15803d';
const INK = '#09090b';

type CardState = 'applied' | 'dismissed' | 'applying' | 'failed' | undefined;

function scheme(x: { sets?: number | string; reps?: number | string }): string {
  if (x?.sets == null && x?.reps == null) return '';
  return `${x.sets ?? ''}${x.reps != null ? ` × ${x.reps}` : ''}`.trim();
}

function MetaCell({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function PlanPatchCard({
  proposal,
  state,
  onApply,
  onDismiss,
  onUndo,
}: {
  proposal: PlanPatchProposalData;
  state: CardState;
  onApply: () => void;
  onDismiss: () => void;
  onUndo?: () => void;
}) {
  const applied = state === 'applied';
  const working = state === 'applying';
  const failed = state === 'failed';
  const scopeLabel = proposal.scope === 'program' ? 'Whole plan' : (proposal.day ?? 'This day');
  const statusWord = applied ? 'applied' : working ? 'applying…' : failed ? 'retry' : 'proposed';
  const dotColor = applied ? colors.success : working ? colors.mutedForeground : failed ? colors.destructive : colors.warning;

  if (state === 'dismissed') {
    return (
      <View style={styles.dismissedRow}>
        <Text style={styles.dismissedText}>Change dismissed</Text>
        <Pressable hitSlop={10} onPress={onApply}>
          <Text style={styles.restoreLink}>Restore</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* Dark instrument-panel header — the "machine/tool" cue (spec §5) */}
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>PLAN PATCH</Text>
        <Text style={styles.headerScope} numberOfLines={1}> · {scopeLabel}</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
        <Text style={styles.statusWord}>{statusWord}</Text>
      </View>

      {/* Diff body — removed / added, code-review style */}
      <View style={styles.diffBody}>
        <View style={[styles.diffRow, styles.diffRemoved, working && { opacity: 0.45 }]}>
          <Text style={[styles.diffName, styles.removedText, applied && styles.struck]} numberOfLines={1}>− {proposal.from.name}</Text>
          <Text style={[styles.diffScheme, styles.removedText, applied && styles.struck]}>{scheme(proposal.from)}</Text>
        </View>
        <View style={[styles.diffRow, styles.diffAdded]}>
          <Text style={[styles.diffName, styles.addedText]} numberOfLines={1}>+ {proposal.to.name}</Text>
          <Text style={[styles.diffScheme, styles.addedText]}>{scheme(proposal.to)}</Text>
          {applied ? <Ionicons name="checkmark" size={14} color={SUCCESS_INK} style={{ marginLeft: 4 }} /> : null}
        </View>
      </View>

      {/* Meta grid — Target / Equipment / Stimulus Δ / Shoulder load */}
      {proposal.meta && (proposal.meta.primaryTarget?.length || proposal.meta.equipment || proposal.meta.stimulusDelta || proposal.meta.shoulderLoad) ? (
        <View style={styles.metaGrid}>
          <MetaCell label="Target" value={proposal.meta.primaryTarget?.join(' · ')} />
          <MetaCell label="Equipment" value={proposal.meta.equipment} />
          <MetaCell label="Stimulus Δ" value={proposal.meta.stimulusDelta} />
          <MetaCell label="Shoulder load" value={proposal.meta.shoulderLoad} />
        </View>
      ) : null}

      {proposal.rationale ? <Text style={styles.rationale}>{proposal.rationale}</Text> : null}

      {/* Footer — state-driven */}
      {applied ? (
        <View style={styles.appliedStrip}>
          <Ionicons name="checkmark-circle" size={15} color={SUCCESS_INK} />
          <Text style={styles.appliedText}>Patch applied{proposal.scope === 'day' && proposal.day ? ` to ${proposal.day}` : ''}</Text>
          <View style={{ flex: 1 }} />
          {onUndo ? (
            <Pressable hitSlop={10} onPress={onUndo}>
              <Text style={styles.undoLink}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.footer}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onDismiss} disabled={working} hitSlop={6}>
            <Text style={styles.btnGhostText}>Discard</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary, working && { opacity: 0.6 }]} onPress={onApply} disabled={working} hitSlop={6}>
            {working ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>{failed ? 'Retry' : 'Apply patch'}</Text>}
          </Pressable>
        </View>
      )}
      {failed ? <Text style={styles.errorNote}>Couldn't apply — tap Retry.</Text> : null}
    </View>
  );
}

const MONO = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background,
    overflow: 'hidden', marginTop: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: INK, paddingHorizontal: 13, paddingVertical: 10 },
  headerEyebrow: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, ...MONO },
  headerScope: { color: 'rgba(255,255,255,0.55)', fontSize: 11, ...MONO, flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusWord: { color: 'rgba(255,255,255,0.85)', fontSize: 11, ...MONO },

  diffBody: { padding: 11, gap: 6 },
  diffRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 6 },
  diffRemoved: { backgroundColor: DESTRUCTIVE_SOFT, borderLeftWidth: 3, borderLeftColor: colors.destructive },
  diffAdded: { backgroundColor: SUCCESS_SOFT, borderLeftWidth: 3, borderLeftColor: colors.success },
  diffName: { flex: 1, fontSize: 12.5, ...MONO },
  diffScheme: { fontSize: 12.5, ...MONO },
  removedText: { color: DESTRUCTIVE_INK },
  addedText: { color: SUCCESS_INK },
  struck: { textDecorationLine: 'line-through' },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: colors.border },
  metaCell: { width: '50%', paddingHorizontal: 13, paddingVertical: 9 },
  metaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: colors.mutedForeground, textTransform: 'uppercase' },
  metaValue: { fontSize: 12.5, fontWeight: '600', color: colors.foreground, marginTop: 2 },

  rationale: { fontSize: 13, color: colors.mutedForeground, lineHeight: 18, paddingHorizontal: 13, paddingBottom: 11 },

  footer: { flexDirection: 'row', gap: 9, padding: 11, borderTopWidth: 1, borderTopColor: colors.border },
  btn: { flex: 1, minHeight: 44, borderRadius: radius.sm ?? 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  btnGhostText: { color: colors.foreground, fontWeight: '600', fontSize: 14 },
  btnPrimary: { backgroundColor: INK },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  appliedStrip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: SUCCESS_SOFT, paddingHorizontal: 13, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border },
  appliedText: { color: SUCCESS_INK, fontSize: 13, fontWeight: '600' },
  undoLink: { color: SUCCESS_INK, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  errorNote: { color: colors.destructive, fontSize: 12, paddingHorizontal: 13, paddingBottom: 11 },

  dismissedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10,
  },
  dismissedText: { color: colors.mutedForeground, fontSize: 13 },
  restoreLink: { color: colors.foreground, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
