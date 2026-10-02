// The client dossier on the phone (design handoff §6.3): header with injuries
// and the two actions, then Overview / Timeline / Program / Notes. Each tab
// is its own list, with this header scrolling at the top of it.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COPY, PersonalTrainingApiError, shortDate, type Client, type MeResponse } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { ClientNotes } from './ClientNotes';
import { ClientOverview } from './ClientOverview';
import { ClientProgram } from './ClientProgram';
import { ClientTimeline } from './ClientTimeline';
import { Avatar, MAX_FONT_SCALE, Notice, StatusPill, TAB_PATH } from './components';
import { ActionButton, FeedbackText, SegmentedControl, sendHaptic } from './controls';
import { useCheckInActions, useClient } from './hooks';
import { MessageSheet } from './MessageSheet';
import { Screen } from './Screen';

type DossierTab = keyof typeof COPY.dossier.tabs;
const TABS: DossierTab[] = ['overview', 'timeline', 'program', 'notes'];

function ClientHeader({ client }: { client: Client }) {
  const line = [
    client.program?.goal,
    client.program ? `${client.program.blockLabel} · week ${client.program.week} of ${client.program.weeks}` : COPY.roster.noProgram,
    COPY.timeline.tenure(shortDate(new Date(client.joinedAt))),
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.clientHeader}>
      <View style={styles.clientTop}>
        <Avatar initials={client.initials} size={56} />
        <View style={styles.clientText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.clientName}>{client.name}</Text>
          <StatusPill status={client.status} />
          {client.statusReason ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.reason}>{client.statusReason}</Text> : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{line}</Text>
        </View>
      </View>
      <View style={styles.injuries} accessibilityLabel="Injuries">
        {client.contraindications.length === 0
          ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.timeline.noContraindications}</Text>
          : client.contraindications.map((c) => (
            <View key={c.label} style={[styles.injury, c.active ? styles.injuryActive : styles.injuryCleared]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.injuryText, { color: c.active ? colors.destructiveInk : colors.zinc600 }]}>
                {c.label}{c.active ? '' : ` · ${COPY.timeline.cleared}`}
              </Text>
            </View>
          ))}
      </View>
    </View>
  );
}

export function ClientScreen({ me, clientId }: { me: MeResponse; clientId: string }) {
  const router = useRouter();
  const client = useClient(clientId);
  const { request } = useCheckInActions();
  // Opens on the timeline, as the web dossier does: it is where a tap from the roster or a notification is headed.
  const [tab, setTab] = useState<DossierTab>('timeline');
  const [messageOpen, setMessageOpen] = useState(false);

  const notFound = client.error instanceof PersonalTrainingApiError && client.error.status === 404;
  if (client.isError) {
    return (
      <Screen me={me} title={COPY.roster.title} active={null} back>
        <Notice alert action={notFound ? undefined : <ActionButton variant="secondary" onPress={() => client.refetch()}>{COPY.roster.retry}</ActionButton>}>
          {notFound ? COPY.timeline.notFound : COPY.timeline.loadFailed}
        </Notice>
      </Screen>
    );
  }

  const data = client.data?.client;
  const firstName = data?.name.trim().split(/\s+/)[0] ?? '';

  const header = (
    <View>
      {data ? <ClientHeader client={data} /> : (
        <View style={styles.clientHeader} accessibilityState={{ busy: true }}><Skeleton width={220} height={56} /></View>
      )}
      {data?.status === 'notJoined' ? (
        // Imported from a spreadsheet: there is no account to message. Inviting them is done on the web dashboard.
        <View style={styles.feedback}><FeedbackText>{COPY.import.notJoinedBanner(firstName)}</FeedbackText></View>
      ) : (
        <View style={styles.actions}>
          {/* "Message Maya", not "Message": the timeline below has a filter chip with that name. */}
          <ActionButton variant="secondary" disabled={!data} onPress={() => setMessageOpen(true)}>{COPY.dossier.messageTitle(firstName)}</ActionButton>
          <ActionButton variant="secondary" disabled={!data || request.isPending} onPress={() => { sendHaptic(); request.mutate([clientId]); }}>
            {COPY.dossier.requestCheckIn}
          </ActionButton>
        </View>
      )}
      {request.isSuccess && (
        <View style={styles.feedback}><FeedbackText>{request.data.requested === 0 ? COPY.dossier.checkInAlready : COPY.dossier.checkInRequested}</FeedbackText></View>
      )}
      {request.isError && (
        <View style={styles.feedback}><FeedbackText error>{(request.error as Error).message || COPY.briefing.sendFailed}</FeedbackText></View>
      )}
      <SegmentedControl
        style={styles.tabs}
        label={data?.name ?? COPY.roster.title}
        value={tab}
        onChange={setTab}
        options={TABS.map((value) => ({ value, label: COPY.dossier.tabs[value] }))}
      />
    </View>
  );

  return (
    <Screen me={me} title={data?.name ?? COPY.roster.title} active={null} back>
      {tab === 'overview' && <ClientOverview clientId={clientId} header={header} onOpenBriefing={() => router.navigate(TAB_PATH.briefing as any)} />}
      {tab === 'timeline' && <ClientTimeline clientId={clientId} header={header} />}
      {tab === 'program' && <ClientProgram clientId={clientId} header={header} />}
      {tab === 'notes' && <ClientNotes clientId={clientId} header={header} />}
      <MessageSheet visible={messageOpen} onClose={() => setMessageOpen(false)} clientId={clientId} name={firstName} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  clientHeader: { padding: spacing.md, gap: spacing.sm + 4 },
  clientTop: { flexDirection: 'row', gap: spacing.md },
  clientText: { flex: 1, gap: 4 },
  clientName: { fontSize: 22, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground },
  reason: { fontSize: fontSize.base, color: colors.zinc600 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  injuries: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  injury: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  injuryActive: { backgroundColor: colors.destructiveSoft },
  injuryCleared: { backgroundColor: colors.muted },
  injuryText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md },
  feedback: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  tabs: { marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm },
});
