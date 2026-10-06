// The two things that let a workout be logged after the fact: which day it
// was (a row of chips back BACKFILL_DAYS — plain views, no native date picker, so
// it ships without a new build), and "Paste from notes", which reads workouts
// kept in the phone's notes app into sessions to review in the log form.

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, radius } from '../../constants/theme';
import { workoutsApi, type ParsedNoteWorkout } from '../../lib/api';

// ~4 months: far enough for "I stopped logging in July". Further back goes through
// Paste from notes or Anakin, which read dates up to a year old.
export const BACKFILL_DAYS = 120;

export function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Yesterday", or "Tue 29 Sep". */
export function dayLabel(date: string, today = localDateStr()): string {
  if (date === today) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const t = new Date(`${today}T12:00:00`);
  if (Math.round((t.getTime() - dt.getTime()) / 86_400_000) === 1) return 'Yesterday';
  return `${WEEKDAY[dt.getDay()]} ${d} ${MONTH[m - 1]}`;
}

/** Chips from today back BACKFILL_DAYS. A date older than that (opened from the program week) is shown first. */
export function DateChips({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const days = Array.from({ length: BACKFILL_DAYS + 1 }, (_, i) => daysAgo(i));
  if (!days.includes(value)) days.unshift(value);
  return (
    <View>
      <Text style={styles.label}>When was it?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {days.map((d) => {
          const on = d === value;
          return (
            <TouchableOpacity
              key={d}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => onChange(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Log for ${dayLabel(d)}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{dayLabel(d)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Paste box → "Read workouts" → the sessions found, handed to the form one at a time. */
export function PasteFromNotes({ onSessions }: { onSessions: (workouts: ParsedNoteWorkout[], unit: 'kg' | 'lbs', unparsed: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await workoutsApi.parseNotes(t);
      if (!r.workouts.length) {
        setError('No exercises found in that. Try pasting one day with its sets and reps.');
        return;
      }
      onSessions(r.workouts, r.unit, r.unparsed);
      setOpen(false);
      setText('');
    } catch (e: any) {
      setError(e?.message || 'Could not read that just now. Try again, or log it by hand.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <TouchableOpacity style={styles.pasteLink} onPress={() => setOpen(true)} accessibilityRole="button">
        <Ionicons name="clipboard-outline" size={15} color={colors.primary} />
        <Text style={styles.pasteLinkText}>Paste from notes</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.pasteBox}>
      <View style={styles.pasteHead}>
        <Text style={styles.pasteTitle}>Paste from notes</Text>
        <TouchableOpacity onPress={() => { setOpen(false); setError(null); }} hitSlop={10} accessibilityLabel="Close paste from notes">
          <Ionicons name="close" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
      <Text style={styles.pasteHelp}>Paste one day or several. Put the date above each day if you have it. You check every session before it is saved.</Text>
      <TextInput
        style={styles.pasteInput}
        multiline
        textAlignVertical="top"
        value={text}
        onChangeText={setText}
        placeholder={'Mon 29 Sep\nBench 3x8 135\nIncline DB 3x10 50s\nPull-ups 3x8'}
        placeholderTextColor={colors.mutedForeground}
        maxLength={40000}
        accessibilityLabel="Workout notes"
        autoFocus
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={[styles.readBtn, (!text.trim() || busy) && { opacity: 0.5 }]} onPress={read} disabled={!text.trim() || busy} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={styles.readBtnText}>Read workouts</Text>}
      </TouchableOpacity>
    </View>
  );
}

/** "Session 2 of 3 from your notes", with Skip. */
export function SessionQueueBar({ index, total, onSkip }: { index: number; total: number; onSkip: () => void }) {
  return (
    <View style={styles.queueBar}>
      <Ionicons name="clipboard-outline" size={14} color={colors.primary} />
      <Text style={styles.queueText}>Session {index + 1} of {total} from your notes. Check it, then save.</Text>
      <TouchableOpacity onPress={onSkip} hitSlop={8} accessibilityRole="button"><Text style={styles.queueSkip}>{index + 1 < total ? 'Skip' : 'Done'}</Text></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: fontSize.sm, color: colors.foreground, fontWeight: fontWeight.medium, marginBottom: 6 },
  chips: { gap: 6, paddingRight: spacing.md },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.background },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.xs, color: colors.foreground, fontWeight: fontWeight.medium },
  chipTextOn: { color: colors.primaryForeground },
  pasteLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  pasteLinkText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.semibold },
  pasteBox: { backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm, gap: spacing.xs },
  pasteHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pasteTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  pasteHelp: { fontSize: fontSize.xs, color: colors.mutedForeground },
  pasteInput: { minHeight: 140, maxHeight: 260, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, fontSize: fontSize.sm, color: colors.foreground },
  error: { fontSize: fontSize.xs, color: colors.destructive },
  readBtn: { height: 40, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  readBtnText: { color: colors.primaryForeground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  queueBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.primary}12`, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8 },
  queueText: { flex: 1, fontSize: fontSize.xs, color: colors.foreground },
  queueSkip: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
});
