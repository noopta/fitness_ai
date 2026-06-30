// Move-a-Day action block (design spec §7) — move a whole training session to
// another weekday, swapping it with whatever lands there. Hero is a 7-day strip
// of session chips; affected days are emphasized. Same Proposed -> Working ->
// Applied lifecycle + Undo as the Plan Patch card. (Chip-slide animation is the
// reduced-motion cross-fade by default; the spring slide is a device-tuned
// follow-up — structure + data are correct here.)
import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../../constants/theme';

const INK = '#09090b';
const SUCCESS_SOFT = '#dcfce7';
const SUCCESS_INK = '#15803d';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type CardState = 'applied' | 'dismissed' | 'applying' | 'failed' | undefined;

interface DayCell { date?: string; dayLabel?: string; session?: { day?: string; focus?: string } | null; isSwapped?: boolean; }

function weekdayOf(d: DayCell, idx: number): string {
  if (typeof d?.date === 'string') {
    const dt = new Date(d.date + 'T00:00:00');
    const wd = dt.getUTCDay(); // 0=Sun
    return WEEKDAYS[(wd + 6) % 7]; // Mon-first
  }
  return d?.dayLabel?.slice(0, 3) ?? WEEKDAYS[idx % 7];
}

function shortSession(name?: string | null): string {
  if (!name) return 'Rest';
  return name.length > 6 ? name.slice(0, 6) : name;
}

export function MoveSessionCard({
  proposal,
  state,
  onApply,
  onDismiss,
  onUndo,
}: {
  proposal: { proposedWeek?: DayCell[]; rationale?: string; summary?: string; chosenSessionName?: string; weekNumber?: number | null };
  state: CardState;
  onApply: () => void;
  onDismiss: () => void;
  onUndo?: () => void;
}) {
  const applied = state === 'applied';
  const working = state === 'applying';
  const failed = state === 'failed';
  const week: DayCell[] = Array.isArray(proposal.proposedWeek) ? proposal.proposedWeek.slice(0, 7) : [];
  const statusWord = applied ? 'applied' : working ? 'applying…' : failed ? 'retry' : 'proposed';
  const dotColor = applied ? colors.success : working ? colors.mutedForeground : failed ? colors.destructive : colors.warning;

  if (state === 'dismissed') {
    return (
      <View style={styles.dismissedRow}>
        <Text style={styles.dismissedText}>Change dismissed</Text>
        <Pressable hitSlop={10} onPress={onApply}><Text style={styles.restoreLink}>Restore</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>PROPOSED · MOVE SESSION</Text>
        <View style={{ flex: 1 }} />
        {proposal.weekNumber != null ? <Text style={styles.headerScope}>Week {proposal.weekNumber} </Text> : null}
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
        <Text style={styles.statusWord}>{statusWord}</Text>
      </View>

      {/* 7-day strip */}
      <View style={styles.strip}>
        {week.map((d, i) => {
          const swapped = !!d?.isSwapped;
          const rest = !d?.session;
          return (
            <View key={d?.date ?? i} style={styles.col}>
              <Text style={[styles.weekday, swapped && styles.weekdayActive]}>{weekdayOf(d, i)}</Text>
              <View style={[
                styles.chip,
                rest ? styles.chipRest : styles.chipWork,
                swapped && styles.chipMoved,
                working && { opacity: 0.5 },
              ]}>
                <Text style={[styles.chipText, swapped && styles.chipTextMoved, rest && styles.chipTextRest]} numberOfLines={1}>
                  {shortSession(d?.session?.day)}
                </Text>
                {applied && swapped ? (
                  <View style={styles.chipCheck}><Ionicons name="checkmark" size={9} color="#fff" /></View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {proposal.summary ? <Text style={styles.summary}>{proposal.summary}</Text> : null}
      {proposal.rationale ? <Text style={styles.rationale}>{proposal.rationale}</Text> : null}

      {applied ? (
        <View style={styles.appliedStrip}>
          <Ionicons name="checkmark-circle" size={15} color={SUCCESS_INK} />
          <Text style={styles.appliedText}>Week rebalanced · nothing else changed</Text>
          <View style={{ flex: 1 }} />
          {onUndo ? <Pressable hitSlop={10} onPress={onUndo}><Text style={styles.undoLink}>Undo</Text></Pressable> : null}
        </View>
      ) : (
        <View style={styles.footer}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onDismiss} disabled={working} hitSlop={6}>
            <Text style={styles.btnGhostText}>Keep as is</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary, working && { opacity: 0.6 }]} onPress={onApply} disabled={working} hitSlop={6}>
            {working ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>{failed ? 'Retry' : 'Move session'}</Text>}
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
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, overflow: 'hidden', marginTop: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: INK, paddingHorizontal: 13, paddingVertical: 10 },
  headerEyebrow: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, ...MONO },
  headerScope: { color: 'rgba(255,255,255,0.55)', fontSize: 11, ...MONO },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusWord: { color: 'rgba(255,255,255,0.85)', fontSize: 11, ...MONO },

  strip: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 12, gap: 3 },
  col: { flex: 1, alignItems: 'center', gap: 5 },
  weekday: { fontSize: 10, fontWeight: '700', color: colors.mutedForeground },
  weekdayActive: { color: colors.foreground },
  chip: { width: '100%', minHeight: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  chipWork: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  chipRest: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#d4d4d8', backgroundColor: colors.background },
  chipMoved: { backgroundColor: INK, borderColor: INK },
  chipText: { fontSize: 10, fontWeight: '700', color: colors.foreground },
  chipTextMoved: { color: '#fff' },
  chipTextRest: { color: colors.mutedForeground },
  chipCheck: { position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },

  summary: { fontSize: 13, fontWeight: '600', color: colors.foreground, paddingHorizontal: 13, paddingBottom: 4 },
  rationale: { fontSize: 13, color: colors.mutedForeground, lineHeight: 18, paddingHorizontal: 13, paddingBottom: 11 },

  footer: { flexDirection: 'row', gap: 9, padding: 11, borderTopWidth: 1, borderTopColor: colors.border },
  btn: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  btnGhostText: { color: colors.foreground, fontWeight: '600', fontSize: 14 },
  btnPrimary: { backgroundColor: INK },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  appliedStrip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: SUCCESS_SOFT, paddingHorizontal: 13, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border },
  appliedText: { color: SUCCESS_INK, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  undoLink: { color: SUCCESS_INK, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  errorNote: { color: colors.destructive, fontSize: 12, paddingHorizontal: 13, paddingBottom: 11 },

  dismissedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
  dismissedText: { color: colors.mutedForeground, fontSize: 13 },
  restoreLink: { color: colors.foreground, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
