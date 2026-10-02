// Dossier overview (design handoff §6.3): the summary paragraph with what it
// is based on, key stats, the current block, what is waiting on the trainer
// and recent PRs. Every figure comes from the server.

import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COPY, relativeDay, type ClientOverview as Overview } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, EvidenceList, MAX_FONT_SCALE, Notice, Pill } from './components';
import { ActionButton, Disclosure } from './controls';
import { useOverview } from './hooks';
import { MOBILE_COPY } from './mobileCopy';

function Summary({ summary }: { summary: Overview['summary'] }) {
  const [basis, setBasis] = useState(false);
  const updated = relativeDay(summary.updatedAt);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Eyebrow>{COPY.dossier.summary}</Eyebrow>
        {updated ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.dossier.updated(updated.toLowerCase())}</Text> : null}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.summary}>{summary.text}</Text>
      <Disclosure label={COPY.dossier.summaryBasis} open={basis} onToggle={() => setBasis((v) => !v)}>
        <EvidenceList reasons={summary.evidence.reasons} sources={summary.evidence.sources} />
      </Disclosure>
    </View>
  );
}

function Body({ overview, onOpenBriefing }: { overview: Overview; onOpenBriefing: () => void }) {
  const { block } = overview;
  return (
    <View style={styles.body}>
      {/* A summary without its reasons is an error, never something to show (handoff §2.2). */}
      {(overview.summary?.evidence?.reasons?.length ?? 0) > 0 && <Summary summary={overview.summary} />}

      {overview.stats.length > 0 && (
        <View style={styles.block}>
          <Eyebrow>{COPY.dossier.keyStats}</Eyebrow>
          <View style={styles.grid}>
            {overview.stats.map((s) => (
              <View key={s.label} style={styles.stat} accessible accessibilityLabel={[s.label, s.value, s.delta].filter(Boolean).join(', ')}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{s.label}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.statValue}>{s.value}</Text>
                {s.delta ? (s.tone ? <Pill tone={s.tone}>{s.delta}</Pill> : <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.delta}>{s.delta}</Text>) : null}
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.block}>
        <Eyebrow>{COPY.dossier.currentBlock}</Eyebrow>
        {block ? (
          <View style={styles.card}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.name}>{block.blockLabel}</Text>
            {block.goal ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{block.goal}</Text> : null}
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={COPY.dossier.blockProgress(block.week, block.weeks)}
              accessibilityValue={{ min: 0, max: block.weeks, now: block.week }}
              style={styles.segments}
            >
              {/* Four segments, as in the handoff: quarters of the block rather than one bar per week. */}
              {[1, 2, 3, 4].map((q) => (
                <View key={q} style={[styles.segment, block.weeks > 0 && block.week / block.weeks > (q - 1) / 4 && styles.segmentDone]} />
              ))}
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.captionNumber}>{COPY.dossier.blockProgress(block.week, block.weeks)}</Text>
          </View>
        ) : <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.empty}>{COPY.roster.noProgram}</Text>}
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.dossier.openItems}</Eyebrow>
        {overview.openItems.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.empty}>{COPY.dossier.noOpenItems}</Text> : (
          <>
            <View style={styles.listCard}>
              {overview.openItems.map((item, i) => (
                <View key={item.id} style={[styles.openItem, i > 0 && styles.rowBorder]}>
                  <Pill tone={item.severity === 'attention' ? 'red' : 'amber'}>{item.severity === 'attention' ? COPY.briefing.attention : COPY.briefing.look}</Pill>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.name}>{item.headline}</Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detail}>{item.detail}</Text>
                </View>
              ))}
            </View>
            <ActionButton variant="secondary" onPress={onOpenBriefing}>{COPY.dossier.openBriefing}</ActionButton>
          </>
        )}
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.dossier.recentPrs}</Eyebrow>
        {overview.recentPrs.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.empty}>{MOBILE_COPY.dossier.noRecentPrs}</Text> : (
          <View style={styles.listCard}>
            {overview.recentPrs.map((p, i) => (
              <View key={`${p.lift}-${i}`} style={[styles.pr, i > 0 && styles.rowBorder]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, styles.flex]}>{p.lift}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.number}>{`${p.value} · ${p.date}`}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

export function ClientOverview({ clientId, header, onOpenBriefing }: { clientId: string; header: React.ReactElement; onOpenBriefing: () => void }) {
  const overview = useOverview(clientId);
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={overview.isRefetching} onRefresh={() => overview.refetch()} tintColor={colors.mutedForeground} />}
    >
      {header}
      {overview.isPending ? (
        <View style={styles.body} accessibilityState={{ busy: true }}><Skeleton height={120} /><Skeleton height={96} /><Skeleton height={96} /></View>
      ) : overview.isError ? (
        <Notice alert action={<ActionButton variant="secondary" onPress={() => overview.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.dossier.loadFailed}</Notice>
      ) : (
        <Body overview={overview.data} onOpenBriefing={onOpenBriefing} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, gap: spacing.lg - 4 },
  block: { gap: spacing.sm },
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  cardHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  captionNumber: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  summary: { fontSize: fontSize.base, lineHeight: 23, color: colors.foreground },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { flexBasis: '47%', flexGrow: 1, padding: 12, gap: 4, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground, fontVariant: ['tabular-nums'] },
  delta: { fontSize: 12, color: colors.zinc600, fontVariant: ['tabular-nums'] },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  detail: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  empty: { fontSize: fontSize.base, color: colors.mutedForeground },
  segments: { flexDirection: 'row', gap: 4, marginTop: 4 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  segmentDone: { backgroundColor: colors.foreground },
  listCard: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  openItem: { padding: 12, gap: 6 },
  pr: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: spacing.sm },
  number: { fontSize: fontSize.sm, color: colors.zinc600, fontVariant: ['tabular-nums'] },
});
