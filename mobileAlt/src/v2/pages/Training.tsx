// Training (index 1): the current program — phase rows, the week strip, past
// programs, diagnostics history. Every row pushes a page; no sub-navigation.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { v2, T } from '../theme';
import { TabPage, PageTitle, AnakinRead } from '../shell/Page';
import { Row, Eyebrow } from '../primitives/Row';
import { Enter } from '../primitives/Enter';
import { TextAction } from '../primitives/TextAction';
import { ProgressHairline } from '../charts';
import { useProgram, useSchedule, useToday } from '../data';
import { useShell } from '../shell/ShellContext';

export function programPhases(program: any): { name: string; weeks: number; focus: string; index: number }[] {
  const phases: any[] = program?.phases ?? [];
  return phases.map((p, i) => ({
    name: p.name || p.phaseName || `Phase ${i + 1}`,
    weeks: p.durationWeeks ?? p.weeks ?? 1,
    focus: p.focus || p.description || p.goal || (Array.isArray(p.trainingDays ?? p.days) ? `${(p.trainingDays ?? p.days).length} sessions a week` : ''),
    index: i,
  }));
}

export function TrainingPage() {
  const router = useRouter();
  const shell = useShell();
  const program = useProgram();
  const schedule = useSchedule();
  const today = useToday();
  const p = program.data?.program ?? program.data?.savedProgram ?? program.data ?? null;
  const hasProgram = !!(p && (p.phases?.length || p.name || p.goal));
  const phases = programPhases(p);
  const weekNumber: number | null = schedule.data?.weekNumber ?? today.data?.weekNumber ?? null;
  const totalWeeks: number = p?.durationWeeks ?? phases.reduce((s, x) => s + x.weeks, 0) ?? 0;
  const phaseName: string | null = schedule.data?.phaseName ?? today.data?.phaseName ?? null;
  const currentPhaseIdx = Math.max(0, phases.findIndex((x) => x.name === phaseName));
  const weekDays: any[] = schedule.data?.weekDays ?? [];
  const refreshing = program.isFetching || schedule.isFetching;
  const onRefresh = () => { void program.refetch(); void schedule.refetch(); void today.refetch(); };

  const goal = p?.goal || p?.name || 'Your program';
  const caption = hasProgram && weekNumber ? `Week ${weekNumber} of ${totalWeeks}${phaseName ? ` · ${phaseName}` : ''}` : hasProgram ? 'Starting soon' : 'No program yet';

  return (
    <TabPage refreshing={refreshing} onRefresh={onRefresh}>
      <PageTitle title={goal} caption={caption} />
      {hasProgram && totalWeeks > 0 ? (
        <Enter index={1} exit={false}><View style={{ marginTop: 18 }}><ProgressHairline fraction={(weekNumber ?? 0) / totalWeeks} /></View></Enter>
      ) : null}

      {!hasProgram && !program.isLoading ? (
        <View style={{ marginTop: 28 }}>
          <AnakinRead text="No program on file. Tell me what you're working toward and I'll build the first week." />
          <TextAction primary onPress={() => router.push('/(v2)/onboarding' as any)} style={{ marginTop: 18 }}>Build a program</TextAction>
        </View>
      ) : null}

      {phases.length ? (
        <View style={{ marginTop: 34 }}>
          <Eyebrow>Phases</Eyebrow>
          <View style={{ marginTop: 12 }}>
            {phases.map((ph, i) => (
              <Enter key={ph.name + i} index={i + 2} exit={false}>
                <Row name={ph.name} sub={ph.focus || undefined} value={`${ph.weeks} wk`} muted={i !== currentPhaseIdx} emphasis={i === currentPhaseIdx} last={i === phases.length - 1}
                  onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: `phase:${i}` } } as any)} />
              </Enter>
            ))}
          </View>
        </View>
      ) : null}

      {weekDays.length ? (
        <View style={{ marginTop: 34 }}>
          <Eyebrow>This week</Eyebrow>
          <WeekStrip days={weekDays} onDay={(d) => {
            if (d?.session && d?.isToday && !d?.isLogged) router.push('/(v2)/session' as any);
            else if (d?.session) router.push({ pathname: '/(v2)/p/[key]', params: { key: `day:${d.date}` } } as any);
          }} />
          <Text style={[T.caption, { marginTop: 10 }]}>Tap a day to open it — or ask Anakin to move one.</Text>
          <TextAction muted size={15} onPress={() => shell.ask("I can't train tomorrow. Move it?")} style={{ marginTop: 4 }}>Ask Anakin to rearrange</TextAction>
        </View>
      ) : null}

      <View style={{ marginTop: 34 }}>
        <Row name="Past programs" sub="Finished programs are reference — Anakin reads them before writing a new one" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'past' } } as any)} />
        <Row name="Diagnostics" sub="Every form analysis and lift diagnostic Anakin has run" onPress={() => router.push({ pathname: '/(v2)/p/[key]', params: { key: 'diag' } } as any)} last />
      </View>
    </TabPage>
  );
}

/** M–S tiles: done greyed, today ink, rest hairline. Taps only — the track owns the swipe. */
export function WeekStrip({ days, onDay, proposalDates }: { days: any[]; onDay?: (d: any) => void; proposalDates?: string[] }) {
  const letters = 'MTWTFSS'.split('');
  return (
    <View style={{ marginTop: 12 }}>
      <View style={styles.strip}>
        {days.slice(0, 7).map((d, i) => {
          const done = !!d.isLogged || (!!d.isPast && !!d.session && d.isLogged !== false && d.isPast && d.isLogged);
          const today = !!d.isToday;
          const rest = !d.session;
          const proposed = proposalDates?.includes(String(d.date).slice(0, 10));
          const bg = today ? v2.color.ink : done ? v2.color.surface : v2.color.white;
          const border = proposed ? v2.color.crimson : today ? v2.color.ink : rest || done ? v2.color.surface : v2.color.hairline;
          const ink = today ? v2.color.white : done || rest ? v2.color.placeholder : v2.color.ink;
          const sub = rest ? '' : done ? 'Done' : today ? 'Today' : (d.session?.minutes ? `${d.session.minutes}m` : '');
          return (
            <Pressable key={d.date ?? i} onPress={() => onDay?.(d)} style={[styles.tile, { backgroundColor: bg, borderColor: border, borderStyle: proposed ? 'dashed' : 'solid' }]} accessibilityLabel={`${letters[i]} ${d.session?.name ?? 'Rest'}`}>
              <Text style={[styles.tileName, { color: ink, fontFamily: rest ? v2.font.regular : v2.font.semibold }]} numberOfLines={1}>{rest ? 'Rest' : (d.session?.name ?? d.session?.day ?? 'Session').split(' ')[0]}</Text>
              {sub ? <Text style={[styles.tileSub, { color: today ? v2.color.darkMuted : v2.color.muted }]}>{sub}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.letters}>
        {letters.map((l, i) => <Text key={i} style={[T.caption, { flex: 1, textAlign: 'center', color: days[i]?.isToday ? v2.color.ink : v2.color.placeholder, fontFamily: days[i]?.isToday ? v2.font.bold : v2.font.medium }]}>{l}</Text>)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, minHeight: 58, borderWidth: 1, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileName: { fontSize: 11.5, letterSpacing: -0.1 },
  tileSub: { fontSize: 10, fontFamily: v2.font.regular },
  letters: { flexDirection: 'row', gap: 6, marginTop: 6 },
});
