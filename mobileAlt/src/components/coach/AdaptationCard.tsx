// Adaptation Card — the one surface through which Axiom proposes a change to
// a program. Four sections, always in this order: what we noticed (numbers),
// why it matters (reasoning), the proposed change, and the decision. Nothing
// is applied until the user taps Apply; every applied card can be undone.
//
// Same instrument-panel language as PlanPatchCard (dark header, tabular
// numerals) so proposals read as tooling, not chat.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../constants/theme';
import { useUnits } from '../../context/UnitsContext';
import { KEYBOARD_DONE_ID } from '../ui/KeyboardDoneBar';

export interface AdaptationEvidence { label: string; value: string }

export interface AdaptationTargetSeed {
  key: string;
  exercise: string;
  targetWeightKg: number | null;
  targetRPE: number | null;
  repRange: { min: number; max: number };
  confidence: number;
  basis: string;
  finding: 'progressing' | 'plateau' | 'declining' | 'ready_to_bump' | 'insufficient' | 'calibrate';
  exposures: number;
  summary: string;
  spark: number[];
}

export type AdaptationPayload =
  | { kind: 'retrofit'; targets: AdaptationTargetSeed[] }
  | { kind: 'load_change'; key: string; exercise: string; fromWeightKg: number | null; toWeightKg: number; scope: string }
  | { kind: 'calibration'; key: string; exercise: string; targetWeightKg: number; targetRPE: number | null }
  | { kind: 'program_from_logs'; program: any; reason: 'no_program' | 'abandoned'; observed: {
      windowWeeks: number; sessions: number; weeks: number; sessionsPerWeek: number; split: string; goal: string; medianReps: number;
      days: Array<{ label: string; day: string; sessions: number; exercises: Array<{ exercise: string; sets: number; reps: number; weightKg: number | null; frequency: number }> }>;
    } }
  | { kind: string; [k: string]: any };

export interface AdaptationProposalData {
  id: string;
  kind: string;
  title: string;
  evidence: AdaptationEvidence[];
  reasoning: string;
  proposal: AdaptationPayload;
  confidence: number;
  status: string;
  createdAt?: string;
}

export type AdaptationCardState = 'idle' | 'working' | 'applied' | 'snoozed' | 'declined' | 'failed' | 'undone';

export interface TargetEdit { key: string; targetWeightKg: number | null }

const INK = '#09090b';
const SUCCESS_SOFT = '#dcfce7';
const SUCCESS_INK = '#15803d';
const WARN_SOFT = '#fef3c7';
const WARN_INK = '#b45309';
const BAD_SOFT = '#fee2e2';
const BAD_INK = '#b91c1c';
const MONO = { fontVariant: ['tabular-nums' as const] };

const FINDING_LABEL: Record<AdaptationTargetSeed['finding'], { text: string; soft: string; ink: string }> = {
  progressing: { text: 'progressing', soft: SUCCESS_SOFT, ink: SUCCESS_INK },
  ready_to_bump: { text: 'ready to bump', soft: SUCCESS_SOFT, ink: SUCCESS_INK },
  plateau: { text: 'plateau', soft: WARN_SOFT, ink: WARN_INK },
  declining: { text: 'slipping', soft: BAD_SOFT, ink: BAD_INK },
  insufficient: { text: 'few sessions', soft: colors.muted, ink: colors.mutedForeground },
  calibrate: { text: 'calibrate', soft: colors.muted, ink: colors.mutedForeground },
};

function kindLabel(kind: string): string {
  switch (kind) {
    case 'retrofit': return 'Your history';
    case 'program_from_logs': return 'Your training';
    case 'load_change': return 'Load';
    case 'calibration': return 'Calibration';
    default: return kind.replace(/_/g, ' ');
  }
}

function Sparkline({ values }: { values: number[] }) {
  // Tiny bar sparkline — no SVG dependency, reads fine at 14px tall.
  if (!values || values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = Math.max(max - min, 1);
  return (
    <View style={styles.spark}>
      {values.slice(-10).map((v, i) => (
        <View key={i} style={[styles.sparkBar, { height: 3 + Math.round(((v - min) / span) * 9) }]} />
      ))}
    </View>
  );
}

export function AdaptationCard({
  proposal, state, onApply, onSnooze, onDecline, onUndo, onAskCoach,
}: {
  proposal: AdaptationProposalData;
  state: AdaptationCardState;
  onApply: (edits?: TargetEdit[]) => void;
  onSnooze: () => void;
  onDecline: () => void;
  onUndo?: () => void;
  onAskCoach?: (prompt: string) => void;
}) {
  const { unit, fromKg, toKg } = useUnits();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const working = state === 'working';
  const applied = state === 'applied';
  const failed = state === 'failed';
  const statusWord = applied ? 'applied' : working ? 'applying…' : failed ? 'retry' : state === 'snoozed' ? 'snoozed' : state === 'declined' ? 'dismissed' : state === 'undone' ? 'undone' : 'proposed';
  const dotColor = applied ? colors.success : working ? colors.mutedForeground : failed ? colors.destructive : colors.warning;

  const fmt = (kg: number | null | undefined) => (kg == null ? '—' : `${fromKg(kg)} ${unit}`);
  const payload = proposal.proposal;
  const isRetrofit = payload.kind === 'retrofit';
  const isLoad = payload.kind === 'load_change';
  const isProgram = payload.kind === 'program_from_logs';
  const canEdit = isRetrofit || isLoad;

  const confidencePct = Math.round((proposal.confidence ?? 0) * 100);
  const confidenceNote = confidencePct < 70 ? 'log RPE to sharpen this' : null;

  function collectEdits(): TargetEdit[] | undefined {
    if (!editing) return undefined;
    const out: TargetEdit[] = [];
    for (const [key, raw] of Object.entries(edits)) {
      const t = raw.trim();
      if (t === '') continue;
      const n = parseFloat(t);
      if (!Number.isFinite(n) || n < 0) continue;
      out.push({ key, targetWeightKg: n === 0 ? null : Math.round(toKg(n) * 100) / 100 });
    }
    return out.length ? out : undefined;
  }

  const askPrompt = useMemo(() => {
    if (isLoad) {
      const p = payload as Extract<AdaptationPayload, { kind: 'load_change' }>;
      return `About your suggestion to move my ${p.exercise} from ${fmt(p.fromWeightKg)} to ${fmt(p.toWeightKg)} — `;
    }
    if (isProgram) return `About the program you built from my training logs — I'd rather `;
    return `About the targets you suggested from my training history — `;
  }, [isLoad, payload, unit]);

  if (state === 'declined' || state === 'snoozed') {
    return (
      <View style={styles.dismissedRow}>
        <Text style={styles.dismissedText}>{state === 'snoozed' ? 'Snoozed for a week' : 'Dismissed'} · {proposal.title}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>AXIOM NOTICED</Text>
        <Text style={styles.headerScope} numberOfLines={1}> · {kindLabel(proposal.kind)}</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
        <Text style={styles.statusWord}>{statusWord}</Text>
      </View>

      <Text style={styles.title}>{proposal.title}</Text>

      {/* 1 · What we noticed */}
      {proposal.evidence?.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHAT WE NOTICED</Text>
          {proposal.evidence.map((e, i) => (
            <View key={i} style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel} numberOfLines={1}>{e.label}</Text>
              <Text style={styles.evidenceValue}>{e.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 2 · Why it matters */}
      {proposal.reasoning ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHY IT MATTERS</Text>
          <Text style={styles.reasoning}>{proposal.reasoning}</Text>
        </View>
      ) : null}

      {/* 3 · Proposed change */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{isRetrofit ? 'PROPOSED TARGETS' : isProgram ? 'PROPOSED PROGRAM' : 'PROPOSED CHANGE'}</Text>

        {isProgram ? (() => {
          const p = payload as Extract<AdaptationPayload, { kind: 'program_from_logs' }>;
          return (
            <View style={styles.targetList}>
              <Text style={styles.programSummary}>{p.observed.split} · {p.observed.sessionsPerWeek}×/week · {p.observed.goal}</Text>
              {p.observed.days.map(d => (
                <View key={d.label} style={styles.programDay}>
                  <View style={styles.targetTop}>
                    <Text style={styles.targetName}>{d.day}</Text>
                    <Text style={styles.targetSummary}>{d.sessions} session{d.sessions === 1 ? '' : 's'} seen</Text>
                  </View>
                  {d.exercises.map(e => (
                    <View key={e.exercise} style={styles.programExRow}>
                      <Text style={styles.programExName} numberOfLines={1}>{e.exercise}</Text>
                      <Text style={styles.programExScheme}>{e.sets} × {e.reps}{e.weightKg != null ? ` · ${fmt(e.weightKg)}` : ''}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          );
        })() : null}

        {isLoad ? (() => {
          const p = payload as Extract<AdaptationPayload, { kind: 'load_change' }>;
          return (
            <View style={styles.changeRow}>
              <Text style={styles.changeName} numberOfLines={1}>{p.exercise}</Text>
              <Text style={[styles.changeFrom, applied && styles.struck]}>{fmt(p.fromWeightKg)}</Text>
              <Ionicons name="arrow-forward" size={12} color={colors.mutedForeground} style={{ marginHorizontal: 6 }} />
              {editing ? (
                <TextInput
                  style={styles.editInput}
                  keyboardType="decimal-pad"
                  defaultValue={String(fromKg(p.toWeightKg))}
                  onChangeText={v => setEdits(prev => ({ ...prev, [p.key]: v }))}
                  inputAccessoryViewID={KEYBOARD_DONE_ID}
                />
              ) : (
                <Text style={styles.changeTo}>{fmt(p.toWeightKg)}</Text>
              )}
            </View>
          );
        })() : null}

        {isRetrofit ? (
          <View style={styles.targetList}>
            {(payload as Extract<AdaptationPayload, { kind: 'retrofit' }>).targets.map(t => {
              const f = FINDING_LABEL[t.finding] ?? FINDING_LABEL.insufficient;
              return (
                <View key={t.key} style={styles.targetRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.targetTop}>
                      <Text style={styles.targetName} numberOfLines={1}>{t.exercise}</Text>
                      <View style={[styles.pill, { backgroundColor: f.soft }]}>
                        <Text style={[styles.pillText, { color: f.ink }]}>{f.text}</Text>
                      </View>
                    </View>
                    <View style={styles.targetMeta}>
                      <Text style={styles.targetSummary} numberOfLines={1}>{t.summary}</Text>
                      <Sparkline values={t.spark} />
                    </View>
                  </View>
                  <View style={styles.targetValueCol}>
                    {editing && t.finding !== 'calibrate' ? (
                      <TextInput
                        style={styles.editInput}
                        keyboardType="decimal-pad"
                        defaultValue={t.targetWeightKg != null ? String(fromKg(t.targetWeightKg)) : ''}
                        placeholder="—"
                        placeholderTextColor={colors.mutedForeground}
                        onChangeText={v => setEdits(prev => ({ ...prev, [t.key]: v }))}
                        inputAccessoryViewID={KEYBOARD_DONE_ID}
                      />
                    ) : (
                      <Text style={[styles.targetValue, t.targetWeightKg == null && { color: colors.mutedForeground }]}>{fmt(t.targetWeightKg)}</Text>
                    )}
                    <Text style={styles.targetScheme}>× {t.repRange.min === t.repRange.max ? t.repRange.min : `${t.repRange.min}–${t.repRange.max}`}{t.targetRPE != null ? ` @${t.targetRPE}` : ''}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.confidence}>
          Confidence {confidencePct}%{confidenceNote ? ` · ${confidenceNote}` : ''}
        </Text>
      </View>

      {/* 4 · Decision */}
      {applied ? (
        <View style={styles.appliedStrip}>
          <Ionicons name="checkmark-circle" size={15} color={SUCCESS_INK} />
          <Text style={styles.appliedText}>{isRetrofit ? 'Targets set' : isProgram ? 'This is now your program' : 'Applied to your program'}</Text>
          <View style={{ flex: 1 }} />
          {onUndo ? (
            <Pressable hitSlop={10} onPress={onUndo}>
              <Text style={styles.undoLink}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : state === 'undone' ? (
        <View style={styles.dismissedRow}><Text style={styles.dismissedText}>Change undone</Text></View>
      ) : (
        <>
          <View style={styles.footer}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onSnooze} disabled={working} hitSlop={6}>
              <Text style={styles.btnGhostText}>Not now</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary, working && { opacity: 0.6 }]} onPress={() => onApply(collectEdits())} disabled={working} hitSlop={6}>
              {working ? <ActivityIndicator size="small" color="#fff" /> : (
                <Text style={styles.btnPrimaryText}>{failed ? 'Retry' : isRetrofit ? (editing ? 'Use edited targets' : 'Use these') : isProgram ? 'Make this my program' : 'Apply'}</Text>
              )}
            </Pressable>
          </View>
          <View style={styles.linkRow}>
            {canEdit ? (
              <Pressable hitSlop={8} onPress={() => setEditing(e => !e)}>
                <Text style={styles.link}>{editing ? 'Stop editing' : 'Let me edit'}</Text>
              </Pressable>
            ) : null}
            {onAskCoach ? (
              <Pressable hitSlop={8} onPress={() => onAskCoach(askPrompt)}>
                <Text style={styles.link}>Ask coach ↗</Text>
              </Pressable>
            ) : null}
            <Pressable hitSlop={8} onPress={onDecline}>
              <Text style={[styles.link, { color: colors.mutedForeground }]}>Don't suggest this</Text>
            </Pressable>
          </View>
          {failed ? <Text style={styles.errorNote}>Couldn't apply — tap Retry.</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background,
    overflow: 'hidden', marginTop: 8, marginBottom: spacing.md,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: INK, paddingHorizontal: 13, paddingVertical: 10 },
  headerEyebrow: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, ...MONO },
  headerScope: { color: 'rgba(255,255,255,0.55)', fontSize: 11, ...MONO, flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusWord: { color: 'rgba(255,255,255,0.85)', fontSize: 11, ...MONO },

  title: { fontSize: 15, fontWeight: '700', color: colors.foreground, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 4, lineHeight: 20 },

  section: { paddingHorizontal: 13, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.mutedForeground, marginBottom: 6 },

  evidenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 3, gap: 12 },
  evidenceLabel: { fontSize: 12.5, color: colors.mutedForeground, flexShrink: 1 },
  evidenceValue: { fontSize: 12.5, fontWeight: '600', color: colors.foreground, ...MONO, textAlign: 'right', flexShrink: 0, maxWidth: '62%' },

  reasoning: { fontSize: 13, color: colors.foreground, lineHeight: 19 },

  changeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  changeName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.foreground, marginRight: 8 },
  changeFrom: { fontSize: 13, color: colors.mutedForeground, ...MONO },
  changeTo: { fontSize: 14, fontWeight: '700', color: colors.foreground, ...MONO },
  struck: { textDecorationLine: 'line-through' },

  targetList: { gap: 2 },
  targetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 10 },
  targetTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetName: { fontSize: 13, fontWeight: '600', color: colors.foreground, flexShrink: 1 },
  targetMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  targetSummary: { fontSize: 11.5, color: colors.mutedForeground, flexShrink: 1, ...MONO },
  targetValueCol: { alignItems: 'flex-end', minWidth: 74 },
  targetValue: { fontSize: 14, fontWeight: '700', color: colors.foreground, ...MONO },
  targetScheme: { fontSize: 10.5, color: colors.mutedForeground, ...MONO, marginTop: 1 },

  programSummary: { fontSize: 12.5, fontWeight: '600', color: colors.foreground, marginBottom: 6, ...MONO },
  programDay: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  programExRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 2, gap: 10 },
  programExName: { flex: 1, fontSize: 12.5, color: colors.foreground },
  programExScheme: { fontSize: 12, color: colors.mutedForeground, ...MONO },

  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },

  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  sparkBar: { width: 3, borderRadius: 1, backgroundColor: colors.mutedForeground, opacity: 0.6 },

  editInput: {
    minWidth: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
    fontSize: 13, fontWeight: '700', color: colors.foreground, textAlign: 'right', backgroundColor: colors.muted, ...MONO,
  },

  confidence: { fontSize: 11, color: colors.mutedForeground, marginTop: 8, ...MONO },

  footer: { flexDirection: 'row', gap: 9, paddingHorizontal: 11, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.border },
  btn: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  btnGhostText: { color: colors.foreground, fontWeight: '600', fontSize: 14 },
  btnPrimary: { backgroundColor: INK },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 13, paddingVertical: 10, gap: 12, flexWrap: 'wrap' },
  link: { fontSize: 12.5, fontWeight: '600', color: colors.foreground, textDecorationLine: 'underline' },

  appliedStrip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: SUCCESS_SOFT, paddingHorizontal: 13, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border },
  appliedText: { color: SUCCESS_INK, fontSize: 13, fontWeight: '600' },
  undoLink: { color: SUCCESS_INK, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  errorNote: { color: colors.destructive, fontSize: 12, paddingHorizontal: 13, paddingBottom: 11 },

  dismissedRow: {
    marginTop: 8, marginBottom: spacing.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10,
  },
  dismissedText: { color: colors.mutedForeground, fontSize: 13 },
});
