// Progress on the phone (design handoff §6.5): KPI tiles, lift chips and one
// row per client — estimated 1RM, the weekly trend, change, adherence and a
// status in words. A segmented control switches to the client report.

import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  COPY, seriesDomain,
  type LiftKey, type MeResponse, type ProgressRow, type ProgressStatus, type Tone,
} from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Avatar, FilterChip, MAX_FONT_SCALE, Notice, Pill, Sparkline, clientPath } from './components';
import { ActionButton, SegmentedControl, SwitchRow } from './controls';
import { useProgress } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { ProgressReport } from './ProgressReport';
import { Screen } from './Screen';

const WEEKS = 6;
const STATUS_TONE: Record<ProgressStatus, Tone> = { progressing: 'green', plateau: 'amber', regressing: 'red', noData: 'zinc' };
const LINE_TONE: Record<ProgressStatus, 'red' | 'amber' | 'ink'> = { progressing: 'ink', plateau: 'amber', regressing: 'red', noData: 'ink' };
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} ${unit}`;

function Row({ row, unit, onPress }: { row: ProgressRow; unit: string; onPress: () => void }) {
  const status = COPY.progress.status[row.status];
  const e1rm = row.e1rm === null ? MOBILE_COPY.noValue : `${row.e1rm} ${unit}`;
  const change = row.change === null ? MOBILE_COPY.noValue : signed(row.change, unit);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        row.client.name, row.lift, status,
        `${COPY.progress.columns.e1rm} ${e1rm}`, `${COPY.progress.columns.change} ${change}`, `${COPY.progress.columns.adherence} ${row.adherence}%`,
      ].join('. ')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowTop}>
        <Avatar initials={row.client.initials} />
        <View style={styles.rowText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.name}>{row.client.name}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.caption}>{row.note ?? row.lift}</Text>
        </View>
        <Pill tone={STATUS_TONE[row.status]}>{status}</Pill>
      </View>
      <View style={styles.rowNumbers}>
        <View style={styles.cell}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.e1rm}>{e1rm}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.progress.columns.e1rm}</Text>
        </View>
        {row.series.length === 0
          ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caption, styles.trend]}>{MOBILE_COPY.noValue}</Text>
          : (
            <Sparkline
              series={row.series} width={96} height={28} domain={seriesDomain(row.series)} tone={LINE_TONE[row.status]} band={row.status === 'plateau'}
              label={COPY.progress.seriesAlt(row.client.name, row.lift, status)}
            />
          )}
        <View style={styles.cellRight}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.number}>{change}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.progress.columns.change}</Text>
        </View>
        <View style={styles.cellRight}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.number}>{MOBILE_COPY.progress.adherence(row.adherence)}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.progress.columns.adherence}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function RosterTab() {
  const router = useRouter();
  const [lift, setLift] = useState<LiftKey>('squat');
  const [only, setOnly] = useState(false);
  const progress = useProgress(lift, WEEKS);
  const rows = useMemo(() => (progress.data?.rows ?? []).filter((r) => !only || r.status === 'plateau' || r.status === 'regressing'), [only, progress.data]);

  const kpis = progress.data?.kpis;
  const tiles: [string, number | undefined][] = [[COPY.progress.kpiProgressing, kpis?.progressing], [COPY.progress.kpiPlateau, kpis?.plateau], [COPY.progress.kpiPrs, kpis?.prsThisMonth]];
  const unit = progress.data?.unit ?? '';

  const header = (
    <View style={styles.header}>
      <View style={styles.tiles}>
        {tiles.map(([label, value]) => (
          <View key={label} style={styles.tile} accessible accessibilityLabel={`${label}: ${value ?? MOBILE_COPY.noValue}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.tileValue}>{value ?? MOBILE_COPY.noValue}</Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{label}</Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll} accessibilityLabel={MOBILE_COPY.progress.lift}>
        {(progress.data?.lifts ?? [{ key: 'squat' as LiftKey, label: 'Squat' }]).map((l) => (
          <FilterChip key={l.key} active={lift === l.key} onPress={() => setLift(l.key)} label={l.label} />
        ))}
      </ScrollView>
      <View style={styles.toggle}>
        <SwitchRow label={COPY.progress.onlyPlateaus} value={only} onValueChange={setOnly} />
      </View>
    </View>
  );

  const empty = progress.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={96} />)}
    </View>
  ) : progress.isError ? (
    <Notice alert action={<ActionButton variant="secondary" onPress={() => progress.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.progress.loadFailed}</Notice>
  ) : (
    <Notice>{COPY.progress.empty}</Notice>
  );

  return (
    <FlatList
      data={progress.isError ? [] : rows}
      keyExtractor={(r) => r.clientId}
      renderItem={({ item }) => <Row row={item} unit={unit} onPress={() => router.navigate(clientPath(item.clientId) as any)} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={progress.isRefetching} onRefresh={() => progress.refetch()} tintColor={colors.mutedForeground} />}
    />
  );
}

export function ProgressScreen({ me }: { me: MeResponse }) {
  const [tab, setTab] = useState<'roster' | 'report'>('roster');
  return (
    <Screen me={me} title={COPY.progress.title} active="progress">
      <SegmentedControl
        style={styles.segments}
        label={COPY.progress.title}
        value={tab}
        onChange={setTab}
        options={[{ value: 'roster', label: COPY.progress.roster }, { value: 'report', label: COPY.progress.report }]}
      />
      {tab === 'roster' ? <RosterTab /> : <ProgressReport />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  segments: { marginHorizontal: spacing.md, marginTop: 12, marginBottom: 4 },
  list: { paddingBottom: spacing.xl },
  header: { paddingTop: spacing.md, gap: 12 },
  tiles: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  tile: { flex: 1, padding: 12, gap: 6, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  tileValue: { fontSize: 26, lineHeight: 30, fontWeight: fontWeight.bold, letterSpacing: -0.5, color: colors.foreground, fontVariant: ['tabular-nums'] },
  chipScroll: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  toggle: { paddingHorizontal: spacing.md },
  skeletons: { paddingHorizontal: spacing.md, gap: spacing.sm },
  separator: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border, marginLeft: spacing.md },
  row: { paddingHorizontal: spacing.md, paddingVertical: 12, gap: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  rowNumbers: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cell: { flex: 1 },
  cellRight: { alignItems: 'flex-end' },
  trend: { width: 96, textAlign: 'center' },
  e1rm: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground, fontVariant: ['tabular-nums'] },
  number: { fontSize: fontSize.sm, color: colors.zinc600, fontVariant: ['tabular-nums'] },
});
