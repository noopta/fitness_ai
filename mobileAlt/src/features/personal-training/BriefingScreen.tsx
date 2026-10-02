// Morning briefing on the phone (design handoff §6.1, layout A — one scroll):
// who needs the trainer today, why, and the action, without leaving the
// screen. Five states: default, all clear, stale, new trainer, and
// loading/streaming.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  BRIEFING_STREAM_PATH, COPY, WEEKDAY_NAMES, clockTime, queryKeys, shortDate,
  type Briefing, type BriefingItem, type BriefingResponse, type BriefingSource, type BriefingStreamEvent, type MeResponse,
} from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { streamEvents } from './api';
import { BriefCard } from './BriefCard';
import { Avatar, Eyebrow, MAX_FONT_SCALE, Notice, TAB_PATH, clientPath } from './components';
import { ActionButton, Disclosure } from './controls';
import { useBriefing } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { Screen } from './Screen';

const SOURCES: BriefingSource[] = ['workouts', 'checkIns', 'messages', 'programs'];

function dateEyebrow(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${WEEKDAY_NAMES[d.getDay()]} ${shortDate(d)}`;
}

/** An item without its reasons is an error, never something to show (handoff §2.2). */
const hasEvidence = (item: BriefingItem) => (item.evidence?.reasons?.length ?? 0) > 0;

const SAMPLE: BriefingItem = {
  id: 'sample', clientId: 'sample',
  client: { id: 'sample', name: 'Maya Okafor', initials: 'MO', status: 'support', meta: 'Strength · week 6 of 12 · Squat 100 kg by December' },
  severity: 'attention', headline: 'Maya mentioned pain',
  detail: '"Knee has been sore since Tuesday so I skipped legs." — in a message on 24 Sep.',
  suggestion: { kind: 'message', text: '', draftId: 'sample' },
  draft: { id: 'sample', clientId: 'sample', channel: 'app', status: 'pending', text: 'Thanks for telling me, Maya. Ease off anything that aggravates it for now and do not push through pain. I will adjust this week\'s plan and check in with you tomorrow.' },
  primaryLabel: 'Send reply', secondaryLabel: 'Edit draft', guardrail: { checked: 1, label: 'Checked against 1 contraindication' },
  evidence: { reasons: ['Wrote about knee soreness in a message', 'Active injury on file: Left knee'], sources: [{ kind: 'message', id: 's', label: 'Message, 24 Sep' }] },
  dataThrough: new Date().toISOString(),
};

function AllClear({ data, onAsk }: { data: BriefingResponse; onAsk: () => void }) {
  const stats: [string, string][] = [
    [COPY.briefing.statCheckIns, String(data.rosterStats.checkInsThisWeek)],
    [COPY.briefing.statAdherence, `${data.rosterStats.adherence7d}%`],
    [COPY.briefing.statPrs, String(data.rosterStats.prs7d)],
  ];
  return (
    <View style={styles.panel}>
      <View style={styles.dotRow}>
        <View style={[styles.dot, { backgroundColor: colors.success }]} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.panelTitle}>{COPY.briefing.allClearTitle}</Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{COPY.briefing.allClearBody}</Text>
      <View style={styles.stats}>
        {stats.map(([label, value]) => (
          <View key={label} style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.statValue}>{value}</Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{label}</Text>
          </View>
        ))}
      </View>
      <ActionButton variant="secondary" onPress={onAsk}>{COPY.briefing.askAnakin}</ActionButton>
    </View>
  );
}

function NewTrainer({ onGo }: { onGo: (path: string) => void }) {
  const steps: [string, string][] = [
    [COPY.briefing.setupSteps[0], TAB_PATH.clients],
    [COPY.briefing.setupSteps[1], TAB_PATH.clients],
    [COPY.briefing.setupSteps[2], TAB_PATH.checkIns],
    [COPY.briefing.setupSteps[3], '/personal-training/settings/notifications'],
  ];
  return (
    <View style={styles.newTrainer}>
      <View style={styles.panel}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.panelTitle}>{COPY.briefing.setupTitle}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{COPY.briefing.setupBody}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.captionNumber}>{MOBILE_COPY.briefing.setupProgress(0, steps.length)}</Text>
        <View>
          {steps.map(([label, path], i) => (
            <Pressable key={label} onPress={() => onGo(path)} accessibilityRole="button" accessibilityLabel={`${i + 1}. ${label}`} style={({ pressed }) => [styles.step, i > 0 && styles.stepBorder, pressed && styles.pressed]}>
              <View style={styles.stepNumber}><Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.stepNumberText}>{i + 1}</Text></View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.stepText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Eyebrow>{COPY.briefing.sampleLabel}</Eyebrow>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <BriefCard item={SAMPLE} sample />
      </View>
    </View>
  );
}

function Streaming({ status, sources, count }: { status: string; sources: Set<BriefingSource>; count: number }) {
  return (
    <View style={styles.streaming}>
      <View style={styles.dotRow}>
        <View style={[styles.dot, { backgroundColor: colors.foreground }]} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={styles.body}>{status || COPY.briefing.reading(count)}</Text>
      </View>
      <View style={styles.sourceChips} accessibilityLabel={MOBILE_COPY.briefing.sourcesRead}>
        {SOURCES.map((s) => {
          const done = sources.has(s);
          const label = COPY.briefing.sourceLabels[s];
          return (
            <View key={s} accessible accessibilityLabel={done ? MOBILE_COPY.briefing.sourceDone(label) : MOBILE_COPY.briefing.sourceWaiting(label)} style={[styles.sourceChip, done && styles.sourceChipDone]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sourceChipText, done && styles.sourceChipTextDone]}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type StreamState = { state: 'idle' | 'running' | 'failed'; status: string; sources: Set<BriefingSource>; items: BriefingItem[] };

export function BriefingScreen({ me }: { me: MeResponse }) {
  const router = useRouter();
  const query = useBriefing();
  const qc = useQueryClient();
  const data = query.data;

  const [stream, setStream] = useState<StreamState>({ state: 'idle', status: '', sources: new Set(), items: [] });
  const [clearOpen, setClearOpen] = useState(false);
  const started = useRef(false);

  const generate = useCallback(() => {
    setStream({ state: 'running', status: '', sources: new Set(), items: [] });
    streamEvents<BriefingStreamEvent>(BRIEFING_STREAM_PATH, {}, (e) => {
      if (e.type === 'status') setStream((s) => ({ ...s, status: e.text }));
      if (e.type === 'source') setStream((s) => ({ ...s, sources: new Set(Array.from(s.sources).concat(e.source)) }));
      // Cards render as they arrive; never wait for the whole response.
      if (e.type === 'item') setStream((s) => ({ ...s, items: [...s.items, e.item] }));
      if (e.type === 'error') setStream((s) => ({ ...s, state: 'failed' }));
      if (e.type === 'done') {
        // Swap in place: the query cache is the screen's source of truth, so scroll position is untouched.
        qc.setQueryData<BriefingResponse>(queryKeys.briefing, (prev) => (prev ? { ...prev, briefing: e.briefing, stale: false, loggedSince: 0 } : prev));
        setStream((s) => ({ ...s, state: 'idle' }));
        AccessibilityInfo.announceForAccessibility(COPY.briefing.ready(e.briefing.items.filter(hasEvidence).length)); // once, not per card
      }
    })
      // A stream that closes without `done` or `error` must not leave the screen reading forever.
      .then(() => setStream((s) => (s.state === 'running' ? { ...s, state: 'failed' } : s)))
      .catch(() => setStream((s) => ({ ...s, state: 'failed' })));
  }, [qc]);

  // Today's briefing is missing (first open of the day) or stale: write it now.
  useEffect(() => {
    if (!data || started.current || data.clientCount === 0) return;
    if (!data.briefing || data.stale) { started.current = true; generate(); }
  }, [data, generate]);

  const briefing: Briefing | null = data?.briefing ?? null;
  // While the first briefing streams there is nothing stored to show, so show what has arrived.
  const items = useMemo(() => (briefing ? briefing.items : stream.items).filter(hasEvidence), [briefing, stream.items]);
  const attention = useMemo(() => items.filter((i) => i.severity === 'attention'), [items]);
  const look = useMemo(() => items.filter((i) => i.severity === 'look'), [items]);
  const handled = items.filter((i) => i.resolution).length;
  const sections = useMemo(
    () => [{ title: COPY.briefing.attention, data: attention }, { title: COPY.briefing.look, data: look }].filter((s) => s.data.length > 0),
    [attention, look],
  );

  const openClient = useCallback((clientId: string) => router.navigate(clientPath(clientId) as any), [router]);

  if (query.isPending) {
    return (
      <Screen me={me} title={COPY.nav.briefing} active="briefing">
        <View style={styles.loading} accessibilityLabel={MOBILE_COPY.loading} accessibilityState={{ busy: true }}>
          <Skeleton width={220} height={28} />
          <Skeleton height={160} />
          <Skeleton height={160} />
        </View>
      </Screen>
    );
  }
  if (query.isError || !data) {
    return (
      <Screen me={me} title={COPY.nav.briefing} active="briefing">
        <Notice alert action={<ActionButton variant="secondary" onPress={() => query.refetch()}>{COPY.briefing.retry}</ActionButton>}>
          {COPY.briefing.staleFailed}
        </Notice>
      </Screen>
    );
  }

  const running = stream.state === 'running';
  const newTrainer = data.clientCount === 0;
  const summary = briefing?.summary ?? { attention: attention.length, look: look.length, onPlan: 0 };

  const header = (
    <View style={styles.header}>
      <Eyebrow>{dateEyebrow(data.today)}</Eyebrow>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.greeting}>{COPY.briefing.greeting(data.trainerFirstName)}</Text>

      {newTrainer ? <NewTrainer onGo={(path) => router.navigate(path as any)} /> : (
        <>
          {(briefing || stream.items.length > 0) && (
            <>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{COPY.briefing.summary(summary.attention, summary.look, summary.onPlan)}</Text>
              {items.length > 0 && (
                <View style={styles.meterRow}>
                  <View
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={COPY.briefing.meter(handled, items.length)}
                    accessibilityValue={{ min: 0, max: items.length, now: handled }}
                    style={styles.meterTrack}
                  >
                    <View style={[styles.meterFill, { width: `${(handled / items.length) * 100}%` }]} />
                  </View>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.meterText}>{COPY.briefing.meter(handled, items.length)}</Text>
                </View>
              )}
            </>
          )}

          {data.stale && briefing && (
            <View style={styles.staleBanner} accessibilityLiveRegion="polite">
              <View style={styles.dotRow}>
                <View style={[styles.dot, styles.dotTop, { backgroundColor: colors.warning }]} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.staleText}>
                  {COPY.briefing.staleBanner(briefing.generatedAt ? `${shortDate(new Date(briefing.generatedAt))}, ${clockTime(briefing.generatedAt)}` : MOBILE_COPY.briefing.earlier, data.loggedSince)}{' '}
                  {stream.state === 'failed' ? COPY.briefing.staleFailed : COPY.briefing.staleWorking}
                </Text>
              </View>
              {stream.state === 'failed' && <ActionButton variant="secondary" onPress={generate}>{COPY.briefing.retry}</ActionButton>}
            </View>
          )}

          {running && !briefing && <Streaming status={stream.status} sources={stream.sources} count={data.clientCount} />}
          {stream.state === 'failed' && !briefing && (
            <Notice alert action={<ActionButton variant="secondary" onPress={generate}>{COPY.briefing.retry}</ActionButton>}>{COPY.briefing.staleFailed}</Notice>
          )}
          {briefing && items.length === 0 && <AllClear data={data} onAsk={() => router.navigate(TAB_PATH.anakin as any)} />}
        </>
      )}
    </View>
  );

  const footer = newTrainer ? null : (
    <View style={styles.footer}>
      {running && !briefing && (
        <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Skeleton height={160} />
          <Skeleton height={160} />
        </View>
      )}

      {briefing && briefing.scheduled.length > 0 && (
        <View style={styles.block}>
          <Eyebrow>{COPY.briefing.morningQuestions}</Eyebrow>
          <View style={styles.listCard}>
            {briefing.scheduled.map((q, i) => (
              <View key={q.id} style={[styles.question, i > 0 && styles.stepBorder]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{q.text}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.questionAnswer}>{q.answer}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {briefing && items.length > 0 && briefing.onPlanClients.length > 0 && (
        <View style={styles.clearGroup}>
          <View style={styles.clearHead}>
            <View accessible accessibilityRole="image" accessibilityLabel={COPY.briefing.allClearTitle} style={[styles.dot, { backgroundColor: colors.success }]} />
            <View style={styles.flex}>
              <Disclosure strong label={COPY.briefing.allClearGroup(briefing.onPlanClients.length)} open={clearOpen} onToggle={() => setClearOpen((v) => !v)} />
            </View>
          </View>
          {clearOpen && (
            <View style={styles.clearList}>
              {briefing.onPlanClients.map((c) => (
                <Pressable key={c.id} onPress={() => openClient(c.id)} accessibilityRole="button" accessibilityLabel={MOBILE_COPY.briefing.openClient(c.name)} style={({ pressed }) => [styles.clearClient, pressed && styles.pressed]}>
                  <Avatar initials={c.initials} size={28} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.clearName}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <Screen me={me} title={COPY.nav.briefing} active="briefing">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Eyebrow style={styles.groupHeading}>{MOBILE_COPY.briefing.groupCount(section.title, section.data.length)}</Eyebrow>}
        renderItem={({ item }) => <View style={styles.cardWrap}><BriefCard item={item} stale={data.stale} onOpenClient={openClient} /></View>}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.mutedForeground} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.82 },
  list: { paddingBottom: spacing.xl },
  loading: { padding: spacing.md, gap: spacing.md },
  header: { padding: spacing.md, gap: spacing.sm },
  greeting: { fontSize: 22, lineHeight: 27, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground },
  body: { flexShrink: 1, fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  captionNumber: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: colors.foreground },
  meterText: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.zinc600, fontVariant: ['tabular-nums'] },
  staleBanner: { marginTop: spacing.sm, padding: 12, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  staleText: { flex: 1, fontSize: fontSize.sm, lineHeight: 19, color: colors.warningInk },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotTop: { alignSelf: 'flex-start', marginTop: 6 },
  streaming: { marginTop: spacing.sm, gap: 12 },
  sourceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sourceChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  sourceChipDone: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  sourceChipText: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.mutedForeground },
  sourceChipTextDone: { color: colors.background },
  panel: { marginTop: spacing.sm, padding: spacing.lg - 4, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  panelTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, letterSpacing: -0.2, color: colors.foreground },
  stats: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.sm },
  stat: { flex: 1, gap: 4 },
  statValue: { fontSize: 26, lineHeight: 30, fontWeight: fontWeight.bold, letterSpacing: -0.5, color: colors.foreground, fontVariant: ['tabular-nums'] },
  newTrainer: { gap: 12 },
  step: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.sm },
  stepBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  stepNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted },
  stepNumberText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.foreground, fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, fontSize: fontSize.base, color: colors.foreground },
  groupHeading: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 12 },
  cardWrap: { paddingHorizontal: spacing.md, paddingBottom: 12 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.lg },
  skeletons: { gap: 12 },
  block: { gap: 12 },
  listCard: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  question: { paddingHorizontal: spacing.md, paddingVertical: 12, gap: 2 },
  questionAnswer: { fontSize: fontSize.base, lineHeight: 22, color: colors.foreground },
  clearGroup: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, paddingHorizontal: spacing.md },
  clearHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  clearList: { paddingBottom: 12, gap: 4, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border, paddingTop: spacing.sm },
  clearClient: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  clearName: { flex: 1, fontSize: fontSize.sm, color: colors.foreground },
});
