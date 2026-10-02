// Check-ins on the phone (design handoff §6.4, layout B — batch review): one
// column of full cards, each with what Axiom read, the answers and an inline
// draft reply. A segmented control switches to the schedule configuration.

import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COPY, relativeDay, type CheckIn, type MeResponse, type Tone } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { CheckInConfigure } from './CheckInConfigure';
import { Avatar, Eyebrow, EvidenceList, MAX_FONT_SCALE, Notice, Pill, clientPath } from './components';
import { ActionButton, Disclosure, FeedbackText, SegmentedControl, sendHaptic } from './controls';
import { DraftReply } from './DraftReply';
import { useCheckInActions, useCheckIns } from './hooks';
import { CHANNEL_LABEL, MOBILE_COPY } from './mobileCopy';
import { RequestCheckInSheet } from './RequestCheckInSheet';
import { Screen } from './Screen';

const CLASS_TONE: Record<CheckIn['classification'], Tone> = { flag: 'red', look: 'amber', routine: 'green' };

function CheckInCard({ checkIn, onOpenClient }: { checkIn: CheckIn; onOpenClient: () => void }) {
  const { markRead } = useCheckInActions();
  const [basis, setBasis] = useState(false);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Pressable
          onPress={onOpenClient}
          accessibilityRole="button"
          accessibilityLabel={MOBILE_COPY.briefing.openClient(checkIn.client.name)}
          style={({ pressed }) => [styles.who, pressed && styles.pressed]}
        >
          <Avatar initials={checkIn.client.initials} size={44} />
          <View style={styles.whoText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.name}>{checkIn.client.name}</Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>
              {[relativeDay(checkIn.submittedAt), CHANNEL_LABEL[checkIn.channel], checkIn.reviewedAt ? COPY.checkIns.reviewed : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
      </View>
      <Pill tone={CLASS_TONE[checkIn.classification]}>{COPY.checkIns.classification[checkIn.classification]}</Pill>

      <View style={styles.read}>
        <Eyebrow>{COPY.checkIns.axiomRead}</Eyebrow>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.summary}>{checkIn.summary}</Text>
        {checkIn.signals.length > 0 && (
          <View style={styles.signals}>
            {checkIn.signals.map((s) => <Pill key={s.label} tone={s.tone}>{s.label}</Pill>)}
          </View>
        )}
        <Disclosure label={COPY.dossier.summaryBasis} open={basis} onToggle={() => setBasis((v) => !v)}>
          <EvidenceList reasons={checkIn.evidence.reasons} sources={checkIn.evidence.sources} />
        </Disclosure>
      </View>

      <Eyebrow>{COPY.checkIns.answers}</Eyebrow>
      <View style={styles.answers}>
        {checkIn.answers.map((a, i) => (
          <View key={`${i}-${a.question}`} style={[styles.answer, i > 0 && styles.answerBorder]}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{a.question}</Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.answerText}>{a.answer || MOBILE_COPY.noValue}</Text>
          </View>
        ))}
      </View>

      <Eyebrow>{COPY.draft.label}</Eyebrow>
      {checkIn.reviewedAt && checkIn.draft.status === 'discarded' ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.reviewed}>{`${COPY.checkIns.reviewed} · ${MOBILE_COPY.checkIns.noReplySent}`}</Text>
      ) : (
        <DraftReply draft={checkIn.draft} label={MOBILE_COPY.anakin.draftTo(checkIn.client.name)}>
          <ActionButton variant="ghost" disabled={markRead.isPending} onPress={() => markRead.mutate(checkIn.id)}>{COPY.checkIns.markRead}</ActionButton>
        </DraftReply>
      )}
      {markRead.isError && <FeedbackText error>{(markRead.error as Error).message || COPY.checkIns.loadFailed}</FeedbackText>}
    </View>
  );
}

function Inbox() {
  const router = useRouter();
  const inbox = useCheckIns();
  const { sendRoutine } = useCheckInActions();
  const [requestOpen, setRequestOpen] = useState(false);
  // A check-in whose reading carries no reasons is an error, never something to show (handoff §2.2).
  const list = useMemo(() => (inbox.data?.checkIns ?? []).filter((c) => (c.evidence?.reasons?.length ?? 0) > 0), [inbox.data]);
  const missed = inbox.data?.missed ?? [];
  const routinePending = inbox.data?.routinePending ?? 0;

  const header = (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <ActionButton onPress={() => setRequestOpen(true)}>{COPY.checkIns.request}</ActionButton>
        {routinePending > 0 && (
          <ActionButton variant="secondary" disabled={sendRoutine.isPending} onPress={() => { sendHaptic(); sendRoutine.mutate(); }}>
            {COPY.checkIns.sendRoutine(routinePending)}
          </ActionButton>
        )}
      </View>
      {sendRoutine.isSuccess && <FeedbackText>{COPY.checkIns.routineSent(sendRoutine.data.sent)}</FeedbackText>}
      {sendRoutine.isError && <FeedbackText error>{(sendRoutine.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}

      {missed.length > 0 && (
        <View style={styles.missed}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.missedTitle}>{COPY.checkIns.missedTitle(missed.length)}</Text>
          {missed.map((m) => (
            <Text key={m.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.missedLine}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.missedName}>{m.client.name}</Text>
              {` · ${m.path.join(' → ')}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );

  const empty = inbox.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1].map((i) => <Skeleton key={i} height={220} />)}
    </View>
  ) : inbox.isError ? (
    <Notice alert action={<ActionButton variant="secondary" onPress={() => inbox.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.checkIns.loadFailed}</Notice>
  ) : (
    <Notice title={COPY.checkIns.empty}>{COPY.checkIns.emptyBody}</Notice>
  );

  return (
    <>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <CheckInCard checkIn={item} onOpenClient={() => router.navigate(clientPath(item.clientId) as any)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => inbox.refetch()} tintColor={colors.mutedForeground} />}
      />
      <RequestCheckInSheet visible={requestOpen} onClose={() => setRequestOpen(false)} />
    </>
  );
}

export function CheckInsScreen({ me }: { me: MeResponse }) {
  const [tab, setTab] = useState<'inbox' | 'configure'>('inbox');
  return (
    <Screen me={me} title={COPY.checkIns.title} active="checkIns">
      <SegmentedControl
        style={styles.segments}
        label={COPY.checkIns.title}
        value={tab}
        onChange={setTab}
        options={[{ value: 'inbox', label: COPY.checkIns.inbox }, { value: 'configure', label: COPY.checkIns.configure }]}
      />
      {tab === 'inbox' ? <Inbox /> : <CheckInConfigure />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  segments: { marginHorizontal: spacing.md, marginTop: 12, marginBottom: 4 },
  list: { paddingBottom: spacing.xl },
  header: { padding: spacing.md, gap: spacing.sm },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  missed: { marginTop: 4, padding: 12, gap: 4, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  missedTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.warningInk },
  missedLine: { fontSize: 12, lineHeight: 17, color: colors.warningInk },
  missedName: { fontSize: 12, lineHeight: 17, fontWeight: fontWeight.semibold, color: colors.warningInk },
  skeletons: { paddingHorizontal: spacing.md, gap: 12 },
  card: {
    marginHorizontal: spacing.md, marginBottom: 12, padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.background,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  who: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  whoText: { flex: 1 },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  read: { padding: 12, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.zinc50 },
  summary: { fontSize: fontSize.base, lineHeight: 23, color: colors.foreground },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  answers: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  answer: { paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  answerBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  answerText: { fontSize: fontSize.base, lineHeight: 22, color: colors.foreground },
  reviewed: { fontSize: fontSize.base, color: colors.zinc600 },
});
